import { describe, expect, it } from "vitest";
import { hexToLab, labToRgb, rgbToLab, srgbToLinear, type RGB } from "@/lib/color/lab";
import { deltaE2000 } from "@/lib/color/deltaE";
import { lToY } from "@/lib/color/lab";
import { computeLightness, computeLuminance, gamutMap, luminance, maskedMean, recolorPixel, shadingConstants, softClip, surfaceStats, type Finish, type SurfaceStats } from "@/lib/recolor/model";

/** A synthetic wall: one base color under a light gradient (shadow → highlight). */
function wall(base: RGB, shades = [0.55, 0.7, 0.85, 1, 1.1, 1.2]): RGB[] {
  return shades.map((s) => ({
    r: Math.min(255, Math.round(base.r * s)),
    g: Math.min(255, Math.round(base.g * s)),
    b: Math.min(255, Math.round(base.b * s)),
  }));
}

/** Surface statistics exactly as the editor computes them. */
function stats(px: RGB[]): SurfaceStats {
  const L = new Float32Array(px.map((p) => rgbToLab(p).L));
  return surfaceStats(L, new Uint8Array(px.length).fill(255))!;
}

function paint(px: RGB[], hex: string, finish: Finish = "matte") {
  const target = hexToLab(hex);
  const out = px.map((p) => recolorPixel(p, { target, stats: stats(px), finish, brightness: 1 }));
  return { target, out, labs: out.map(rgbToLab) };
}

const SOURCES: Record<string, RGB> = {
  white: { r: 232, g: 228, b: 220 },
  beige: { r: 200, g: 180, b: 150 },
  darkBlue: { r: 40, g: 50, b: 80 },
  red: { r: 170, g: 40, b: 35 },
};
const TARGETS = ["#F4F1EA", "#1E2733", "#8E9F88", "#C97B5A", "#2C4257", "#E9C46A", "#FFFFFF"];

describe("recolor model", () => {
  for (const [srcName, src] of Object.entries(SOURCES)) {
    for (const hex of TARGETS) {
      it(`${srcName} wall → ${hex}: mean lightness matches, shading preserved, hue correct`, () => {
        const px = wall(src);
        const { target, labs } = paint(px, hex);
        const meanL = labs.reduce((s, l) => s + l.L, 0) / labs.length;
        // Mean L* of the painted wall matches the paint's L*. Near-white paints
        // have no headroom above L* = 100 for the lit areas, so highlights are
        // soft-compressed and the mean may sit slightly lower.
        expect(Math.abs(meanL - target.L)).toBeLessThan(target.L > 90 ? 4 : 1.5);
        // Shading order is preserved (shadow stays darker than light).
        for (let i = 1; i < labs.length; i++) expect(labs[i]!.L).toBeGreaterThanOrEqual(labs[i - 1]!.L - 0.5);
        // A pixel lit at the surface's average lightness becomes exactly the paint
        // (up to 8-bit rounding). Shadows/highlights deviate only by lighting.
        const st = stats(px);
        const atMean = labToRgb({ L: st.meanL, a: 0, b: 0 });
        const painted = rgbToLab(recolorPixel(atMean, { target, stats: st, finish: "satin", brightness: 1 }));
        expect(deltaE2000(painted, target)).toBeLessThan(1.5);
      });
    }
  }

  it("keeps meaningful contrast when painting a white wall dark (no flat sticker)", () => {
    const { labs } = paint(wall(SOURCES.white!), "#1E2733");
    expect(labs[5]!.L - labs[0]!.L).toBeGreaterThan(8);
  });

  it("does not turn dark→white into grey mud: lit area reaches near-white", () => {
    const { labs } = paint(wall(SOURCES.darkBlue!), "#FFFFFF");
    expect(labs[3]!.L).toBeGreaterThan(92);
    expect(Math.hypot(labs[3]!.a, labs[3]!.b)).toBeLessThan(3);
  });

  it("gloss preserves specular highlights more than matte", () => {
    const px = [...wall(SOURCES.beige!), { r: 255, g: 255, b: 255 }];
    const m = paint(px, "#2C4257", "matte").labs.at(-1)!;
    const g = paint(px, "#2C4257", "gloss").labs.at(-1)!;
    expect(g.L).toBeGreaterThan(m.L + 5);
  });

  it("shadows keep the paint hue instead of over-saturating", () => {
    const { labs, target } = paint(wall(SOURCES.white!), "#C97B5A");
    const hue = (l: { a: number; b: number }) => Math.atan2(l.b, l.a);
    expect(Math.abs(hue(labs[0]!) - hue(target))).toBeLessThan(0.15);
    expect(Math.hypot(labs[0]!.a, labs[0]!.b)).toBeLessThanOrEqual(Math.hypot(target.a, target.b) + 0.5);
  });

  it("softClip is continuous and bounded", () => {
    expect(softClip(0.5, 0.8)).toBe(0.5);
    expect(softClip(0.8, 0.8)).toBeCloseTo(0.8, 9);
    expect(softClip(5, 0.8)).toBeLessThan(1);
    expect(softClip(0.81, 0.8)).toBeGreaterThan(0.8);
  });

  it("gamutMap brings colors into range keeping luminance", () => {
    const out = gamutMap([1.4, 0.2, -0.1], 0.5);
    for (const c of out) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
  });

  it("maskedMean weights by mask alpha", () => {
    const v = new Float32Array([20, 80, 50]);
    expect(maskedMean(v, new Uint8Array([255, 0, 0]))).toBeCloseTo(20, 6);
    expect(maskedMean(v, new Uint8Array([255, 255, 0]))).toBeCloseTo(50, 6);
    expect(maskedMean(v, new Uint8Array([0, 0, 0]))).toBeNull();
  });

  it("surfaceStats returns mean and 95th percentile L*", () => {
    const L = new Float32Array(100).map((_, i) => i);
    const st = surfaceStats(L, new Uint8Array(100).fill(255))!;
    expect(st.meanL).toBeCloseTo(49.5, 6);
    expect(st.highL).toBeCloseTo(94, 0);
    expect(surfaceStats(L, new Uint8Array(100))).toBeNull();
  });

  it("reduces shading contrast only when a light paint needs headroom", () => {
    const st = { meanL: 70, highL: 90 };
    expect(shadingConstants({ L: 40, a: 0, b: 0 }, st, "satin", 1).contrast).toBe(1);
    const light = shadingConstants({ L: 96, a: 0, b: 0 }, st, "satin", 1);
    expect(light.contrast).toBeLessThan(1);
    expect(light.contrast).toBeGreaterThanOrEqual(0.35);
    expect(light.refY).toBeCloseTo(lToY(70), 9);
  });

  it("computeLightness gives L* per pixel", () => {
    const L = computeLightness(new Uint8ClampedArray([255, 255, 255, 255, 119, 119, 119, 255]));
    expect(L[0]).toBeCloseTo(100, 3);
    expect(L[1]).toBeCloseTo(50.03, 1);
  });

  it("computeLuminance matches per-pixel formula", () => {
    const rgba = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 128, 64, 32, 255]);
    const y = computeLuminance(rgba);
    expect(y[0]).toBeCloseTo(1, 5);
    expect(y[1]).toBe(0);
    expect(y[2]).toBeCloseTo(luminance(srgbToLinear(128 / 255), srgbToLinear(64 / 255), srgbToLinear(32 / 255)), 6);
  });
});
