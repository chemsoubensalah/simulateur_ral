/**
 * "Paint all walls": one mask for every wall and one for the ceiling, from
 * Segment Anything surfaces (precise edges) and scene understanding (what each
 * region is). Pure, shared by the worker and the offline bench/tests.
 *
 * 1. Surfaces from the background analysis that scene understanding calls
 *    wall (ceiling) are taken as they are — SAM's edges follow the photo.
 * 2. Wall areas no surface covered (narrow strips between furniture, above a
 *    window…) are not painted from the coarse scene map: SAM is asked for the
 *    surface at the deepest point of each gap and its answer is kept only if it
 *    is wall, looks like the walls already found (colour) and does not cover
 *    known objects. A clearly different surface (a ceiling lamp, a stool the
 *    coarse scene map missed) is excluded instead.
 * 3. Only what SAM could not explain is taken from the scene map (shrunk by
 *    one cell, so it stays inside the wall).
 * 4. Confident objects (furniture, windows, doors…) are cut out, and wall
 *    pieces seen through a window or door (a balcony, the street) are dropped.
 */
import { growMask, refineMask } from "@/lib/mask/refine";
import { guidedFilterMask } from "@/lib/mask/guided";
import { binaryArea, cleanLogits, LOW_RES, lowResBinary, lowResStats, toModelPoints, upsampleLogits, type EncoderGeometry, type Point } from "./postprocess";
import { binaryToLogits, classBinary, maxLogits, meanLab } from "./sceneOps";
import { deltaE2000 } from "@/lib/color/deltaE";
import type { Lab } from "@/lib/color/lab";
import { CEILING_CLASSES, sceneKind, WALL_CLASSES, type SceneKind, type SceneMap } from "./scene";

export type AutoCandidate = { id: number; logits: Float32Array; bin: Uint8Array; area: number; seed: { x: number; y: number } };
export type AutoInfo = { kind: SceneKind; purity: number; cls: number };
export type AutoImage = { rgba: Uint8Array | Uint8ClampedArray; width: number; height: number; edges: Uint8Array };
export type Decoder = (prompts: Point[][]) => Promise<{ logits: Float32Array; scores: Float32Array }>;

export type AutoInput = {
  candidates: AutoCandidate[];
  info: Map<number, AutoInfo>;
  scene: SceneMap;
  /** Scene class per valid low-res SAM cell. */
  grid: Uint8Array;
  gridW: number;
  gridH: number;
  geometry: EncoderGeometry;
  image: AutoImage;
  /** SAM decoder, to ask for surfaces the background analysis missed. */
  decode?: Decoder;
};

const MASK = LOW_RES * LOW_RES;

/** Low-res logits → full-resolution mask snapped to the photo's edges. */
export function finishMask(logits: Float32Array, seeds: { x: number; y: number }[], geometry: EncoderGeometry, image: AutoImage): Uint8Array {
  const clean = cleanLogits(logits, 0, geometry, seeds);
  const coarse = upsampleLogits(clean, 0, geometry, image.width, image.height);
  // Close gaps at faint boundaries, snap the edge to the photo, then straighten
  // what is left of the low-resolution stair-steps along the photo's edges.
  const grown = growMask(coarse, image.rgba, image.width, image.height, image.edges);
  const refined = refineMask(grown, image.rgba, image.width, image.height, undefined, image.edges);
  const r = Math.max(3, Math.round(Math.max(image.width, image.height) / 340));
  return guidedFilterMask(refined, image.rgba, image.width, image.height, r);
}

/* ---------- small grid helpers ---------- */

/** 4-connected components of a W×H binary (cell index lists). */
export function components(bin: Uint8Array, W: number, H: number): number[][] {
  const label = new Int32Array(W * H).fill(-1);
  const out: number[][] = [];
  const stack: number[] = [];
  for (let s = 0; s < bin.length; s++) {
    if (!bin[s] || label[s]! >= 0) continue;
    const comp: number[] = [];
    label[s] = out.length;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop()!;
      comp.push(i);
      const x = i % W;
      const y = (i - x) / W;
      const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1];
      for (const j of nb) {
        if (j >= 0 && bin[j] && label[j]! < 0) {
          label[j] = out.length;
          stack.push(j);
        }
      }
    }
    out.push(comp);
  }
  return out;
}

