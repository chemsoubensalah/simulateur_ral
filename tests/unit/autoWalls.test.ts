import { describe, expect, it } from "vitest";
import { components, distanceInside, enclosedBy, sharpBorderShare, throughOpenings } from "@/lib/segmentation/autoWalls";
import { edgeMap } from "@/lib/mask/refine";
import { guidedFilterMask } from "@/lib/mask/guided";
import { ADE } from "@/lib/segmentation/scene";

describe("auto walls helpers", () => {
  it("finds 4-connected components", () => {
    // two blobs
    const W = 6;
    const H = 3;
    const bin = Uint8Array.from([1, 1, 0, 0, 1, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1]);
    const comps = components(bin, W, H).map((c) => c.length).sort();
    expect(comps).toEqual([3, 5]);
  });

  it("measures how deep a cell is inside a region", () => {
    const W = 7;
    const H = 7;
    const bin = new Uint8Array(W * H).fill(1);
    const d = distanceInside(bin, W, H);
    expect(d[3 * W + 3]).toBeGreaterThan(d[1 * W + 1]!);
    expect(d[0]).toBe(1);
  });

  it("drops a wall piece seen through a window, keeps the room's wall", () => {
    const W = 60;
    const H = 40;
    const grid = new Uint8Array(W * H).fill(ADE.wall);
    // a window (x 20..39, y 10..29) with a balcony wall seen inside it (x 26..31, y 20..23)
    for (let y = 10; y <= 29; y++) for (let x = 20; x <= 39; x++) grid[y * W + x] = ADE.windowpane;
    const bin = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) bin[i] = grid[i] === ADE.wall ? 1 : 0;
    for (let y = 20; y <= 23; y++) for (let x = 26; x <= 31; x++) bin[y * W + x] = 1;
    const drop = throughOpenings(bin, grid, W, H);
    expect(drop[21 * W + 28]).toBe(1); // balcony
    expect(drop[0]).toBe(0); // room wall
  });
});

describe("guided filter", () => {
  it("moves a stair-stepped mask edge onto the photo's straight edge", () => {
    const w = 60;
    const h = 40;
    const rgba = new Uint8Array(w * h * 4);
    const mask = new Uint8Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const k = (y * w + x) * 4;
        const v = x < 30 ? 200 : 60; // photo edge at x = 30
        rgba[k] = rgba[k + 1] = rgba[k + 2] = v;
        rgba[k + 3] = 255;
        // mask edge zig-zags between x = 26 and x = 34 in 8-px steps
        const edge = Math.floor(y / 8) % 2 ? 34 : 26;
        mask[y * w + x] = x < edge ? 255 : 0;
      }
    const out = guidedFilterMask(mask, rgba, w, h, 6, 0.001);
    let wrong = 0;
    for (let y = 8; y < h - 8; y++)
      for (let x = 20; x < 40; x++) {
        const want = x < 30 ? 255 : 0;
        if (Math.abs(out[y * w + x]! - want) > 100) wrong++;
      }
    const before = (() => {
      let n = 0;
      for (let y = 8; y < h - 8; y++) for (let x = 20; x < 40; x++) if (Math.abs(mask[y * w + x]! - (x < 30 ? 255 : 0)) > 100) n++;
      return n;
    })();
    expect(wrong).toBeLessThan(before / 3);
  });
});

describe("objects hung on a wall vs light on the wall", () => {
  const W = 32;
  const H = 32;
  const size = 256;
  const make = (sharp: boolean) => {
    const rgba = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const k = (y * size + x) * 4;
        // a square 96..160 in the middle: an air conditioner (sharp) or a sunlit patch (soft)
        const d = Math.max(Math.abs(x - 128), Math.abs(y - 128));
        const t = sharp ? (d < 32 ? 1 : 0) : Math.max(0, Math.min(1, (48 - d) / 32));
        const v = 150 + 80 * t;
        rgba[k] = rgba[k + 1] = rgba[k + 2] = v;
        rgba[k + 3] = 255;
      }
    return { rgba, width: size, height: size, edges: edgeMap(rgba, size, size) };
  };
  const cells = new Uint8Array(W * H);
  for (let y = 12; y < 20; y++) for (let x = 12; x < 20; x++) cells[y * W + x] = 1;
  const wall = Uint8Array.from(cells, (v) => 1 - v);

  it("a crisp object has a sharp border, a sunlit patch does not", () => {
    expect(sharpBorderShare(cells, W, H, make(true))).toBeGreaterThan(0.5);
    expect(sharpBorderShare(cells, W, H, make(false))).toBeLessThan(0.5);
  });
  it("detects a hole fully inside the wall", () => {
    expect(enclosedBy(cells, wall, W, H)).toBe(1);
    expect(enclosedBy(wall, cells, W, H)).toBeLessThan(0.5);
  });
});
