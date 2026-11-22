/**
 * Lighting estimation for "hide stains and defects".
 *
 * A photo of a wall = surface colour × lighting. New paint replaces the
 * surface colour — including stains, marks, old patches — but not the light.
 * The lighting on a wall varies smoothly (gradients from windows and lamps),
 * while defects are small, so a large, mask-aware blur of the wall's
 * luminance estimates the lighting. The recolor shader then uses
 *   r = (lighting / reference) · (pixel / lighting)^β
 * with β ≈ 0.15: lighting kept, defects reduced to a faint texture.
 */
import { lToY, yToL } from "@/lib/color/lab";

/** Smooth lighting of a surface at low resolution, encoded as round(L* × 2.55). */
export type ShadingMap = { data: Uint8Array; width: number; height: number };

/**
 * Exponents for "hide stains and defects": how much of the mid-scale
 * variation (stains, patches, dirt — between the fine grain and the lighting)
 * and of the fine texture (plaster grain, cracks, which paint does not hide)
 * is kept. 1 keeps everything (the classic recolor).
 */
export const CLEANUP = { beta: 0.15, texture: 0.8 } as const;

function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const win = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += src[row + Math.min(w - 1, Math.max(0, k))]!;
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / win;
      acc += src[row + Math.min(w - 1, x + r + 1)]! - src[row + Math.max(0, x - r)]!;
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += tmp[Math.min(h - 1, Math.max(0, k)) * w + x]!;
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / win;
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x]! - tmp[Math.max(0, y - r) * w + x]!;
    }
  }
  return out;
}

/**
 * Smooth lighting of the masked surface, at 1/`factor` resolution.
 * `lightness` holds L*·2.55 per pixel. Cells far from the mask get the
 * surface's mean lighting (they are only seen while a brush stroke grows the
 * mask, before the map is recomputed). Returns null for an empty mask.
 */
export function estimateShading(lightness: Uint8Array, mask: Uint8Array, w: number, h: number, factor = 4): ShadingMap | null {
  const sw = Math.ceil(w / factor);
  const sh = Math.ceil(h / factor);
  const ym = new Float32Array(sw * sh);
  const m = new Float32Array(sw * sh);
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) lut[i] = lToY(i / 2.55);
  // Downsample (area average) of mask-weighted luminance and of the mask.
  for (let y = 0; y < h; y++) {
    const sy = Math.floor(y / factor) * sw;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const a = mask[i]! / 255;
      if (a === 0) continue;
      const j = sy + Math.floor(x / factor);
      ym[j] = ym[j]! + lut[lightness[i]!]! * a;
      m[j] = m[j]! + a;
    }
  }
  let total = 0;
  let weight = 0;
  for (let i = 0; i < m.length; i++) {
    total += ym[i]!;
    weight += m[i]!;
  }
  if (weight === 0) return null;
  const fill = Math.round(yToL(total / weight) * 2.55);
  // Normalised convolution: blur(Y·m) / blur(m), three box passes ≈ Gaussian.
  const r = Math.max(2, Math.round((Math.max(w, h) * 0.035) / factor));
  let by: Float32Array = ym;
  let bm: Float32Array = m;
  for (let p = 0; p < 3; p++) {
    by = boxBlur(by, sw, sh, r);
    bm = boxBlur(bm, sw, sh, r);
  }
  const data = new Uint8Array(sw * sh);
  for (let i = 0; i < data.length; i++) {
    // Weight of the mask in the blur window; below ~1 % of a cell the estimate is unreliable.
    data[i] = bm[i]! > 0.01 ? Math.round(yToL(Math.min(1, Math.max(0, by[i]! / bm[i]!))) * 2.55) : fill;
  }
  return { data, width: sw, height: sh };
}
