import { describe, expect, it } from "vitest";
import { hexToLab, lToY, rgbToLab, srgbToLinear, yToL } from "@/lib/color/lab";
import { deltaE2000 } from "@/lib/color/deltaE";
import { recolorPixel, shadingRatio, surfaceStats } from "@/lib/recolor/model";
import { CLEANUP, estimateShading } from "@/lib/recolor/shading";
import { estimateLighting, lightingGains } from "@/lib/recolor/lighting";

/** L*·2.55 bytes of a W×H wall: horizontal light gradient plus a dark stain. */
function stainedWall(W: number, H: number) {
  const L = new Uint8Array(W * H);
  const light = (x: number) => 55 + (25 * x) / W; // L* 55 → 80 across the wall
  const stain = (x: number, y: number) => Math.hypot(x - W / 2, y - H / 2) < W / 40; // 5 % wide
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let l = light(x);
      if (stain(x, y)) l -= 18;
      L[y * W + x] = Math.round(l * 2.55);
    }
  return { L, light, stain };
}

describe("estimateShading (lighting of a surface)", () => {
  it("follows the light gradient and ignores a stain", () => {
    const W = 400;
    const H = 300;
    const { L, light } = stainedWall(W, H);
    const mask = new Uint8Array(W * H).fill(255);
    const map = estimateShading(L, mask, W, H, 4)!;
    expect(map.width).toBe(100);
    expect(map.height).toBe(75);
    const at = (x: number, y: number) => map.data[Math.floor(y / 4) * map.width + Math.floor(x / 4)]! / 2.55;
    // Away from the borders the map tracks the gradient within ~1.5 L*.
    expect(Math.abs(at(100, 150) - light(100))).toBeLessThan(1.5);
    expect(Math.abs(at(300, 150) - light(300))).toBeLessThan(1.5);
    // At the stain's centre the estimate stays close to the surrounding light (stain is −18 L*).
    expect(light(200) - at(200, 150)).toBeLessThan(6);
  });

  it("only uses pixels under the mask", () => {
    const W = 200;
    const H = 100;
    const L = new Uint8Array(W * H);
    const mask = new Uint8Array(W * H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const wall = x < W / 2;
        L[y * W + x] = Math.round((wall ? 70 : 20) * 2.55); // dark sofa next to the wall
        mask[y * W + x] = wall ? 255 : 0;
      }
    const map = estimateShading(L, mask, W, H, 4)!;
    // Right next to the edge, inside the wall, the lighting is still the wall's.
    expect(map.data[12 * map.width + 23]! / 2.55).toBeCloseTo(70, 0);
  });

  it("returns null for an empty mask", () => {
    expect(estimateShading(new Uint8Array(100), new Uint8Array(100), 10, 10)).toBeNull();
  });
});

describe("hide stains and defects", () => {
  const target = hexToLab("#d9cfb8"); // a light beige paint
  const stats = surfaceStats(new Float32Array([60, 65, 70, 75]), new Uint8Array(4).fill(255))!;
  const refY = lToY(stats.meanL);

  it("without cleanup the shading ratio is Y / refY", () => {
    expect(shadingRatio(0.2, 0.25)).toBeCloseTo(0.8, 6);
  });

  it("a stain almost disappears, the light gradient stays", () => {
    const lightY = lToY(65);
    const stainY = lToY(50); // a dark stain on a wall lit at L* 65
    const px = (Y: number) => {
      const v = Math.round(255 * Math.pow(Y, 1 / 2.2));
      return { r: v, g: v, b: v };
    };
    const plain = recolorPixel(px(lightY), { target, stats, finish: "matte", brightness: 1 });
    const stained = recolorPixel(px(stainY), { target, stats, finish: "matte", brightness: 1 });
    const cleaned = recolorPixel(px(stainY), {
      target,
      stats,
      finish: "matte",
      brightness: 1,
      cleanup: { light: lightY, local: stainY, ...CLEANUP },
    });
    const dStained = deltaE2000(rgbToLab(stained), rgbToLab(plain));
    const dCleaned = deltaE2000(rgbToLab(cleaned), rgbToLab(plain));
    expect(dStained).toBeGreaterThan(8); // the classic recolor shows the stain
    expect(dCleaned).toBeLessThan(dStained / 4); // cleanup hides most of it
    expect(dCleaned).toBeLessThan(3);

    // A pixel in the shade (light gradient, not a stain) stays darker.
    const shadeY = lToY(55);
    const shade = recolorPixel(px(shadeY), { target, stats, finish: "matte", brightness: 1, cleanup: { light: shadeY, local: shadeY, ...CLEANUP } });
    expect(rgbToLab(plain).L - rgbToLab(shade).L).toBeGreaterThan(6);
  });

  it("keeps fine texture (plaster grain) mostly intact", () => {
    const light = lToY(65);
    const local = light;
    const grain = light * 1.1;
    const r = shadingRatio(grain, refY, { light, local, ...CLEANUP }) / shadingRatio(light, refY, { light, local, ...CLEANUP });
    expect(r).toBeGreaterThan(1.07);
    expect(r).toBeLessThan(1.1);
  });

  it("is identical to the classic recolor on a perfectly even wall", () => {
    const Y = refY;
    expect(shadingRatio(Y, refY, { light: Y, local: Y, ...CLEANUP })).toBeCloseTo(shadingRatio(Y, refY), 6);
  });
});