/** Chamfer distance (in cells) of every set cell to the nearest unset cell or border. */
export function distanceInside(bin: Uint8Array, W: number, H: number): Float32Array {
  const d = new Float32Array(W * H);
  const INF = 1e9;
  for (let i = 0; i < d.length; i++) d[i] = bin[i] ? INF : 0;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : d[y * W + x]!);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i]!, at(x - 1, y) + 1, at(x, y - 1) + 1, at(x - 1, y - 1) + 1.4, at(x + 1, y - 1) + 1.4);
    }
  for (let y = H - 1; y >= 0; y--)
    for (let x = W - 1; x >= 0; x--) {
      const i = y * W + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i]!, at(x + 1, y) + 1, at(x, y + 1) + 1, at(x + 1, y + 1) + 1.4, at(x - 1, y + 1) + 1.4);
    }
  return d;
}

function erode(bin: Uint8Array, W: number, H: number): Uint8Array {
  const out = new Uint8Array(bin.length);
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      out[i] = bin[i] && bin[i - 1] && bin[i + 1] && bin[i - W] && bin[i + W] ? 1 : 0;
    }
  return out;
}

/** Share of a region's outside border that belongs to `around` (1 = a hole fully inside it). */
export function enclosedBy(cells: Uint8Array, around: Uint8Array, W: number, H: number): number {
  let border = 0;
  let inside = 0;
  for (let i = 0; i < cells.length; i++) {
    if (!cells[i]) continue;
    const x = i % W;
    const y = (i - x) / W;
    const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1];
    for (const j of nb) {
      if (j < 0) {
        border++; // the photo's edge counts as "not enclosed"
        continue;
      }
      if (cells[j]) continue;
      border++;
      if (around[j]) inside++;
    }
  }
  return border ? inside / border : 0;
}

/**
 * Share of a region's border cells that lie on a sharp edge of the photo. Objects
 * (an air conditioner, a frame) have crisp outlines; a patch of sunlight or a
 * shadow on the same wall fades softly.
 */
export function sharpBorderShare(cells: Uint8Array, W: number, H: number, image: AutoImage): number {
  let border = 0;
  let sharp = 0;
  for (let i = 0; i < cells.length; i++) {
    if (!cells[i]) continue;
    const x = i % W;
    const y = (i - x) / W;
    const isBorder = (x > 0 && !cells[i - 1]) || (x < W - 1 && !cells[i + 1]) || (y > 0 && !cells[i - W]) || (y < H - 1 && !cells[i + W]);
    if (!isBorder) continue;
    border++;
    const x0 = Math.floor((x / W) * image.width);
    const x1 = Math.min(image.width, Math.ceil(((x + 1) / W) * image.width));
    const y0 = Math.floor((y / H) * image.height);
    const y1 = Math.min(image.height, Math.ceil(((y + 1) / H) * image.height));
    let m = 0;
    for (let yy = y0; yy < y1 && m < 30; yy++) for (let xx = x0; xx < x1; xx++) if (image.edges[yy * image.width + xx]! > m) m = image.edges[yy * image.width + xx]!;
    if (m >= 30) sharp++;
  }
  return border ? sharp / border : 0;
}

const SEEN_THROUGH: ReadonlySet<SceneKind> = new Set(["window", "door", "outdoor"]);

/**
 * Pieces of the selection mostly surrounded by windows / doors / outdoors are
 * walls seen through them (a balcony, the house opposite): drop them.
 */
export function throughOpenings(bin: Uint8Array, grid: Uint8Array, W: number, H: number): Uint8Array {
  const drop = new Uint8Array(bin.length);
  const total = W * H;
  for (const comp of components(bin, W, H)) {
    if (comp.length > 0.04 * total) continue;
    let border = 0;
    let opening = 0;
    for (const i of comp) {
      const x = i % W;
      const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W];
      for (const j of nb) {
        if (j < 0 || j >= total || bin[j]) continue;
        border++;
        if (SEEN_THROUGH.has(sceneKind(grid[j]!))) opening++;
      }
    }
    if (border > 0 && opening / border >= 0.55) for (const i of comp) drop[i] = 1;
  }
  return drop;
}

