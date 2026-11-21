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
  // SAM's masks come from a 256 px grid, so their boundary can be off by about
  // one grid cell (image size / 256): the band must cover that.
  const b = band ?? Math.max(2, Math.round((1.25 * Math.max(w, h)) / 256));
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

  // Local surface colour F: mean of clean, confident-inside pixels within ~R,
  // computed on a coarse grid of cells (fast and memory-light at 2048 px).
  const cell = Math.max(4, Math.round(R / 2));
  const gw = Math.ceil(w / cell);
  const gh = Math.ceil(h / cell);
  const gsum = new Float64Array(gw * gh * 4);
  for (let y = 0; y < h; y++) {
    const gy = Math.floor(y / cell) * gw;
    for (let x = 0; x < w; x++) {
      const j = y * w + x;
      if (band[j] || mask[j]! < opts.inside || edges[j]! > EDGE_THRESHOLD) continue;
      const gi = (gy + Math.floor(x / cell)) * 4;
      gsum[gi] = gsum[gi]! + rgba[j * 4]!;
      gsum[gi + 1] = gsum[gi + 1]! + rgba[j * 4 + 1]!;
      gsum[gi + 2] = gsum[gi + 2]! + rgba[j * 4 + 2]!;
      gsum[gi + 3] = gsum[gi + 3]! + 1;
    }
  }
  const cr2 = Math.ceil(R / cell);

  // Sample offsets for background candidates: dense close to the pixel (so a
  // thin window trim is always seen), sparse further out.
  const DENSE = 5;
  const stride = Math.max(1, Math.floor(R / 6));
  const offsets: number[] = [];
  for (let dy = -R; dy <= R; dy++)
    for (let dx = -R; dx <= R; dx++) {
      const near = Math.abs(dx) <= DENSE && Math.abs(dy) <= DENSE;
      if (near || (dx % stride === 0 && dy % stride === 0)) offsets.push(dx, dy);
    }

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

      const gx = Math.floor(x / cell);
      const gy = Math.floor(y / cell);
      let fr = 0, fg = 0, fb = 0, fn = 0;
      for (let yy = Math.max(0, gy - cr2); yy <= Math.min(gh - 1, gy + cr2); yy++)
        for (let xx = Math.max(0, gx - cr2); xx <= Math.min(gw - 1, gx + cr2); xx++) {
          const gi = (yy * gw + xx) * 4;
          fr += gsum[gi]!; fg += gsum[gi + 1]!; fb += gsum[gi + 2]!; fn += gsum[gi + 3]!;
        }
      if (fn === 0) continue;
      fr /= fn; fg /= fn; fb /= fn;

      // Top-3 background candidates closest to the pixel colour.
      let d0 = Infinity, d1 = Infinity, d2b = Infinity;
      let j0 = -1, j1 = -1, j2 = -1;
      for (let o = 0; o < offsets.length; o += 2) {
        const xx = x + offsets[o]!;
        const yy = y + offsets[o + 1]!;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const j = yy * w + xx;
        const v = mask[j]!;
        if (v >= opts.inside && !band[j]) continue;
        if (edges[j]! > EDGE_THRESHOLD) continue; // mixed pixel at an edge: not a clean sample
        const k = j * 4;
        const r = rgba[k]!, g = rgba[k + 1]!, b2 = rgba[k + 2]!;
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

/**
 * Edge-aware growing: extend a mask outwards into neighbouring pixels that have
 * the same colour as the surface right next to them, up to `maxDist` px, and
 * never across a visible edge. Closes the gaps SAM leaves at faint boundaries
 * (e.g. a wall meeting a white ceiling) without leaking far into the neighbour.
 */
export function growMask(
  mask: Uint8Array,
  rgba: Uint8Array | Uint8ClampedArray,
  w: number,
  h: number,
  edges: Uint8Array,
  opts: { maxDist?: number; tolerance?: number; edgeStop?: number } = {},
): Uint8Array {
  const maxDist = opts.maxDist ?? Math.max(3, Math.round((1.5 * Math.max(w, h)) / 256));
  const tol2 = (opts.tolerance ?? 9) ** 2;
  const edgeStop = opts.edgeStop ?? 18;
  const out = mask.slice();
  const dist = new Uint8Array(w * h);
  // Reference colour carried from the boundary pixel where growth started.
  const refR = new Uint8Array(w * h);
  const refG = new Uint8Array(w * h);
  const refB = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;
  const inside = (i: number) => mask[i]! >= 128;
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!inside(i)) continue;
      if (inside(i - 1) && inside(i + 1) && inside(i - w) && inside(i + w)) continue;
      // Boundary pixel inside the mask: seed with the mean colour of its inside 3×3.
      let r = 0, g = 0, b = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const j = i + dy * w + dx;
          if (!inside(j)) continue;
          r += rgba[j * 4]!; g += rgba[j * 4 + 1]!; b += rgba[j * 4 + 2]!; n++;
        }
      refR[i] = r / n; refG[i] = g / n; refB[i] = b / n;
      dist[i] = 0;
      queue[tail++] = i;
    }
  const visited = new Uint8Array(w * h);
  for (let i = 0; i < tail; i++) visited[queue[i]!] = 1;
  while (head < tail) {
    const i = queue[head++]!;
    const d = dist[i]!;
    if (d >= maxDist) continue;
    const x = i % w;
    const y = (i - x) / w;
    for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
      if (j < 0 || visited[j] || inside(j)) continue;
      visited[j] = 1;
      if (edges[j]! > edgeStop) continue;
      // Compare the 3×3 mean colour (robust to sensor noise) with the reference.
      const jx = j % w;
      const jy = (j - jx) / w;
      let cr = 0, cg = 0, cb = 0, cn = 0;
      for (let yy = Math.max(0, jy - 1); yy <= Math.min(h - 1, jy + 1); yy++)
        for (let xx = Math.max(0, jx - 1); xx <= Math.min(w - 1, jx + 1); xx++) {
          const k = (yy * w + xx) * 4;
          cr += rgba[k]!; cg += rgba[k + 1]!; cb += rgba[k + 2]!; cn++;
        }
      const dr = cr / cn - refR[i]!, dg = cg / cn - refG[i]!, db = cb / cn - refB[i]!;
      if (dr * dr + dg * dg + db * db > tol2) continue;
      out[j] = 255;
      dist[j] = d + 1;
      refR[j] = refR[i]!; refG[j] = refG[i]!; refB[j] = refB[i]!;
      queue[tail++] = j;
    }
  }
  // Smooth the grown front: one 3×3 majority pass over pixels that changed or touch a change.
  const smoothed = out.slice();
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (inside(i)) continue; // never remove the original selection
      let changedNear = false;
      let on = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const j = i + dy * w + dx;
          if (out[j] !== mask[j]) changedNear = true;
          if (out[j]! >= 128) on++;
        }
      if (changedNear) smoothed[i] = on >= 5 ? 255 : mask[i]!;
    }
  return smoothed;
}
