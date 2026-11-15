import { describe, expect, it } from "vitest";
import { blurMask, diffRect, maskCoverage, mergeCoverage, stampDisc, strokeSegment } from "@/lib/mask/ops";
import { MaskHistory } from "@/lib/mask/history";

const W = 64;
const H = 48;

describe("mask ops", () => {
  it("stamps a filled anti-aliased disc and erases it", () => {
    const m = new Uint8Array(W * H);
    const r = stampDisc(m, W, H, 32, 24, 10, "add", 1);
    expect(m[24 * W + 32]).toBe(255);
    expect(m[0]).toBe(0);
    expect(r.w).toBeGreaterThan(19);
    const area = maskCoverage(m) * W * H;
    expect(area).toBeGreaterThan(Math.PI * 100 * 0.9);
    expect(area).toBeLessThan(Math.PI * 100 * 1.1);
    stampDisc(m, W, H, 32, 24, 12, "erase", 1);
    expect(maskCoverage(m)).toBe(0);
  });

  it("strokes a continuous line between points", () => {
    const m = new Uint8Array(W * H);
    strokeSegment(m, W, H, 5, 10, 58, 10, 3, "add");
    for (let x = 6; x < 57; x++) expect(m[10 * W + x]).toBe(255);
  });

  it("clips at image borders", () => {
    const m = new Uint8Array(W * H);
    const r = stampDisc(m, W, H, 0, 0, 8, "add");
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
    expect(m[0]).toBe(255);
  });

  it("blur softens edges but keeps the interior solid", () => {
    const m = new Uint8Array(W * H);
    for (let y = 10; y < 40; y++) for (let x = 10; x < 50; x++) m[y * W + x] = 255;
    const b = blurMask(m, W, H, 2);
    expect(b[25 * W + 30]).toBe(255);
    expect(b[25 * W + 10]).toBeGreaterThan(0);
    expect(b[25 * W + 10]).toBeLessThan(255);
    expect(Math.abs(maskCoverage(b) - maskCoverage(m))).toBeLessThan(0.01);
  });

  it("merges polygon coverage in add and erase modes", () => {
    const m = new Uint8Array([0, 100, 255, 255]);
    mergeCoverage(m, new Uint8Array([200, 50, 0, 255]), "add");
    expect([...m]).toEqual([200, 100, 255, 255]);
    mergeCoverage(m, new Uint8Array([0, 0, 55, 255]), "erase");
    expect([...m]).toEqual([200, 100, 200, 0]);
  });

  it("diffRect finds the changed bounding box", () => {
    const a = new Uint8Array(W * H);
    const b = a.slice();
    b[5 * W + 7] = 1;
    b[9 * W + 3] = 1;
    expect(diffRect(a, b, W, H)).toEqual({ x: 3, y: 5, w: 5, h: 5 });
    expect(diffRect(a, a, W, H).w).toBe(0);
  });
});

describe("MaskHistory", () => {
  it("undoes and redoes patches", () => {
    const mask = new Uint8Array(W * H);
    const masks = new Map([["s1", mask]]);
    const h = new MaskHistory();
    const before = mask.slice();
    const rect = stampDisc(mask, W, H, 20, 20, 5, "add");
    const after = mask.slice();
    h.record("s1", before, mask, W, rect);
    expect(h.canUndo).toBe(true);
    h.undo((id) => masks.get(id), W);
    expect(maskCoverage(mask)).toBe(0);
    expect(h.canRedo).toBe(true);
    h.redo((id) => masks.get(id), W);
    expect([...mask]).toEqual([...after]);
  });

  it("drops history of deleted surfaces and bounds memory", () => {
    const h = new MaskHistory(1000);
    const a = new Uint8Array(W * H);
    const b = a.slice().fill(1);
    for (let i = 0; i < 5; i++) h.record("s1", a, b, W, { x: 0, y: 0, w: 20, h: 20 });
    h.dropSurface("s1");
    expect(h.canUndo).toBe(false);
  });
});
