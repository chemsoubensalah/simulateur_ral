/**
 * Paint colour catalogue: collections (RAL Classic, NCS, and manufacturer
 * collections later), search, family filters and closest-paint matching.
 */
import ralData from "./data/ral-classic.json";
import { deltaE2000 } from "./deltaE";
import { hexToLab, labToLch, type Lab } from "./lab";
import { formatNcs, ncsGrid, ncsToHex, parseNcs, type NcsColor } from "./ncs";
import type { Locale } from "@/lib/i18n/config";

export type CollectionId = "ral-classic" | "ncs";

export const COLOR_FAMILIES = [
  "white",
  "grey",
  "black",
  "beige",
  "brown",
  "yellow",
  "orange",
  "red",
  "pink",
  "violet",
  "blue",
  "turquoise",
  "green",
] as const;
export type ColorFamily = (typeof COLOR_FAMILIES)[number];

export type PaintColor = {
  /** Stable id, e.g. "ral-classic:RAL 9010" or "ncs:S 1050-Y90R". */
  id: string;
  collection: CollectionId;
  code: string;
  names?: Partial<Record<Locale, string>>;
  hex: string;
  /** CIELAB of the on-screen colour (D65), used for matching. */
  lab: Lab;
  family: ColorFamily;
  /** Pearl / fluorescent / metallic finishes: not suggested as wall paint. */
  special?: "pearl" | "luminous" | "metallic";
  /** True when the screen colour is a calculated/approximate rendering. */
  approximate: boolean;
  /** Manufacturer data (filled by product catalogues in later phases). */
  labMeasured?: Lab;
  brand?: string;
  pricePerLiter?: number;
  coverageM2PerLiter?: number;
};

export type CollectionInfo = { id: CollectionId; label: string; count: number; approximate: boolean };

/** Classify a colour into a family from its CIELAB lightness, chroma and hue. */
export function familyOf(lab: Lab): ColorFamily {
  const { L, C, h } = labToLch(lab);
  if (C < 7) return L > 86 ? "white" : L < 22 ? "black" : "grey";
  if (L > 88 && C < 12) return "white";
  if (h >= 20 && h < 75) {
    if (L < 52) return C > 45 && h < 45 ? "red" : "brown";
    if (C < 28) return "beige";
    return h < 55 ? "orange" : "beige";
  }
  if (h >= 75 && h < 108) {
    if (L < 50) return "brown";
    if (C < 30) return "beige";
    return "yellow";
  }
  if (h >= 108 && h < 195) return "green";
  if (h >= 195 && h < 230) return "turquoise";
  if (h >= 230 && h < 295) return "blue";
  if (h >= 295 && h < 345) return L > 70 ? "pink" : "violet";
  // h in [345, 360) ∪ [0, 20): reds and pinks
  return L > 68 && C < 45 ? "pink" : "red";
}

type RalEntry = { code: string; hex: string; names: Record<Locale, string>; special?: PaintColor["special"] };

function makeRal(e: RalEntry): PaintColor {
  const lab = hexToLab(e.hex);
  return {
    id: `ral-classic:${e.code}`,
    collection: "ral-classic",
    code: e.code,
    names: e.names,
    hex: e.hex,
    lab,
    family: familyOf(lab),
    special: e.special,
    approximate: true,
  };
}

export function makeNcs(n: NcsColor): PaintColor {
  const code = formatNcs(n);
  const hex = ncsToHex(n);
  const lab = hexToLab(hex);
  return { id: `ncs:${code}`, collection: "ncs", code, hex, lab, family: familyOf(lab), approximate: true };
}

type Catalog = { colors: PaintColor[]; byId: Map<string, PaintColor>; collections: CollectionInfo[] };
let catalog: Catalog | null = null;

export function getCatalog(): Catalog {
  if (catalog) return catalog;
  const ral = (ralData.colors as RalEntry[]).map(makeRal);
  const ncs = ncsGrid().map(makeNcs);
  const colors = [...ral, ...ncs];
  catalog = {
    colors,
    byId: new Map(colors.map((c) => [c.id, c])),
    collections: [
      { id: "ral-classic", label: "RAL Classic", count: ral.length, approximate: true },
      { id: "ncs", label: "NCS", count: ncs.length, approximate: true },
    ],
  };
  return catalog;
}

