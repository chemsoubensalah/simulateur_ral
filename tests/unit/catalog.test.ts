import { describe, expect, it } from "vitest";
import ral from "@/lib/color/data/ral-classic.json";
import { closestColors, COLOR_FAMILIES, familyOf, getCatalog, getColor, matchQuality, normalizeText, searchColors } from "@/lib/color/catalog";
import { cielabHueForNcs, formatNcs, ncsGrid, ncsToLab, parseNcs } from "@/lib/color/ncs";
import { dominantColors, harmonyTargets, HARMONIES, stylePalette, STYLES, suggestPalette } from "@/lib/color/palettes";
import { hexToLab, isValidHex, labToLch } from "@/lib/color/lab";
import { deltaE2000 } from "@/lib/color/deltaE";

describe("RAL Classic data", () => {
  it("has all colours with valid hex and names in Arabic, German and English", () => {
    expect(ral.colors.length).toBeGreaterThanOrEqual(215);
    const codes = new Set<string>();
    for (const c of ral.colors) {
      expect(c.code).toMatch(/^RAL \d{4}$/);
      expect(isValidHex(c.hex)).toBe(true);
      for (const l of ["ar", "de", "en"] as const) expect((c.names as Record<string, string>)[l]?.length).toBeGreaterThan(1);
      expect(codes.has(c.code)).toBe(false);
      codes.add(c.code);
    }
    for (const code of ["RAL 9010", "RAL 9016", "RAL 7016", "RAL 1015", "RAL 6031"]) expect(codes.has(code)).toBe(true);
  });

  it("flags non-wall finishes", () => {
    expect(getColor("ral-classic:RAL 9006")?.special).toBe("metallic");
    expect(getColor("ral-classic:RAL 1026")?.special).toBe("luminous");
    expect(getColor("ral-classic:RAL 1035")?.special).toBe("pearl");
    expect(getColor("ral-classic:RAL 9010")?.special).toBeUndefined();
  });
});

describe("NCS notation", () => {
  it("parses and formats leniently", () => {
    for (const s of ["S 1050-Y90R", "s1050-y90r", "NCS S 1050-Y90R", "1050Y90R", "1050 - Y90R"]) expect(formatNcs(parseNcs(s)!)).toBe("S 1050-Y90R");
    expect(formatNcs(parseNcs("0500-N")!)).toBe("S 0500-N");
    expect(formatNcs(parseNcs("S 2030-B")!)).toBe("S 2030-B");
  });

  it("rejects invalid notations", () => {
    for (const s of ["S 6050-Y90R", "S 1050-Y90B", "S 1050-R90Y", "S 0510-N", "S 1050-Y00R", "hello", "S 105-Y"]) expect(parseNcs(s)).toBeNull();
  });

  it("orders hues around the circle: Y → R → B → G", () => {
    const hab = [0, 100, 200, 300].map(cielabHueForNcs);
    expect(hab).toEqual([92, 27, 245, 160]);
    // Y50R lies between yellow and red (an orange), G50Y between green and yellow.
    expect(cielabHueForNcs(50)).toBeGreaterThan(27);
    expect(cielabHueForNcs(50)).toBeLessThan(92);
    expect(cielabHueForNcs(350)).toBeGreaterThan(92);
    expect(cielabHueForNcs(350)).toBeLessThan(160);
  });

  it("greys get darker with blackness, colours more chromatic with chromaticness", () => {
    const greys = [5, 20, 50, 80, 90].map((s) => ncsToLab({ s, c: 0, hue: null }).L);
    for (let i = 1; i < greys.length; i++) expect(greys[i]!).toBeLessThan(greys[i - 1]!);
    const chroma = [10, 30, 50, 70].map((c) => labToLch(ncsToLab(parseNcs(`S 10${String(c).padStart(2, "0")}-Y90R`)!)).C);
    for (let i = 1; i < chroma.length; i++) expect(chroma[i]!).toBeGreaterThan(chroma[i - 1]!);
    expect(familyOf(ncsToLab(parseNcs("S 1080-Y90R")!))).toBe("red");
    expect(familyOf(ncsToLab(parseNcs("S 1050-B")!))).toMatch(/blue|turquoise/);
    expect(familyOf(ncsToLab(parseNcs("S 2060-G")!))).toBe("green");
    expect(familyOf(ncsToLab(parseNcs("S 0580-Y")!))).toBe("yellow");
  });

  it("grid uses valid notations only and has the full hue circle", () => {
    const grid = ncsGrid();
    expect(grid.length).toBeGreaterThan(2000);
    const hues = new Set(grid.map((n) => (n.hue ? formatNcs(n).split("-")[1] : "N")));
    expect(hues.size).toBe(41);
    for (const n of grid) expect(formatNcs(parseNcs(formatNcs(n))!)).toBe(formatNcs(n));
  });
});

