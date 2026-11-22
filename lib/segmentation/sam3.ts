/**
 * SAM 3 "concept" segmentation: every wall and the ceiling found from the
 * words "wall" / "ceiling", each wall as its own instance, with precise
 * outlines (objects on or in front of the wall are left out). Runs on a
 * server (fal.ai GPU or a self-hosted ONNX model); shared types here.
 */
export type Sam3Kind = "wall" | "ceiling";

export const SAM3_PROMPTS: Record<Sam3Kind, string> = { wall: "wall", ceiling: "ceiling" };
/** Minimum detection score kept per kind (walls are often detected with lower confidence). */
export const SAM3_MIN_SCORE: Record<Sam3Kind, number> = { wall: 0.4, ceiling: 0.5 };
/** Masks are sent at this size (longest side); the client snaps them to the full-resolution photo. */
export const SAM3_MASK_SIZE = 768;

export type Sam3Instance = { kind: Sam3Kind; score: number; offset: number; length: number };
export type Sam3ResponseHeader = { provider: string; width: number; height: number; ms: number; instances: Sam3Instance[] };

/** An instance on the client: a binary mask (0/255) of width × height. */
export type Sam3Mask = { kind: Sam3Kind; score: number; width: number; height: number; mask: Uint8Array };

/** Size of the mask grid for an image (longest side SAM3_MASK_SIZE, never larger than the image). */
export function maskSize(w: number, h: number): { width: number; height: number } {
  const k = Math.min(1, SAM3_MASK_SIZE / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}

/** Intersection over union of two binary masks of the same size. */
export function maskIou(a: Uint8Array, b: Uint8Array): number {
  let inter = 0;
  let union = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]! > 127;
    const y = b[i]! > 127;
    if (x && y) inter++;
    if (x || y) union++;
  }
  return union ? inter / union : 0;
}

/** Drop duplicates (IoU > 0.8 with a better-scored instance of any kind). */
export function dedupe<T extends { score: number; mask: Uint8Array }>(list: T[]): T[] {
  const sorted = [...list].sort((a, b) => b.score - a.score);
  const kept: T[] = [];
  for (const m of sorted) if (kept.every((k) => maskIou(k.mask, m.mask) <= 0.8)) kept.push(m);
  return kept;
}

/* ---------- client side: filtering and full-resolution masks ---------- */

import { throughOpenings } from "./autoWalls";
import { guidedFilterMask } from "@/lib/mask/guided";
import { edgeMap, growMask, refineMask } from "@/lib/mask/refine";
import { sceneKind, type SceneMap } from "./scene";

/** A mask resampled (nearest) onto the scene map's grid. */
function onSceneGrid(m: Sam3Mask, scene: SceneMap): Uint8Array {
  const out = new Uint8Array(scene.width * scene.height);
  for (let y = 0; y < scene.height; y++) {
    const my = Math.min(m.height - 1, Math.floor(((y + 0.5) / scene.height) * m.height));
    for (let x = 0; x < scene.width; x++) {
      const mx = Math.min(m.width - 1, Math.floor(((x + 0.5) / scene.width) * m.width));
      out[y * scene.width + x] = m.mask[my * m.width + mx]! > 127 ? 1 : 0;
    }
  }
  return out;
}

/**
 * Keep the walls of this room: drop walls seen through a window or door (a
 * balcony, the building opposite) using scene understanding when available,
 * and take the ceiling out of the walls where they overlap.
 */
export function roomSurfaces(masks: Sam3Mask[], scene: SceneMap | null): Sam3Mask[] {
  let list = masks;
  if (scene) {
    list = masks.filter((m) => {
      if (m.kind !== "wall") return true;
      const bin = onSceneGrid(m, scene);
      let n = 0;
      let opening = 0;
      for (let i = 0; i < bin.length; i++)
        if (bin[i]) {
          n++;
          const k = sceneKind(scene.classes[i]!);
          if (k === "window" || k === "door" || k === "outdoor") opening++;
        }
      if (n && opening / n >= 0.5) return false;
      const drop = throughOpenings(bin, scene.classes, scene.width, scene.height);
      let dropped = 0;
      for (let i = 0; i < bin.length; i++) dropped += bin[i]! & drop[i]!;
      return !(n && dropped / n >= 0.5);
    });
  }
  const ceilings = list.filter((m) => m.kind === "ceiling");
  if (!ceilings.length) return list;
  return list.map((m) => {
    if (m.kind !== "wall") return m;
    const mask = m.mask.slice();
    for (const c of ceilings) if (c.width === m.width && c.height === m.height) for (let i = 0; i < mask.length; i++) if (c.mask[i]! > 127) mask[i] = 0;
    return { ...m, mask };
  });
}

/** Union of masks (same size). */
export function unionMask(masks: Sam3Mask[]): Sam3Mask | null {
  if (!masks.length) return null;
  const first = masks[0]!;
  const mask = new Uint8Array(first.width * first.height);
  for (const m of masks) for (let i = 0; i < mask.length; i++) if (m.mask[i]! > mask[i]!) mask[i] = m.mask[i]!;
  return { ...first, score: Math.max(...masks.map((m) => m.score)), mask };
}

/** Upsample a mask to the photo's resolution and snap its edge to the photo. */
export function fullResolution(m: Sam3Mask, rgba: Uint8Array | Uint8ClampedArray, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(m.height - 1, Math.max(0, ((y + 0.5) / h) * m.height - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(m.height - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(m.width - 1, Math.max(0, ((x + 0.5) / w) * m.width - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(m.width - 1, x0 + 1);
      const tx = fx - x0;
      const v = (m.mask[y0 * m.width + x0]! * (1 - tx) + m.mask[y0 * m.width + x1]! * tx) * (1 - ty) + (m.mask[y1 * m.width + x0]! * (1 - tx) + m.mask[y1 * m.width + x1]! * tx) * ty;
      out[y * w + x] = Math.round(v);
    }
  }
  // Like a painter's cut-in line: fill the thin strip of wall left between the
  // paint and an object (or at a corner between two walls), snap to the real
  // edge, then straighten it.
  const edges = edgeMap(rgba, w, h);
  const grown = growMask(out, rgba, w, h, edges);
  const refined = refineMask(grown, rgba, w, h, undefined, edges);
  const r = Math.max(3, Math.round(Math.max(w, h) / 340));
  return guidedFilterMask(refined, rgba, w, h, r);
}

/** The instance under a point (image coordinates), smallest first (a wall rather than "all walls"). */
export function instanceAt(masks: Sam3Mask[], x: number, y: number, imgW: number, imgH: number): Sam3Mask | null {
  let best: Sam3Mask | null = null;
  let bestArea = Infinity;
  for (const m of masks) {
    const mx = Math.min(m.width - 1, Math.max(0, Math.floor((x / imgW) * m.width)));
    const my = Math.min(m.height - 1, Math.max(0, Math.floor((y / imgH) * m.height)));
    if (m.mask[my * m.width + mx]! <= 127) continue;
    let area = 0;
    for (const v of m.mask) if (v > 127) area++;
    if (area < bestArea) [best, bestArea] = [m, area];
  }
  return best;
}
