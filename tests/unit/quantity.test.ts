import { describe, expect, it } from "vitest";
import { canCombination, defaultMeasure, DOOR_M2, litersNeeded, paintableArea, parseCanSizes, planLiters, WINDOW_M2 } from "@/lib/paint/quantity";

describe("paintable area", () => {
  it("one wall: width × height minus openings", () => {
    expect(paintableArea({ ...defaultMeasure("wall"), a: 4, height: 2.5 })).toBeCloseTo(10, 6);
    expect(paintableArea({ ...defaultMeasure("wall"), a: 4, height: 2.5, doors: 1, windows: 1 })).toBeCloseTo(10 - DOOR_M2 - WINDOW_M2, 6);
  });
  it("whole room: perimeter × height", () => {
    expect(paintableArea({ ...defaultMeasure("room"), a: 4, b: 3, height: 2.5, doors: 1 })).toBeCloseTo(35 - DOOR_M2, 6);
  });
  it("ceiling: length × width, openings ignored", () => {
    expect(paintableArea({ ...defaultMeasure("ceiling"), a: 4, b: 3, doors: 2 })).toBeCloseTo(12, 6);
  });
  it("never negative, ignores invalid input", () => {
    expect(paintableArea({ ...defaultMeasure("wall"), a: 1, height: 1, doors: 3 })).toBe(0);
    expect(paintableArea({ ...defaultMeasure("wall"), a: Number.NaN, height: 2.7 })).toBe(0);
  });
});

describe("litres", () => {
  it("area × coats / coverage + 10 %", () => {
    expect(litersNeeded(35, 2, 10)).toBeCloseTo(7.7, 6);
    expect(litersNeeded(0)).toBe(0);
  });
});

describe("cans", () => {
  it("buys little extra paint in few cans", () => {
    expect(canCombination(7.7, [1, 2.5, 5, 10])).toEqual([{ size: 5, count: 1 }, { size: 2.5, count: 1 }, { size: 1, count: 1 }]); // 8.5 L
    expect(canCombination(10, [1, 2.5, 5, 10])).toEqual([{ size: 10, count: 1 }]);
    expect(canCombination(0.3, [1, 2.5, 5, 10])).toEqual([{ size: 1, count: 1 }]);
    expect(canCombination(23, [1, 2.5, 5, 10])).toEqual([{ size: 10, count: 2 }, { size: 2.5, count: 1 }, { size: 1, count: 1 }]); // 23.5 L
  });
  it("always covers the need", () => {
    for (let l = 0.1; l < 60; l += 0.7) {
      const plan = canCombination(l, [1, 4, 10, 15]);
      expect(planLiters(plan)).toBeGreaterThanOrEqual(l - 1e-9);
      expect(planLiters(plan) - l).toBeLessThan(2.5); // little left over
    }
  });
  it("reads the shop's can sizes from configuration", () => {
    expect(parseCanSizes("15, 4,1 ,10")).toEqual([1, 4, 10, 15]);
    expect(parseCanSizes("")).toBeNull();
    expect(parseCanSizes("x")).toBeNull();
  });
});
