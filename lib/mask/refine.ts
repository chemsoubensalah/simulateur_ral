/**
 * Edge refinement by local two-colour unmixing.
 *
 * Segmentation masks (SAM upsampled from 256 px, brush strokes, lasso) have a
 * soft boundary that does not sit exactly on the photo's edge. Around the
 * boundary we model every pixel as a mix of the nearby confident surface colour
 * F and the nearby background colour B:  c ≈ α·F + (1−α)·B, and solve
 *     α = ((c − B) · (F − B)) / |F − B|² .
 * This snaps the mask to real edges with physically correct anti-aliasing,
 * and only touches pixels in the uncertain band, so it is fast on phones.
 */

export type RefineOptions = {
  /** Extra pixels around the soft transition that may change. */
  band: number;
  /** Radius of the neighbourhood used to estimate local colours. */
  radius: number;
  /** Coverage at/above which a pixel is confidently inside (0..255). */
  inside: number;
  /** Coverage at/below which a pixel is confidently outside. */
  outside: number;
  /** Minimum colour distance between F and B for unmixing to be trusted. */
  minContrast: number;
};

export function defaultRefineOptions(w: number, h: number, band?: number): RefineOptions {
  const scale = Math.max(w, h) / 2048;
  // A few px around the mask edge: enough to fix SAM's 8 px staircase. Thin
  // structures inside the band (window trim) are still usable as background
  // samples because they differ in colour from the surface.
  const b = band ?? Math.max(2, Math.round(4 * scale));
  return {
    band: b,
    // The colour window must reach confident pixels beyond the band on both sides.
    radius: Math.max(6, Math.round(10 * scale), 2 * b + 4),
    inside: 250,
    outside: 5,
    minContrast: 15,
  };
}

/**
 * Local gradient magnitude (max over RGB of |∂x| + |∂y|, central differences),
 * used to keep colour samples away from edges, where pixels are mixtures.
 */
export function edgeMap(rgba: Uint8Array | Uint8ClampedArray, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      let m = 0;
      for (let c = 0; c < 3; c++) {
        const gx = Math.abs(rgba[(i + 1) * 4 + c]! - rgba[(i - 1) * 4 + c]!);
        const gy = Math.abs(rgba[(i + w) * 4 + c]! - rgba[(i - w) * 4 + c]!);
        if (gx + gy > m) m = gx + gy;
      }
      out[i] = m > 255 ? 255 : m;
    }
  }
  return out;
}

/** Gradient above which a pixel is considered part of an edge (not a clean colour sample). */
const EDGE_THRESHOLD = 30;

/**
 * Refine `mask` (0..255) using `rgba` (the photo, 4 bytes/pixel). Returns a new mask.
 * `edges` (from edgeMap) can be passed in to avoid recomputing it per call.
 */
