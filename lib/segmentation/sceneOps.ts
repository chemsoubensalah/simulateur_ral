/**
 * Combining Segment Anything (precise boundaries) with scene understanding
 * (what each region is: wall, ceiling, furniture…). Pure functions on the
 * low-resolution SAM grid so they can be unit-tested.
 */
import { rgbToLab, type Lab } from "@/lib/color/lab";
import { LOW_RES } from "./postprocess";
import type { SceneMap } from "./scene";

/** Class of each cell of a W×H low-res grid covering the image (nearest scene cell). */
export function sceneOnGrid(scene: SceneMap, W: number, H: number): Uint8Array {
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const sy = Math.min(scene.height - 1, Math.floor(((y + 0.5) / H) * scene.height));
    for (let x = 0; x < W; x++) {
      const sx = Math.min(scene.width - 1, Math.floor(((x + 0.5) / W) * scene.width));
      out[y * W + x] = scene.classes[sy * scene.width + sx]!;
    }
  }
  return out;
}

/** Majority scene class inside a low-res binary mask, and its share (purity). */
export function majorityClass(bin: Uint8Array, grid: Uint8Array): { cls: number; purity: number } {
  const counts = new Map<number, number>();
  let n = 0;
  for (let i = 0; i < bin.length; i++) {
    if (!bin[i]) continue;
    const c = grid[i]!;
    counts.set(c, (counts.get(c) ?? 0) + 1);
    n++;
  }
  let cls = -1;
  let best = 0;
  for (const [c, k] of counts) if (k > best) [cls, best] = [c, k];
  return { cls, purity: n ? best / n : 0 };
}

/** Mean colour (CIELAB) of the photo under a low-res mask, sampled at cell centres. */
export function meanLab(bin: Uint8Array, W: number, H: number, rgba: Uint8Array | Uint8ClampedArray, imgW: number, imgH: number): Lab | null {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!bin[y * W + x]) continue;
      const px = Math.min(imgW - 1, Math.floor(((x + 0.5) / W) * imgW));
      const py = Math.min(imgH - 1, Math.floor(((y + 0.5) / H) * imgH));
      const k = (py * imgW + px) * 4;
      r += rgba[k]!;
      g += rgba[k + 1]!;
      b += rgba[k + 2]!;
      n++;
    }
  return n ? rgbToLab({ r: r / n, g: g / n, b: b / n }) : null;
}

/** Low-res binary of cells whose scene class is in `classes`. */
export function classBinary(grid: Uint8Array, classes: ReadonlySet<number>): Uint8Array {
  const out = new Uint8Array(grid.length);
  for (let i = 0; i < grid.length; i++) out[i] = classes.has(grid[i]!) ? 1 : 0;
  return out;
}

/** Element-wise maximum of 256×256 logit maps (union of masks). */
export function maxLogits(maps: Float32Array[]): Float32Array {
  const out = new Float32Array(LOW_RES * LOW_RES).fill(-20);
  for (const m of maps) for (let i = 0; i < out.length; i++) if (m[i]! > out[i]!) out[i] = m[i]!;
  return out;
}

/** Logit map (+3 inside / −3 outside) from a W×H binary, placed in the 256×256 frame. */
export function binaryToLogits(bin: Uint8Array, W: number, H: number): Float32Array {
  const out = new Float32Array(LOW_RES * LOW_RES).fill(-20);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) out[y * LOW_RES + x] = bin[y * W + x] ? 3 : -3;
  return out;
}