describe("room lighting", () => {
  /** A photo whose bright greys (ceiling) are lit by a warm lamp, plus a genuinely beige wall. */
  function photo(cast: [number, number, number]) {
    const W = 200;
    const H = 200;
    const rgba = new Uint8ClampedArray(W * H * 4);
    const enc = (v: number) => Math.round(255 * Math.pow(Math.min(1, v), 1 / 2.4));
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const k = (y * W + x) * 4;
        const ceiling = y < H / 3;
        const base = ceiling ? [0.8, 0.8, 0.8] : [0.45, 0.36, 0.25]; // white ceiling / beige wall
        rgba[k] = enc(base[0]! * cast[0]);
        rgba[k + 1] = enc(base[1]! * cast[1]);
        rgba[k + 2] = enc(base[2]! * cast[2]);
        rgba[k + 3] = 255;
      }
    return { rgba, W, H };
  }

  it("finds no cast in a neutrally lit room with beige walls", () => {
    const { rgba, W, H } = photo([1, 1, 1]);
    const { cast } = estimateLighting(rgba, W, H);
    for (const c of cast) expect(c).toBeCloseTo(1, 1);
  });

  it("detects a warm lamp (damped) and neutralises it in daylight mode", () => {
    const { rgba, W, H } = photo([1.15, 1, 0.75]);
    const est = estimateLighting(rgba, W, H);
    expect(est.cast[0]).toBeGreaterThan(1.03);
    expect(est.cast[2]).toBeLessThan(0.92);
    const day = lightingGains(est, "day");
    expect(day.image[0]).toBeLessThan(1);
    expect(day.image[2]).toBeGreaterThan(1);
    expect(day.paint).toEqual([1, 1, 1]);
    // As photographed, paint takes on part of the cast.
    const photoGains = lightingGains(est, "photo");
    expect(photoGains.image).toEqual([1, 1, 1]);
    expect(photoGains.paint[0]).toBeGreaterThan(1);
    expect(photoGains.paint[0]).toBeLessThan(est.cast[0]);
  });

  it("evening light warms and dims the paint", () => {
    const g = lightingGains({ cast: [1, 1, 1] }, "evening");
    expect(g.paint[0]).toBeGreaterThan(g.paint[2]);
    const lum = 0.2126729 * g.paint[0] + 0.7151522 * g.paint[1] + 0.072175 * g.paint[2];
    expect(lum).toBeLessThan(0.95);
    const white = recolorPixel({ r: 200, g: 200, b: 200 }, {
      target: hexToLab("#f4f4f4"),
      stats: { meanL: yToL(srgbToLinear(200 / 255)), highL: 82 },
      finish: "matte",
      brightness: 1,
      paintGain: g.paint,
    });
    expect(white.r).toBeGreaterThan(white.b + 10);
  });
});
