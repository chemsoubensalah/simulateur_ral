import { beforeEach, describe, expect, it } from "vitest";
import { allowAnalysis, cached, remember, resetGuard } from "@/lib/server/sam3Guard";

describe("SAM 3 cost protection", () => {
  beforeEach(() => resetGuard());

  it("limits each visitor per hour", () => {
    const t = Date.UTC(2026, 10, 22, 10);
    for (let i = 0; i < 3; i++) expect(allowAnalysis("1.1.1.1", t + i, 3, 100)).toBe(true);
    expect(allowAnalysis("1.1.1.1", t + 10, 3, 100)).toBe(false);
    expect(allowAnalysis("2.2.2.2", t + 10, 3, 100)).toBe(true); // other visitors unaffected
    expect(allowAnalysis("1.1.1.1", t + 3600_001, 3, 100)).toBe(true); // an hour later
  });

  it("caps the total per day", () => {
    const t = Date.UTC(2026, 10, 22, 10);
    for (let i = 0; i < 5; i++) expect(allowAnalysis(`ip${i}`, t, 20, 5)).toBe(true);
    expect(allowAnalysis("ip9", t, 20, 5)).toBe(false);
    expect(allowAnalysis("ip9", Date.UTC(2026, 10, 23, 1), 20, 5)).toBe(true); // next day
  });

  it("answers the same photo from the cache", () => {
    remember("abc", Uint8Array.from([1, 2, 3]));
    expect(cached("abc")).toEqual(Uint8Array.from([1, 2, 3]));
    expect(cached("other")).toBeUndefined();
  });
});
