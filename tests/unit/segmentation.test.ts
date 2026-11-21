import { describe, expect, it } from "vitest";
import {
  bestMaskIndex,
  binaryArea,
  chooseHypothesis,
  gridPoints,
  iou,
  LOW_RES,
  lowResBinary,
  lowResStats,
  removeSpecks,
  cleanLogits,
  selectCandidates,
  toModelPoints,
  upsampleLogits,
  validLowRes,
  type EncoderGeometry,
  type RawCandidate,
} from "@/lib/segmentation/postprocess";
import { decodeHalf, encodeHalf, fromHalf, packEnvelope, toHalf, unpackEnvelope } from "@/lib/segmentation/f16";

// A 1600×1200 photo is resized to 1024×768 inside the 1024² SAM input.
const G: EncoderGeometry = { originalWidth: 1600, originalHeight: 1200, reshapedWidth: 1024, reshapedHeight: 768 };

/** 256×256 logits with +5 inside the rectangle [x0,x1)×[y0,y1) (low-res coords), −5 elsewhere. */
function rectLogits(x0: number, y0: number, x1: number, y1: number): Float32Array {
  const l = new Float32Array(LOW_RES * LOW_RES).fill(-5);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) l[y * LOW_RES + x] = 5;
  return l;
}

describe("SAM post-processing", () => {
  it("maps image points to model space", () => {
    expect(validLowRes(G)).toEqual({ w: 256, h: 192 });
    expect(toModelPoints([{ x: 800, y: 600, label: 1 }], 1600, 1200, G)).toEqual([512, 384]);
    // A 2048×1536 editor image of the same photo maps identically.
    expect(toModelPoints([{ x: 1024, y: 768, label: 1 }], 2048, 1536, G)).toEqual([512, 384]);
  });

  it("upsamples only the valid region to the image size", () => {
    // Left half of the valid 256×192 area is inside.
    const l = rectLogits(0, 0, 128, 192);
    const m = upsampleLogits(l, 0, G, 1600, 1200);
    expect(m.length).toBe(1600 * 1200);
    expect(m[600 * 1600 + 100]).toBe(255);
    expect(m[600 * 1600 + 1500]).toBe(0);
    expect(m[1199 * 1600 + 100]).toBe(255); // padding rows (y ≥ 192) are not used
    // The boundary sits in the middle and is crisp (monotonic, ≤ 2 px transition).
    const row = [...m.subarray(600 * 1600 + 780, 600 * 1600 + 820)];
    expect(row[0]).toBe(255);
    expect(row.at(-1)).toBe(0);
    for (let i = 1; i < row.length; i++) expect(row[i]!).toBeLessThanOrEqual(row[i - 1]!);
    expect(row.filter((v) => v > 0 && v < 255).length).toBeLessThanOrEqual(2);
    const edge = row.findIndex((v) => v < 128) + 780;
    expect(Math.abs(edge - 800)).toBeLessThanOrEqual(4);
  });

  it("computes area, stability and bbox", () => {
    const s = lowResStats(rectLogits(64, 48, 192, 144), 0, G);
    expect(s.area).toBeCloseTo((128 * 96) / (256 * 192), 5);
    expect(s.stability).toBe(1);
    expect(s.bbox).toEqual({ x0: 0.25, y0: 0.25, x1: 0.75, y1: 0.75 });
  });

  it("picks the best-scoring hypothesis", () => {
    expect(bestMaskIndex([0.8, 0.95, 0.9])).toBe(1);
    expect(bestMaskIndex([0, 0, 0, 0.1, 0.2, 0.9], 3)).toBe(2);
  });

  it("removes small disconnected specks but keeps seeded components", () => {
    const l = rectLogits(10, 10, 110, 110); // main blob 100×100
    for (let y = 150; y < 153; y++) for (let x = 200; x < 203; x++) l[y * LOW_RES + x] = 5; // 9 px speck
    const clean = removeSpecks(l, 0, G, []);
    expect(binaryArea(lowResBinary(clean, 0, G).data)).toBe(100 * 100);
    // A seed inside the speck keeps it (user tapped there).
    const kept = removeSpecks(l, 0, G, [{ x: 201 * 4, y: 151 * 4 }]);
    expect(binaryArea(lowResBinary(kept, 0, G).data)).toBe(100 * 100 + 9);
  });

  it("cleanLogits resolves uncertain checkerboard regions decisively", () => {
    // Solid mask on the left; a noisy ±0.3 checkerboard region on the right (SAM unsure).
    const l = rectLogits(0, 0, 100, 192);
    for (let y = 20; y < 120; y++) for (let x = 100; x < 160; x++) l[y * LOW_RES + x] = (x + y) % 2 ? 0.3 : -0.3;
    const c = cleanLogits(l, 0, G, []);
    let uncertain = 0;
    // Every cell is decided well outside the soft zone (±0.25): no semi-transparent blotches.
    for (let y = 0; y < 192; y++) for (let x = 0; x < 256; x++) if (Math.abs(c[y * LOW_RES + x]!) < 0.5) uncertain++;
    expect(uncertain).toBe(0);
    const up = upsampleLogits(c, 0, G, 1600, 1200);
    let partial = 0;
    for (let i = 0; i < up.length; i += 7) if (up[i]! > 10 && up[i]! < 245) partial++;
    expect(partial / (up.length / 7)).toBeLessThan(0.01);
  });

  it("cleanLogits fills small holes and drops small islands, keeping seeded ones", () => {
    const l = rectLogits(10, 10, 110, 110);
    for (let y = 50; y < 54; y++) for (let x = 50; x < 54; x++) l[y * LOW_RES + x] = -5; // 16 px hole
    for (let y = 150; y < 153; y++) for (let x = 200; x < 203; x++) l[y * LOW_RES + x] = 5; // 9 px island
    const c = cleanLogits(l, 0, G, []);
    expect(c[52 * LOW_RES + 52]).toBeGreaterThan(0);
    expect(c[151 * LOW_RES + 201]).toBeLessThan(0);
    const seeded = cleanLogits(l, 0, G, [{ x: 201 * 4, y: 151 * 4 }]);
    expect(seeded[151 * LOW_RES + 201]).toBeGreaterThan(0);
  });

  it("chooses the hypothesis matching the surface under the tap", () => {
    const wall = lowResBinary(rectLogits(0, 0, 128, 192), 0, G).data;
    const house = lowResBinary(rectLogits(0, 0, 256, 192), 0, G).data;
    const patch = lowResBinary(rectLogits(0, 0, 20, 20), 0, G).data;
    const hyps = [
      { score: 0.97, stability: 0.9, bin: house },
      { score: 0.9, stability: 0.9, bin: wall },
      { score: 0.85, stability: 0.9, bin: patch },
    ];
    expect(chooseHypothesis(hyps, [])).toBe(0); // no analysis yet: best score (equal stability)
    // A slightly lower score with much better stability wins (fewer fragments).
    expect(chooseHypothesis([{ score: 0.985, stability: 0.66, bin: house }, { score: 0.958, stability: 0.96, bin: wall }], [])).toBe(1);
    expect(chooseHypothesis(hyps, [wall])).toBe(1); // atomic surface known: the wall
    expect(chooseHypothesis(hyps, [house, wall])).toBe(1); // most specific surface wins
  });

  it("selects atomic candidates: thresholds, NMS and union removal", () => {
    const mk = (index: number, l: Float32Array, score = 0.95): RawCandidate => {
      const st = lowResStats(l, 0, G);
      return { index, score, stability: st.stability, area: st.area, bin: lowResBinary(l, 0, G).data };
    };
    const left = rectLogits(0, 0, 128, 192);
    const right = rectLogits(128, 0, 256, 192);
    const leftDup = rectLogits(0, 0, 126, 192);
    const both = rectLogits(0, 0, 256, 192); // union of left+right, should be removed
    const tiny = rectLogits(0, 0, 5, 5); // below min area
    const raw = [mk(0, left), mk(1, right, 0.93), mk(2, leftDup, 0.9), mk(3, both, 0.99), mk(4, tiny), mk(5, rectLogits(10, 10, 60, 60), 0.5)];
    const kept = selectCandidates(raw, { minScore: 0.86, minStability: 0.88, minArea: 0.012, maxArea: 1, nmsIou: 0.7, maxCount: 14 });
    expect(kept.map((k) => k.index).sort()).toEqual([0, 1]);
    expect(iou(raw[0]!.bin, raw[2]!.bin)).toBeGreaterThan(0.9);
  });

  it("builds a regular prompt grid", () => {
    const g = gridPoints(4, 2);
    expect(g).toHaveLength(8);
    expect(g[0]).toEqual({ x: 0.125, y: 0.25 });
    expect(g.at(-1)).toEqual({ x: 0.875, y: 0.75 });
  });
});

