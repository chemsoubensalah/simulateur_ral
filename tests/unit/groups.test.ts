import { describe, expect, it } from "vitest";
import { describeQuery, groupColors, GROUP_IDS, POPULAR_CODES, smartSearch } from "@/lib/color/groups";
import { getCatalog } from "@/lib/color/catalog";
import { labToLch } from "@/lib/color/lab";

describe("shop colour groups", () => {
  it("every group has colours in RAL Classic and in NCS", () => {
    for (const id of GROUP_IDS) {
      expect(groupColors(id, "ral-classic").length, `${id} RAL`).toBeGreaterThan(id === "softPink" ? 0 : 2);
      expect(groupColors(id, "ncs").length, `${id} NCS`).toBeGreaterThan(5);
    }
  });

  it("all popular codes exist in the catalogue", () => {
    const { byId } = getCatalog();
    for (const code of POPULAR_CODES) expect(byId.has(`${code.startsWith("RAL") ? "ral-classic" : "ncs"}:${code}`), code).toBe(true);
  });

  it("off-white is very light and nearly neutral; deep colours are dark", () => {
    for (const c of groupColors("offWhite")) {
      const { L, C } = labToLch(c.lab);
      expect(L).toBeGreaterThanOrEqual(88);
      expect(C).toBeLessThanOrEqual(10);
    }
    for (const c of groupColors("deep")) expect(c.lab.L).toBeLessThan(40);
    expect(groupColors("offWhite", "ral-classic").map((c) => c.code)).toContain("RAL 9010");
  });

  it("are sorted light to dark", () => {
    const g = groupColors("calmGrey");
    for (let i = 1; i < g.length; i++) expect(g[i]!.lab.L).toBeLessThanOrEqual(g[i - 1]!.lab.L);
  });
});

describe("plain-language search", () => {
  it("understands colour + light/dark words in Arabic, English, German and French", () => {
    expect(describeQuery("بيج فاتح")).toEqual({ families: ["beige"], mods: ["light"] });
    expect(describeQuery("light grey")).toEqual({ families: ["grey"], mods: ["light"] });
    expect(describeQuery("rouge foncé")).toEqual({ families: ["red"], mods: ["dark"] });
    expect(describeQuery("dunkles Grün")).toEqual({ families: ["green"], mods: ["dark"] });
    expect(describeQuery("أزرق سماوي")).toEqual({ families: ["blue"], mods: ["light"] });
    expect(describeQuery("اللون الأخضر")).toEqual({ families: ["green"], mods: [] });
  });

  it("leaves codes and real colour names to the normal search", () => {
    expect(describeQuery("9010")).toBeNull();
    expect(describeQuery("أبيض نقي")).toBeNull(); // "pure white" is a RAL name
    expect(smartSearch("أبيض نقي", { collection: "ral-classic" })[0]!.code).toBe("RAL 9010");
    expect(smartSearch("9010")[0]!.code).toBe("RAL 9010");
  });

  it("'بيج فاتح' gives light beiges, 'رمادي غامق' dark greys", () => {
    const beige = smartSearch("بيج فاتح", { collection: "ral-classic" });
    expect(beige.length).toBeGreaterThan(2);
    for (const c of beige) {
      expect(c.family).toBe("beige");
      expect(c.lab.L).toBeGreaterThanOrEqual(72);
    }
    const grey = smartSearch("رمادي غامق");
    expect(grey.length).toBeGreaterThan(3);
    for (const c of grey) expect(c.lab.L).toBeLessThanOrEqual(45);
    // sorted dark first
    expect(grey[0]!.lab.L).toBeLessThanOrEqual(grey[grey.length - 1]!.lab.L);
  });

  it("cream / off-white words find warm whites", () => {
    const cream = smartSearch("أبيض مكسور", { collection: "ral-classic" });
    expect(cream.map((c) => c.code)).toEqual(expect.arrayContaining(["RAL 9001"]));
  });

  it("can be limited to a group", () => {
    const list = smartSearch("", { group: "popular", collection: "ral-classic" });
    expect(list[0]!.code).toBe("RAL 9010");
  });
});
