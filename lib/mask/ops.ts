/**
 * 8-bit mask operations (alpha 0..255, row-major, width*height).
 * Pure functions on typed arrays so they are fast, testable and usable in workers.
 */

export type Rect = { x: number; y: number; w: number; h: number };

export function emptyRect(): Rect {
  return { x: 0, y: 0, w: 0, h: 0 };
}

export function unionRect(a: Rect, b: Rect): Rect {
  if (a.w === 0 || a.h === 0) return { ...b };
  if (b.w === 0 || b.h === 0) return { ...a };
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const x1 = Math.max(a.x + a.w, b.x + b.w);
  const y1 = Math.max(a.y + a.h, b.y + b.h);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function clampRect(r: Rect, width: number, height: number): Rect {
  const x0 = Math.max(0, Math.floor(r.x));
  const y0 = Math.max(0, Math.floor(r.y));
  const x1 = Math.min(width, Math.ceil(r.x + r.w));
  const y1 = Math.min(height, Math.ceil(r.y + r.h));
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

export type BrushMode = "add" | "erase";

/**
 * Stamp an anti-aliased disc. `hardness` in [0,1]: 1 = 1px AA edge, 0 = fully soft.
 * Returns the affected rect.
 */
export function stampDisc(
  mask: Uint8Array,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radius: number,
  mode: BrushMode,
  hardness = 0.85,
): Rect {
  const rect = clampRect({ x: cx - radius - 1, y: cy - radius - 1, w: 2 * radius + 3, h: 2 * radius + 3 }, width, height);
  const inner = Math.max(0, radius * hardness - 0.5);
  const falloff = Math.max(1, radius - inner);
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    const dy = y + 0.5 - cy;
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const dx = x + 0.5 - cx;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d >= radius + 0.5) continue;
      const t = d <= inner ? 1 : Math.max(0, 1 - (d - inner) / falloff);
      const v = Math.round(t * 255);
      const i = y * width + x;
      const cur = mask[i] ?? 0;
      if (mode === "add") {
        if (v > cur) mask[i] = v;
      } else {
        const keep = 255 - v;
        if (keep < cur) mask[i] = keep;
      }
    }
  }
  return rect;
}

/** Stamp discs along a segment with spacing proportional to radius. */
export function strokeSegment(
  mask: Uint8Array,
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  radius: number,
  mode: BrushMode,
  hardness = 0.85,
): Rect {
  const dist = Math.hypot(x1 - x0, y1 - y0);
  const step = Math.max(0.5, radius * 0.25);
  const n = Math.max(1, Math.ceil(dist / step));
  let rect = emptyRect();
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    rect = unionRect(rect, stampDisc(mask, width, height, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, radius, mode, hardness));
  }
  return rect;
}

/** Merge a coverage buffer (e.g. a rasterised polygon) into the mask. */
export function mergeCoverage(mask: Uint8Array, coverage: Uint8Array, mode: BrushMode): void {
  for (let i = 0; i < mask.length; i++) {
    const v = coverage[i] ?? 0;
    if (v === 0) continue;
    const cur = mask[i] ?? 0;
    if (mode === "add") mask[i] = Math.max(cur, v);
    else mask[i] = Math.min(cur, 255 - v);
  }
}

/** Separable box blur, `passes` times (3 passes ≈ Gaussian). Returns a new array. */
export function blurMask(mask: Uint8Array, width: number, height: number, radius: number, passes = 2): Uint8Array {
  const r = Math.max(0, Math.round(radius));
  if (r === 0) return mask.slice();
  let src = Float32Array.from(mask);
  let dst = new Float32Array(mask.length);
  const win = 2 * r + 1;
  for (let p = 0; p < passes; p++) {
    // horizontal
    for (let y = 0; y < height; y++) {
      const row = y * width;
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += src[row + Math.min(width - 1, Math.max(0, k))] ?? 0;
      for (let x = 0; x < width; x++) {
        dst[row + x] = acc / win;
        const add = src[row + Math.min(width - 1, x + r + 1)] ?? 0;
        const sub = src[row + Math.max(0, x - r)] ?? 0;
        acc += add - sub;
      }
    }
    [src, dst] = [dst, src];
    // vertical
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += src[Math.min(height - 1, Math.max(0, k)) * width + x] ?? 0;
      for (let y = 0; y < height; y++) {
        dst[y * width + x] = acc / win;
        const add = src[Math.min(height - 1, y + r + 1) * width + x] ?? 0;
        const sub = src[Math.max(0, y - r) * width + x] ?? 0;
        acc += add - sub;
      }
    }
    [src, dst] = [dst, src];
  }
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < out.length; i++) out[i] = Math.round(src[i] ?? 0);
  return out;
}

/**
 * Edge feathering for the "edge softness" (0–3px) setting. With such small radii
 * the interior of a surface stays fully opaque; only the boundary is softened.
 */
export function featherMask(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  if (radius <= 0) return mask;
  return blurMask(mask, width, height, radius, 2);
}

export function copyRegion(mask: Uint8Array, width: number, r: Rect): Uint8Array {
  const out = new Uint8Array(r.w * r.h);
  for (let row = 0; row < r.h; row++) {
    const start = (r.y + row) * width + r.x;
    out.set(mask.subarray(start, start + r.w), row * r.w);
  }
  return out;
}

export function pasteRegion(mask: Uint8Array, width: number, r: Rect, data: Uint8Array): void {
  for (let row = 0; row < r.h; row++) {
    mask.set(data.subarray(row * r.w, (row + 1) * r.w), (r.y + row) * width + r.x);
  }
}

/** Bounding rect of all differences between two equal-length masks. */
export function diffRect(a: Uint8Array, b: Uint8Array, width: number, height: number): Rect {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (a[row + x] !== b[row + x]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        y1 = y;
      }
    }
  }
  return x1 < 0 ? emptyRect() : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export function maskCoverage(mask: Uint8Array): number {
  let s = 0;
  for (let i = 0; i < mask.length; i++) s += mask[i] ?? 0;
  return s / (255 * mask.length);
}
