import { describe, expect, it } from "vitest";
import { dedupe, instanceAt, maskSize, roomSurfaces, unionMask, type Sam3Mask } from "@/lib/segmentation/sam3";
import { ADE } from "@/lib/segmentation/scene";
import { rleDecode, rleEncode } from "@/lib/mask/rle";

const W = 40;
const H = 30;
function rect(kind: Sam3Mask["kind"], x0: number, y0: number, x1: number, y1: number, score = 0.9): Sam3Mask {
  const mask = new Uint8Array(W * H);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) mask[y * W + x] = 255;
  return { kind, score, width: W, height: H, mask };
}

describe("SAM 3 walls on the client", () => {
  it("mask grid keeps the photo's aspect ratio", () => {
    expect(maskSize(2048, 1536)).toEqual({ width: 768, height: 576 });
    expect(maskSize(400, 300)).toEqual({ width: 400, height: 300 });
  });

  it("transports masks compactly (RLE round trip)", () => {
    const m = rect("wall", 5, 5, 30, 20).mask;
    const enc = rleEncode(m);
    expect(enc.length).toBeLessThan(200);
    expect(Buffer.compare(Buffer.from(rleDecode(enc, m.length)), Buffer.from(m))).toBe(0);
  });

  it("drops duplicates, keeps the better one", () => {
    const a = rect("wall", 0, 0, 20, 30, 0.95);
    const b = rect("wall", 0, 0, 20, 29, 0.6);
    const c = rect("wall", 20, 0, 40, 30, 0.7);
    expect(dedupe([b, a, c]).map((m) => m.score)).toEqual([0.95, 0.7]);
  });

  it("a tap selects the wall under it", () => {
    const left = rect("wall", 0, 0, 20, 30);
    const right = rect("wall", 20, 0, 40, 30);
    expect(instanceAt([left, right], 300, 100, 400, 300)).toBe(right);
    expect(instanceAt([left, right], 50, 100, 400, 300)).toBe(left);
  });

  it("removes a wall seen through a window and the ceiling from the walls", () => {
    // Scene: wall everywhere, a window in the middle (x 15..25, y 8..22).
    const classes = new Uint8Array(W * H).fill(ADE.wall);
    for (let y = 8; y < 22; y++) for (let x = 15; x < 25; x++) classes[y * W + x] = ADE.windowpane;
    const scene = { width: W, height: H, classes };
    const room = rect("wall", 0, 5, 40, 30);
    for (let y = 8; y < 22; y++) for (let x = 15; x < 25; x++) room.mask[y * W + x] = 0;
    const balcony = rect("wall", 17, 12, 23, 18, 0.6); // seen through the window
    const ceiling = rect("ceiling", 0, 0, 40, 6);
    const out = roomSurfaces([room, balcony, ceiling], scene);
    expect(out).toHaveLength(2);
    const wall = out.find((m) => m.kind === "wall")!;
    expect(wall.mask[5 * W + 10]).toBe(0); // overlap with the ceiling removed
    expect(wall.mask[10 * W + 5]).toBe(255);
  });

  it("joins instances into one mask", () => {
    const u = unionMask([rect("wall", 0, 0, 10, 10), rect("wall", 30, 0, 40, 10)])!;
    expect(u.mask[5 * W + 5]).toBe(255);
    expect(u.mask[5 * W + 35]).toBe(255);
    expect(u.mask[5 * W + 20]).toBe(0);
  });
});