export function getColor(id: string): PaintColor | undefined {
  const c = getCatalog().byId.get(id);
  if (c) return c;
  // Any valid NCS notation can be referenced, even outside the browsable grid.
  if (id.startsWith("ncs:")) {
    const n = parseNcs(id.slice(4));
    return n ? makeNcs(n) : undefined;
  }
  return undefined;
}

export function colorName(c: PaintColor, locale: Locale): string | undefined {
  return c.names?.[locale] ?? c.names?.en;
}

/* ---------- search ---------- */

/** Lower-case, strip accents/diacritics and unify Arabic letter variants. */
export function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ـ/g, "")
    .replace(/ß/g, "ss")
    .trim();
}

const compact = (s: string) => normalizeText(s).replace(/[\s\-_.]/g, "");

export type SearchOptions = { collection?: CollectionId | "all"; family?: ColorFamily | null; includeSpecial?: boolean };

/**
 * Search by code ("9010", "ral9010", "S 1050-Y90R", "1050y90r") or by name in
 * any language. Exact code matches come first, then code prefixes, then names.
 * A valid NCS notation that is not in the grid is returned as a computed colour.
 */
export function searchColors(query: string, opts: SearchOptions = {}): PaintColor[] {
  const { colors } = getCatalog();
  const inScope = (c: PaintColor) =>
    (!opts.collection || opts.collection === "all" || c.collection === opts.collection) &&
    (!opts.family || c.family === opts.family) &&
    (opts.includeSpecial !== false || !c.special);
  const q = normalizeText(query);
  if (!q) return colors.filter(inScope);

  const qc = compact(query).replace(/^ral/, "").replace(/^ncs/, "");
  const exact: PaintColor[] = [];
  const prefix: PaintColor[] = [];
  const named: PaintColor[] = [];
  const words = q.split(/\s+/).filter(Boolean);
  for (const c of colors) {
    if (!inScope(c)) continue;
    const code = compact(c.code).replace(/^ral/, "");
    const codeNoS = code.replace(/^s/, "");
    if (qc && (code === qc || codeNoS === qc)) exact.push(c);
    else if (qc && (code.startsWith(qc) || codeNoS.startsWith(qc))) prefix.push(c);
    else if (c.names) {
      const hay = Object.values(c.names).map((n) => normalizeText(n ?? "")).join(" | ");
      if (words.every((w) => hay.includes(w))) named.push(c);
    }
  }
  const result = [...exact, ...prefix, ...named];
  if (exact.length === 0 && (!opts.collection || opts.collection === "all" || opts.collection === "ncs")) {
    const n = parseNcs(query);
    if (n) {
      const c = makeNcs(n);
      if ((!opts.family || c.family === opts.family) && !result.some((r) => r.id === c.id)) result.unshift(c);
    }
  }
  return result;
}

/* ---------- matching ---------- */

export type Match = { color: PaintColor; deltaE: number };

/** Closest catalogue colours to `lab` by CIEDE2000. */
export function closestColors(
  lab: Lab,
  opts: { collection?: CollectionId | "all"; limit?: number; includeSpecial?: boolean; exclude?: Set<string> } = {},
): Match[] {
  const { colors } = getCatalog();
  const limit = opts.limit ?? 5;
  const best: Match[] = [];
  for (const c of colors) {
    if (opts.collection && opts.collection !== "all" && c.collection !== opts.collection) continue;
    if (!opts.includeSpecial && c.special) continue;
    if (opts.exclude?.has(c.id)) continue;
    // Cheap Euclidean pre-check before the full CIEDE2000.
    const dl = c.lab.L - lab.L;
    if (best.length === limit && Math.abs(dl) > best[best.length - 1]!.deltaE * 2.2 + 5) continue;
    const d = deltaE2000(lab, c.lab);
    if (best.length < limit || d < best[best.length - 1]!.deltaE) {
      best.push({ color: c, deltaE: d });
      best.sort((a, b) => a.deltaE - b.deltaE);
      if (best.length > limit) best.pop();
    }
  }
  return best;
}

/** Human description of a ΔE2000 value. */
export function matchQuality(deltaE: number): "exact" | "veryClose" | "close" | "approximate" {
  if (deltaE < 1) return "exact";
  if (deltaE < 2.5) return "veryClose";
  if (deltaE < 5) return "close";
  return "approximate";
}
