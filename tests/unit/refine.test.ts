import { describe, expect, it } from "vitest";
import { defaultRefineOptions, edgeMap, growMask, refineMask } from "@/lib/mask/refine";

type RGB = [number, number, number];

/** Build a w×h photo from a function giving the colour per pixel. */
function photo(w: number, h: number, color: (x: number, y: number) => RGB, noise = 0): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  let s = 7;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5) * noise;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b] = color(x, y);
      const n = rnd();
      out.set([r + n, g + n, b + n, 255], (y * w + x) * 4);
    }
  return out;
}

const OPTS = defaultRefineOptions(2048, 1536);
const W = 80;
const H = 40;
const WALL: RGB = [200, 190, 170];
const SOFA: RGB = [60, 70, 90];

describe("edge refinement (two-colour unmixing)", () => {
  it("snaps a soft, misplaced boundary onto the real edge", () => {
    // Real edge at x = 40; the coarse mask fades out between x = 30 and 38 (too early, like SAM).
    const rgba = photo(W, H, (x) => (x < 40 ? WALL : SOFA), 6);
    const coarse = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) coarse[y * W + x] = x < 30 ? 255 : x >= 38 ? 0 : Math.round(255 * (1 - (x - 30) / 8));
    const out = refineMask(coarse, rgba, W, H, OPTS);
    const row = 20 * W;
    for (let x = 25; x < 39; x++) expect(out[row + x]).toBeGreaterThanOrEqual(230); // wall fully selected up to the edge
    for (let x = 41; x < 60; x++) expect(out[row + x]).toBeLessThanOrEqual(25); // sofa untouched
  });

  it("gives partial coverage to a mixed (anti-aliased) edge pixel", () => {
    const rgba = photo(W, H, (x) => (x < 40 ? WALL : x === 40 ? [130, 130, 130] : SOFA));
    const coarse = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) coarse[y * W + x] = x < 36 ? 255 : x > 44 ? 0 : 128;
    const out = refineMask(coarse, rgba, W, H, OPTS);
    const v = out[20 * W + 40]!;
    expect(v).toBeGreaterThan(80);
    expect(v).toBeLessThan(180);
  });

  it("keeps a thin window trim out of the wall selection", () => {
    // Wall | white trim (8 px) | blue glass. Coarse mask is blurry across the trim.
    const rgba = photo(W, H, (x) => (x < 40 ? [233, 220, 195] : x < 48 ? [246, 244, 239] : [120, 160, 200]), 6);
    const coarse = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) coarse[y * W + x] = x < 36 ? 255 : x >= 46 ? 0 : Math.round(255 * (1 - (x - 36) / 10));
    const out = refineMask(coarse, rgba, W, H, OPTS);
    const row = 20 * W;
    for (let x = 30; x < 39; x++) expect(out[row + x]).toBeGreaterThanOrEqual(200);
    for (let x = 41; x < 48; x++) expect(out[row + x]).toBeLessThanOrEqual(60);
  });

  it("leaves low-contrast boundaries as they were", () => {
    const rgba = photo(W, H, () => WALL, 4);
    const coarse = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) coarse[y * W + x] = x < 35 ? 255 : x > 45 ? 0 : 128;
    const out = refineMask(coarse, rgba, W, H, OPTS);
    expect(out[20 * W + 40]).toBe(128);
  });

  it("edge map highlights colour edges only", () => {
    const rgba = photo(W, H, (x) => (x < 40 ? WALL : SOFA));
    const e = edgeMap(rgba, W, H);
    expect(e[20 * W + 39]).toBeGreaterThan(100);
    expect(e[20 * W + 20]).toBe(0);
  });

  it("growMask closes a gap at a faint boundary but stops at a visible edge and other colours", () => {
    // Wall (x < 50) next to a slightly lighter ceiling (x ≥ 50) separated by a dark crease at x = 50.
    const rgba = photo(W, H, (x) => (x === 50 ? [150, 150, 150] : x < 50 ? [200, 198, 192] : [214, 213, 210]), 2);
    const mask = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < 40; x++) mask[y * W + x] = 255; // SAM stopped 10 px early
    const out = growMask(mask, rgba, W, H, edgeMap(rgba, W, H), { maxDist: 12 });
    const row = 20 * W;
    for (let x = 40; x < 48; x++) expect(out[row + x], `x=${x}`).toBe(255); // gap closed
    for (let x = 51; x < 70; x++) expect(out[row + x], `x=${x}`).toBe(0); // did not cross the crease
    // Never grows into a clearly different colour.
    const sofa = photo(W, H, (x) => (x < 40 ? WALL : SOFA), 2);
    const out2 = growMask(mask, sofa, W, H, edgeMap(sofa, W, H), { maxDist: 12 });
    expect(out2[row + 45]).toBe(0);
  });

  it("growMask is bounded by maxDist on uniform colour", () => {
    const rgba = photo(W, H, () => WALL, 2);
    const mask = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < 20; x++) mask[y * W + x] = 255;
    const out = growMask(mask, rgba, W, H, edgeMap(rgba, W, H), { maxDist: 6 });
    const row = 20 * W;
    expect(out[row + 24]).toBe(255);
    expect(out[row + 30]).toBe(0);
  });
});