export function refineMask(
  mask: Uint8Array,
  rgba: Uint8Array | Uint8ClampedArray,
  w: number,
  h: number,
  opts: RefineOptions = defaultRefineOptions(w, h),
  edges: Uint8Array = edgeMap(rgba, w, h),
): Uint8Array {
  const out = mask.slice();
  const n = w * h;
  // 1. Uncertain band: soft pixels, plus `band` px around them and around hard edges.
  const band = new Uint8Array(n);
  const seeds: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const v = mask[i]!;
      const soft = v > opts.outside && v < opts.inside;
      const hardEdge =
        !soft &&
        ((x > 0 && Math.abs(mask[i - 1]! - v) > 128) || (y > 0 && Math.abs(mask[i - w]! - v) > 128));
      if (soft || hardEdge) seeds.push(i);
    }
  }
  if (seeds.length === 0) return out;
  const b = opts.band;
  for (const i of seeds) {
    const x = i % w;
    const y = (i - x) / w;
    const x0 = Math.max(0, x - b);
    const x1 = Math.min(w - 1, x + b);
    const y0 = Math.max(0, y - b);
    const y1 = Math.min(h - 1, y + b);
    for (let yy = y0; yy <= y1; yy++) band.fill(1, yy * w + x0, yy * w + x1 + 1);
  }

  // 2. For each band pixel:
  //    F = mean colour of confident-inside pixels nearby;
  //    B = mean of the 3 nearby background candidates most similar to the pixel.
  //    Background candidates are confident-outside pixels plus uncertain pixels
  //    whose colour clearly differs from F — so a thin window trim lying inside
  //    the uncertain zone still counts as background, while uncertain pixels
  //    that look like the wall do not.
  //    The pixel colour is a 3×3 mean to suppress sensor noise.
  const R = opts.radius;
  const lo = opts.minContrast;
  const hi = opts.minContrast * 3;
  const lo2x = (2 * lo) * (2 * lo);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!band[i]) continue;
      let cr = 0, cg = 0, cb = 0, cn = 0;
      for (let yy = Math.max(0, y - 1); yy <= Math.min(h - 1, y + 1); yy++)
        for (let xx = Math.max(0, x - 1); xx <= Math.min(w - 1, x + 1); xx++) {
          const k = (yy * w + xx) * 4;
          cr += rgba[k]!; cg += rgba[k + 1]!; cb += rgba[k + 2]!; cn++;
        }
      cr /= cn; cg /= cn; cb /= cn;

      const y0 = Math.max(0, y - R), y1 = Math.min(h - 1, y + R);
      const x0 = Math.max(0, x - R), x1 = Math.min(w - 1, x + R);
      let fr = 0, fg = 0, fb = 0, fn = 0;
      for (let yy = y0; yy <= y1; yy++)
        for (let xx = x0; xx <= x1; xx++) {
          const j = yy * w + xx;
          if (band[j] || mask[j]! < opts.inside || edges[j]! > EDGE_THRESHOLD) continue;
          const k = j * 4;
          fr += rgba[k]!; fg += rgba[k + 1]!; fb += rgba[k + 2]!; fn++;
        }
      if (fn === 0) continue;
      fr /= fn; fg /= fn; fb /= fn;

      // Top-3 background candidates closest to the pixel colour.
      let d0 = Infinity, d1 = Infinity, d2b = Infinity;
      let j0 = -1, j1 = -1, j2 = -1;
      for (let yy = y0; yy <= y1; yy++)
        for (let xx = x0; xx <= x1; xx++) {
          const j = yy * w + xx;
          const v = mask[j]!;
          const k = j * 4;
          const r = rgba[k]!, g = rgba[k + 1]!, b2 = rgba[k + 2]!;
          if (v >= opts.inside && !band[j]) continue;
          if (edges[j]! > EDGE_THRESHOLD) continue; // mixed pixel at an edge: not a clean sample
          if (band[j] || v > opts.outside) {
            // Uncertain pixel: only a candidate if it clearly differs from the surface.
            const df = (r - fr) * (r - fr) + (g - fg) * (g - fg) + (b2 - fb) * (b2 - fb);
            if (df < lo2x) continue;
          }
          const d = (r - cr) * (r - cr) + (g - cg) * (g - cg) + (b2 - cb) * (b2 - cb);
          if (d < d0) { d2b = d1; j2 = j1; d1 = d0; j1 = j0; d0 = d; j0 = j; }
          else if (d < d1) { d2b = d1; j2 = j1; d1 = d; j1 = j; }
          else if (d < d2b) { d2b = d; j2 = j; }
        }
      if (j0 < 0) continue;
      let br = 0, bg = 0, bb = 0, bn = 0;
      for (const j of [j0, j1, j2]) {
        if (j < 0) continue;
        const k = j * 4;
        br += rgba[k]!; bg += rgba[k + 1]!; bb += rgba[k + 2]!; bn++;
      }
      br /= bn; bg /= bn; bb /= bn;

      const dr = fr - br, dg = fg - bg, db = fb - bb;
      const dd = dr * dr + dg * dg + db * db;
      const dist = Math.sqrt(dd);
      if (dist < lo) continue; // surface and background look alike: trust the mask
      const t = Math.min(1, (dist - lo) / (hi - lo));
      // High contrast: use the pixel's own colour (exact edge position);
      // low contrast: use the 3×3 mean (noise would dominate otherwise).
      const k = i * 4;
      const pr = rgba[k]! * t + cr * (1 - t);
      const pg = rgba[k + 1]! * t + cg * (1 - t);
      const pb = rgba[k + 2]! * t + cb * (1 - t);
      let a = ((pr - br) * dr + (pg - bg) * dg + (pb - bb) * db) / dd;
      a = Math.min(1, Math.max(0, (a - 0.08) / 0.84));
      out[i] = Math.round((a * t + (mask[i]! / 255) * (1 - t)) * 255);
    }
  }
  return out;
}