describe("catalogue search & matching", () => {
  it("finds colours by code in many formats", () => {
    for (const q of ["9010", "ral 9010", "RAL9010", "Ral 9010"]) expect(searchColors(q)[0]?.code).toBe("RAL 9010");
    expect(searchColors("s1050y90r")[0]?.code).toBe("S 1050-Y90R");
    expect(searchColors("S 1052-Y92R")[0]?.code).toBe("S 1052-Y92R"); // valid NCS outside the grid
  });

  it("finds colours by name in Arabic, German and English", () => {
    expect(searchColors("أبيض نقي")[0]?.code).toBe("RAL 9010");
    expect(searchColors("ابيض نقي")[0]?.code).toBe("RAL 9010"); // alef variants unified
    expect(searchColors("grunbeige")[0]?.code).toBe("RAL 1000"); // umlaut stripped
    expect(searchColors("anthracite")[0]?.code).toBe("RAL 7016");
    expect(normalizeText("أَبْيَضُ")).toBe("ابيض");
  });

  it("filters by collection and family", () => {
    const blues = searchColors("", { collection: "ral-classic", family: "blue" });
    expect(blues.length).toBeGreaterThan(10);
    expect(blues.every((c) => c.collection === "ral-classic" && c.family === "blue")).toBe(true);
    expect(searchColors("", { collection: "ncs" }).every((c) => c.collection === "ncs")).toBe(true);
    expect(searchColors("", { includeSpecial: false }).some((c) => c.special)).toBe(false);
  });

  it("classifies well-known RAL colours into families", () => {
    const expected: Record<string, (typeof COLOR_FAMILIES)[number]> = {
      "RAL 9010": "white", "RAL 7016": "grey", "RAL 9005": "black", "RAL 1015": "beige", "RAL 8017": "brown",
      "RAL 1023": "yellow", "RAL 2004": "orange", "RAL 3020": "red", "RAL 3015": "pink", "RAL 4005": "violet",
      "RAL 5015": "blue", "RAL 5018": "turquoise", "RAL 6018": "green",
    };
    for (const [code, fam] of Object.entries(expected)) expect(getColor(`ral-classic:${code}`)?.family, code).toBe(fam);
  });

  it("closest paint: exact for a catalogue colour, sorted by ΔE2000", () => {
    const m = closestColors(hexToLab("#F7F9EF"), { collection: "ral-classic", limit: 3 });
    expect(m[0]!.color.code).toBe("RAL 9010");
    expect(m[0]!.deltaE).toBeLessThan(0.01);
    expect(m[1]!.deltaE).toBeGreaterThanOrEqual(m[0]!.deltaE);
    expect(matchQuality(m[0]!.deltaE)).toBe("exact");
    // Brute force agrees with the pruned search.
    const target = hexToLab("#7A6B5C");
    const fast = closestColors(target, { limit: 1 })[0]!;
    const { colors } = getCatalog();
    const brute = Math.min(...colors.filter((c) => !c.special).map((c) => deltaE2000(target, c.lab)));
    expect(fast.deltaE).toBeCloseTo(brute, 6);
  });
});

describe("palettes", () => {
  it("complementary harmony includes the opposite hue", () => {
    const base = hexToLab("#C97B5A");
    const t = harmonyTargets(base, "complementary").map(labToLch);
    const h0 = labToLch(base).h;
    const diff = (((t[2]!.h - h0) % 360) + 360) % 360;
    expect(Math.abs(diff - 180)).toBeLessThan(1);
  });

  it("every harmony maps to distinct real paints in the chosen collection", () => {
    for (const h of HARMONIES)
      for (const coll of ["ral-classic", "ncs"] as const) {
        const p = suggestPalette(hexToLab("#7C97AE"), h, coll);
        expect(p.length).toBe(5);
        expect(new Set(p.map((c) => c.id)).size).toBe(5);
        expect(p.every((c) => c.collection === coll && !c.special)).toBe(true);
      }
  });

  it("style presets resolve in both collections", () => {
    for (const s of STYLES) {
      expect(stylePalette(s, "ral-classic").length).toBe(5);
      expect(stylePalette(s, "ncs").every((c) => c.collection === "ncs")).toBe(true);
    }
  });

  it("dominant colours find the main colours and honour exclusions", () => {
    const w = 60, h = 40;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const x = i % w;
      const c = x < 30 ? [200, 60, 50] : x < 50 ? [40, 60, 160] : [230, 230, 220];
      rgba.set([...c, 255], i * 4);
    }
    const d = dominantColors(rgba, w, h, 5);
    expect(d.length).toBe(3);
    expect(d[0]!.share).toBeCloseTo(0.5, 1);
    const withoutRed = dominantColors(rgba, w, h, 5, (i) => i % w < 30);
    expect(withoutRed.length).toBe(2);
    expect(withoutRed.every((c) => labToLch(c.lab).h > 90 || labToLch(c.lab).C < 10)).toBe(true);
  });
});