/** Map a W×H low-res cell to its index in the 256×256 logit frame. */
const frameIndex = (i: number, W: number) => Math.floor(i / W) * LOW_RES + (i % W);

/** Scene classes that are not part of a paintable surface (objects, openings, other surfaces). */
const isObjectClass = (cls: number, ofKind: boolean) => !ofKind && sceneKind(cls) !== "other";

/** Step 5 of buildAutoSurfaces (modifies `logits`). */
async function cutOutObjects(logits: Float32Array, ofKind: Uint8Array, input: AutoInput, minCells: number): Promise<void> {
  const { grid, gridW: W, gridH: H, geometry, image, decode } = input;
  if (!decode) return;
  const total = W * H;
  const suspicious = new Uint8Array(total);
  for (let i = 0; i < total; i++) suspicious[i] = logits[frameIndex(i, W)]! > 0 && isObjectClass(grid[i]!, !!ofKind[i]) ? 1 : 0;
  const dist = distanceInside(suspicious, W, H);
  const comps = components(suspicious, W, H)
    .filter((c) => c.length >= minCells && c.some((i) => dist[i]! >= 1.5))
    .sort((a, b) => b.length - a.length)
    .slice(0, 8);
  if (!comps.length) return;
  const prompts = comps.map((c) => {
    let best = c[0]!;
    for (const i of c) if (dist[i]! > dist[best]!) best = i;
    return { x: (((best % W) + 0.5) / W) * image.width, y: ((Math.floor(best / W) + 0.5) / H) * image.height, label: 1 as const };
  });
  const res = await decode(prompts.map((p) => [p]));
  comps.forEach((comp, ci) => {
    const inComp = new Uint8Array(total);
    for (const i of comp) inComp[i] = 1;
    let bestOff = -1;
    let bestScore = 0;
    for (let k = 0; k < 3; k++) {
      const off = (ci * 3 + k) * MASK;
      const bin = lowResBinary(res.logits, off, geometry).data;
      let n = 0;
      let hit = 0;
      let notKind = 0;
      for (let i = 0; i < total; i++)
        if (bin[i]) {
          n++;
          hit += inComp[i]!;
          notKind += ofKind[i] ? 0 : 1;
        }
      if (!n) continue;
      const cover = hit / comp.length;
      const precision = notKind / n;
      // SAM's object must mostly be "not wall" and explain most of the suspicious cells.
      if (cover < 0.5 || precision < 0.6) continue;
      if (cover * precision > bestScore) [bestScore, bestOff] = [cover * precision, off];
    }
    if (bestOff >= 0) {
      for (let i = 0; i < MASK; i++) {
        const v = res.logits[bestOff + i]!;
        if (v > 0 && -v < logits[i]!) logits[i] = -v;
      }
    } else {
      // SAM did not confirm: trust the scene map only where it is sure (the component's core).
      const core = erode(inComp, W, H);
      for (let i = 0; i < total; i++) if (core[i]) logits[frameIndex(i, W)] = Math.min(logits[frameIndex(i, W)]!, -3);
    }
  });
}

/* ---------- main ---------- */