describe("float16 transport", () => {
  it("round-trips typical embedding values within half precision", () => {
    for (const v of [0, 1, -1, 0.15196600556373596, -3.25, 1e-3, 65504, -0.000061]) {
      const back = fromHalf(toHalf(v));
      expect(Math.abs(back - v)).toBeLessThanOrEqual(Math.max(Math.abs(v) * 1e-3, 1e-7));
    }
    expect(fromHalf(toHalf(1e6))).toBe(Infinity);
    const data = Float32Array.from({ length: 1000 }, (_, i) => Math.sin(i) * 3);
    const back = decodeHalf(encodeHalf(data));
    for (let i = 0; i < data.length; i++) expect(Math.abs(back[i]! - data[i]!)).toBeLessThan(3e-3);
  });

  it("packs and unpacks the binary envelope with 2-byte aligned payload", () => {
    const payload = new Uint8Array(new Uint16Array([1, 2, 65535]).buffer);
    const env = packEnvelope({ a: 1, s: "x" }, payload);
    const { header, payload: p } = unpackEnvelope<{ a: number; s: string }>(env.buffer as ArrayBuffer);
    expect(header).toEqual({ a: 1, s: "x" });
    expect(p.byteOffset % 2).toBe(0);
    expect([...new Uint16Array(p.buffer, p.byteOffset, 3)]).toEqual([1, 2, 65535]);
  });
});
