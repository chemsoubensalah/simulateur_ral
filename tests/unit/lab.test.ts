import { describe, expect, it } from "vitest";
import { hexToLab, hexToRgb, labToLch, labToRgb, lchToLab, lToY, rgbToHex, rgbToLab, yToL } from "@/lib/color/lab";

describe("sRGB → CIELAB (D65)", () => {
  const cases: [string, [number, number, number]][] = [
    ["#FFFFFF", [100, 0, 0]],
    ["#000000", [0, 0, 0]],
    ["#FF0000", [53.2408, 80.0925, 67.2032]],
    ["#00FF00", [87.7347, -86.1827, 83.1793]],
    ["#0000FF", [32.297, 79.1875, -107.8602]],
    ["#777777", [50.0325, 0, 0]],
  ];
  it.each(cases)("%s", (hex, [L, a, b]) => {
    const lab = hexToLab(hex);
    expect(lab.L).toBeCloseTo(L, 1);
    expect(lab.a).toBeCloseTo(a, 1);
    expect(lab.b).toBeCloseTo(b, 1);
  });

  it("round-trips every 8-bit color on a coarse grid exactly", () => {
    for (let r = 0; r <= 255; r += 17)
      for (let g = 0; g <= 255; g += 17)
        for (let b = 0; b <= 255; b += 17) {
          expect(labToRgb(rgbToLab({ r, g, b }))).toEqual({ r, g, b });
        }
  });

  it("converts L* <-> Y consistently", () => {
    for (const L of [0, 1, 5, 8, 20, 50, 75, 99, 100]) expect(yToL(lToY(L))).toBeCloseTo(L, 6);
    expect(lToY(100)).toBeCloseTo(1, 6);
  });

  it("LCh round-trip", () => {
    const lab = { L: 40, a: -20, b: 35 };
    const back = lchToLab(labToLch(lab));
    expect(back.a).toBeCloseTo(lab.a, 9);
    expect(back.b).toBeCloseTo(lab.b, 9);
    expect(labToLch({ L: 50, a: 0, b: -10 }).h).toBeCloseTo(270, 9);
  });

  it("parses and formats hex", () => {
    expect(hexToRgb("#abc")).toEqual({ r: 170, g: 187, b: 204 });
    expect(rgbToHex({ r: 1, g: 2, b: 255 })).toBe("#0102FF");
    expect(() => hexToRgb("#12")).toThrow();
  });
});