export async function buildAutoSurfaces(input: AutoInput): Promise<{ kind: "wall" | "ceiling"; mask: Uint8Array }[]> {
  const { candidates, info, grid, gridW: W, gridH: H, geometry, image, decode } = input;
  const total = W * H;
  const out: { kind: "wall" | "ceiling"; mask: Uint8Array }[] = [];

  for (const [kind, classes] of [["wall", WALL_CLASSES], ["ceiling", CEILING_CLASSES]] as const) {
    const ofKind = classBinary(grid, classes);
    const purityOf = (bin: Uint8Array) => {
      let n = 0;
      let k = 0;
      for (let i = 0; i < bin.length; i++)
        if (bin[i]) {
          n++;
          k += ofKind[i]!;
        }
      return n ? k / n : 0;
    };
    let members = candidates.filter((c) => {
      const ci = info.get(c.id)!;
      return ci.kind === kind && ci.purity >= 0.6;
    });
    // Confidently something else (also the other paintable kind: no ceiling in the walls).
    const objects = candidates.filter((c) => {
      const ci = info.get(c.id)!;
      return ci.kind !== kind && ci.kind !== "other" && ci.purity >= 0.6;
    });
    // Objects hung on a wall (air conditioner, frame, clock) that the coarse scene map
    // calls "wall": a small surface lying inside a larger one, in a clearly different colour.
    {
      const labs = new Map(members.map((m) => [m.id, meanLab(m.bin, W, H, image.rgba, image.width, image.height)]));
      const onWall: AutoCandidate[] = [];
      for (const m of members) {
        if (m.area > 0.05) continue;
        const others = new Uint8Array(total);
        let host: AutoCandidate | null = null;
        for (const o of members) {
          if (o === m || o.area <= m.area) continue;
          for (let i = 0; i < total; i++) if (o.bin[i]) others[i] = 1;
          if (!host || o.area > host.area) host = o;
        }
        if (!host || enclosedBy(m.bin, others, W, H) < 0.75) continue;
        const a = labs.get(m.id);
        const b = labs.get(host.id);
        if (a && b && deltaE2000(a, b, 3) > 6 && sharpBorderShare(m.bin, W, H, image) >= 0.5) onWall.push(m);
      }
      if (onWall.length) {
        members = members.filter((m) => !onWall.includes(m));
        objects.push(...onWall);
      }
    }
    const objectMask = new Uint8Array(total);
    for (const o of objects) for (let i = 0; i < total; i++) if (o.bin[i]) objectMask[i] = 1;

    const parts: { logits: Float32Array; seed: { x: number; y: number }; bin: Uint8Array }[] = members.map((m) => ({ logits: m.logits, seed: m.seed, bin: m.bin }));
    // Colours of the walls (ceiling) found so far: a gap is filled only with something that looks alike.
    const labOf = (bin: Uint8Array) => meanLab(bin, W, H, image.rgba, image.width, image.height);
    const refLabs = members.filter((m) => m.area > 0.004).map((m) => labOf(m.bin)).filter((l): l is Lab => !!l);
    // Same paint in different light differs mostly in lightness: weigh it down (kL = 3).
    const looksLikeWall = (lab: Lab | null, limit = 10) => !lab || !refLabs.length || Math.min(...refLabs.map((r) => deltaE2000(lab, r, 3))) < limit;
    const excluded = new Uint8Array(total);
    const covered = new Uint8Array(total);
    const cover = (bin: Uint8Array) => {
      for (let i = 0; i < total; i++) if (bin[i]) covered[i] = 1;
    };
    for (const p of parts) cover(p.bin);
    cover(objectMask);

    let area = binaryArea(ofKind);
    for (const m of members) area += binaryArea(m.bin);
    if (area < 0.01 * total) continue;

    // 2. Ask SAM about wall areas nothing covered.
    const minCells = Math.max(12, Math.round(0.0015 * total));
    for (let round = 0; decode && round < 2; round++) {
      const gap = new Uint8Array(total);
      for (let i = 0; i < total; i++) gap[i] = ofKind[i] && !covered[i] ? 1 : 0;
      const dist = distanceInside(gap, W, H);
      const comps = components(gap, W, H)
        .filter((c) => c.length >= minCells)
        .sort((a, b) => b.length - a.length)
        .slice(0, 8);
      if (!comps.length) break;
      const prompts = comps.map((c) => {
        let best = c[0]!;
        for (const i of c) if (dist[i]! > dist[best]!) best = i;
        const cx = ((best % W) + 0.5) / W;
        const cy = (Math.floor(best / W) + 0.5) / H;
        return { x: cx * image.width, y: cy * image.height, label: 1 as const };
      });
      const res = await decode(prompts.map((p) => [p]));
      let accepted = 0;
      const memberMask = new Uint8Array(total);
      for (const p of parts) for (let i = 0; i < total; i++) if (p.bin[i]) memberMask[i] = 1;
      comps.forEach((comp, ci) => {
        const inComp = new Uint8Array(total);
        for (const i of comp) inComp[i] = 1;
        // A hole inside the wall is more likely an object on it: be stricter about its colour.
        const limit = enclosedBy(inComp, memberMask, W, H) >= 0.75 ? 5 : 10;
        let bestK = -1;
        let bestScore = -Infinity;
        let bestBin: Uint8Array | null = null;
        for (let k = 0; k < 3; k++) {
          const off = (ci * 3 + k) * MASK;
          const bin = lowResBinary(res.logits, off, geometry).data;
          const n = binaryArea(bin);
          if (!n) continue;
          let gapHit = 0;
          let objHit = 0;
          for (let i = 0; i < total; i++)
            if (bin[i]) {
              gapHit += inComp[i]!;
              objHit += objectMask[i]!;
            }
          const stab = lowResStats(res.logits, off, geometry).stability;
          if (purityOf(bin) < 0.7 || objHit / n > 0.1 || gapHit / comp.length < 0.3 || stab < 0.6) continue;
          // A hole inside the wall only counts as an object when its outline is crisp.
          const strict = limit < 10 && sharpBorderShare(bin, W, H, image) >= 0.5;
          if (!looksLikeWall(labOf(bin), strict ? limit : 10)) {
            // SAM sees a distinct surface here that does not look like the walls: keep it out.
            if (stab >= 0.8 && gapHit / comp.length >= 0.5) for (let i = 0; i < total; i++) if (bin[i] && inComp[i]) excluded[i] = 1;
            continue;
          }
          const score = res.scores[ci * 3 + k]! + gapHit / comp.length;
          if (score > bestScore) [bestScore, bestK, bestBin] = [score, k, bin];
        }
        if (bestK < 0 || !bestBin) return;
        const off = (ci * 3 + bestK) * MASK;
        const [sx, sy] = toModelPoints([prompts[ci]!], image.width, image.height, geometry);
        parts.push({ logits: res.logits.slice(off, off + MASK), seed: { x: sx!, y: sy! }, bin: bestBin });
        cover(bestBin);
        accepted++;
      });
      cover(excluded);
      if (!accepted) break;
    }

    // 3. What SAM could not explain: scene cells, shrunk to stay inside the wall.
    const rest = new Uint8Array(total);
    for (let i = 0; i < total; i++) rest[i] = ofKind[i] && !covered[i] ? 1 : 0;
    const restIn = erode(rest, W, H);
    for (const c of components(restIn, W, H)) {
      const bin = new Uint8Array(total);
      for (const i of c) bin[i] = 1;
      if (c.length < minCells || !looksLikeWall(labOf(bin))) for (const i of c) restIn[i] = 0;
    }

    const logits = maxLogits([binaryToLogits(restIn, W, H), ...parts.map((p) => p.logits)]);

    // 4. Cut out confident objects, drop walls seen through windows / doors.
    for (const o of objects)
      for (let i = 0; i < MASK; i++) {
        const v = o.logits[i]!;
        if (v > 0 && -v < logits[i]!) logits[i] = -v;
      }
    // 5. Where the scene map sees something else inside the selection (a chandelier
    //    hanging in front of the wall, a door, a frame…), ask SAM for that object's
    //    precise outline and cut it out.
    if (decode) await cutOutObjects(logits, ofKind, input, minCells);

    const union = new Uint8Array(total);
    for (let i = 0; i < total; i++) union[i] = logits[frameIndex(i, W)]! > 0 ? 1 : 0;
    const drop = throughOpenings(union, grid, W, H);
    for (let i = 0; i < total; i++) if (drop[i]) logits[frameIndex(i, W)] = -20;

    out.push({ kind, mask: finishMask(logits, parts.map((p) => p.seed), geometry, image) });
  }
  return out;
}
