/**
 * Ways customers in a paint shop think about colour:
 *  - named groups ("off-white", "warm beige", "calm grey"…) computed from
 *    CIELAB lightness / chroma / hue, so they work for every collection;
 *  - plain-language search: "بيج فاتح", "light grey", "rouge foncé",
 *    "أزرق سماوي" → colour family + light / dark / soft / bright.
 */
import { getCatalog, normalizeText, searchColors, type CollectionId, type ColorFamily, type PaintColor, type SearchOptions } from "./catalog";
import { labToLch } from "./lab";

export const GROUP_IDS = ["popular", "offWhite", "warmBeige", "greige", "calmGrey", "softGreen", "skyBlue", "softPink", "terracotta", "deep"] as const;
export type GroupId = (typeof GROUP_IDS)[number];

/**
 * The shop's best sellers (edit to match the shop). Codes not in the
 * catalogue are ignored.
 */
export const POPULAR_CODES = [
  "RAL 9010", "RAL 9001", "RAL 9016", "RAL 1013", "RAL 1015", "RAL 1014", "RAL 7035", "RAL 7044", "RAL 7047", "RAL 7032",
  "RAL 6019", "RAL 6021", "RAL 5024", "RAL 5014", "RAL 3012", "RAL 3015", "RAL 1001", "RAL 8025", "RAL 7016", "RAL 5011",
  "S 0500-N", "S 0502-Y", "S 0505-Y30R", "S 1002-Y", "S 1005-Y20R", "S 1010-Y20R", "S 1502-Y", "S 2002-Y", "S 2005-Y20R",
  "S 1010-G50Y", "S 2010-G30Y", "S 1010-B", "S 2010-R90B", "S 1010-Y90R", "S 3020-Y60R", "S 7500-N",
];

type Lch = { L: number; C: number; h: number };
const hueIn = (h: number, from: number, to: number) => (from <= to ? h >= from && h <= to : h >= from || h <= to);

const GROUP_TESTS: Record<Exclude<GroupId, "popular">, (c: Lch) => boolean> = {
  offWhite: ({ L, C }) => L >= 88 && C <= 10,
  warmBeige: ({ L, C, h }) => L >= 66 && L < 90 && C >= 8 && C <= 32 && hueIn(h, 50, 95),
  greige: ({ L, C, h }) => L >= 52 && L < 88 && C >= 3 && C < 10 && hueIn(h, 40, 120),
  calmGrey: ({ L, C }) => L >= 40 && L < 88 && C < 5,
  softGreen: ({ L, C, h }) => L >= 45 && L < 88 && C >= 6 && C <= 30 && hueIn(h, 100, 185),
  skyBlue: ({ L, C, h }) => L >= 55 && L < 90 && C >= 6 && C <= 35 && hueIn(h, 195, 285),
  softPink: ({ L, C, h }) => L >= 65 && C >= 6 && C <= 35 && hueIn(h, 340, 45),
  terracotta: ({ L, C, h }) => L >= 35 && L < 65 && C >= 22 && hueIn(h, 25, 65),
  deep: ({ L }) => L < 40,
};

/** A colour that represents the group on its button. */
export const GROUP_DOT: Record<GroupId, string> = {
  popular: "conic-gradient(#f4f1e8,#d9c7a4,#9a9c9a,#6f8f72,#5d7fa3,#f4f1e8)",
  offWhite: "#F3EFE4",
  warmBeige: "#DCC7A1",
  greige: "#B8AE9C",
  calmGrey: "#A3A6A5",
  softGreen: "#9DB59A",
  skyBlue: "#A9C3DB",
  softPink: "#EBC3C3",
  terracotta: "#B8674A",
  deep: "#28364A",
};

const usable = (c: PaintColor) => !c.special;

/** Colours of a group within a collection, best first (popular: shop order; others: light to dark). */
export function groupColors(id: GroupId, collection: CollectionId | "all" = "all"): PaintColor[] {
  const { colors, byId } = getCatalog();
  const inScope = (c: PaintColor) => collection === "all" || c.collection === collection;
  if (id === "popular") {
    return POPULAR_CODES.map((code) => byId.get(`${code.startsWith("RAL") ? "ral-classic" : "ncs"}:${code}`)).filter(
      (c): c is PaintColor => !!c && inScope(c),
    );
  }
  const test = GROUP_TESTS[id];
  return colors
    .filter((c) => inScope(c) && usable(c) && test(labToLch(c.lab)))
    .sort((a, b) => b.lab.L - a.lab.L);
}

export function inGroup(c: PaintColor, id: GroupId): boolean {
  if (id === "popular") return POPULAR_CODES.includes(c.code);
  return usable(c) && GROUP_TESTS[id](labToLch(c.lab));
}

/* ---------- plain-language search ---------- */

type Modifier = "light" | "dark" | "soft" | "bright" | "cream";
type Word = { family?: ColorFamily; mods?: Modifier[] };

/** Words in Arabic, English, German and French (normalised like the search box). */
const WORDS: Record<string, Word> = {};
const add = (family: ColorFamily | undefined, mods: Modifier[] | undefined, ...words: string[]) => {
  for (const w of words) WORDS[normalizeText(w)] = { family, mods };
};
add("white", undefined, "أبيض", "ابيض", "بيضاء", "بيضا", "white", "weiss", "weiß", "blanc", "blanche");
add("grey", undefined, "رمادي", "رماديه", "رمادية", "رصاصي", "grey", "gray", "grau", "gris", "grise");
add("black", undefined, "أسود", "اسود", "سوداء", "black", "schwarz", "noir", "noire");
add("beige", undefined, "بيج", "بيجي", "beige");
add("brown", undefined, "بني", "بنية", "شوكولا", "قهوي", "brown", "braun", "marron", "brun");
add("yellow", undefined, "أصفر", "اصفر", "صفراء", "yellow", "gelb", "jaune");
add("orange", undefined, "برتقالي", "برتقالية", "orange");
add("red", undefined, "أحمر", "احمر", "حمراء", "red", "rot", "rouge");
add("pink", undefined, "وردي", "وردية", "زهري", "روز", "pink", "rosa", "rose");
add("violet", undefined, "بنفسجي", "موف", "ليلكي", "purple", "violet", "lila", "mauve");
add("blue", undefined, "أزرق", "ازرق", "زرقاء", "blue", "blau", "bleu", "bleue");
add("blue", ["light"], "سماوي", "sky", "himmelblau", "ciel");
add("blue", ["dark"], "كحلي", "navy", "marine");
add("turquoise", undefined, "فيروزي", "تركواز", "turquoise", "türkis", "turkis");
add("green", undefined, "أخضر", "اخضر", "خضراء", "green", "grün", "vert", "verte");
add("green", ["soft"], "زيتي", "olive", "oliv");
add(undefined, ["light"], "فاتح", "فاتحة", "خفيف", "light", "pale", "hell", "helles", "heller", "clair", "claire", "pastel", "باستيل");
add(undefined, ["dark"], "غامق", "غامقة", "داكن", "داكنة", "قاتم", "dark", "deep", "dunkel", "dunkles", "fonce", "foncé", "sombre");
add(undefined, ["soft"], "هادئ", "هادي", "هادئة", "ناعم", "soft", "calm", "muted", "ruhig", "sanft", "doux", "douce");
add(undefined, ["bright"], "فاقع", "زاهي", "قوي", "bright", "vivid", "kräftig", "kraftig", "vif", "vive");
add(undefined, ["cream"], "مكسور", "كريمي", "كريم", "عاجي", "cream", "ivory", "creme", "crème", "elfenbein", "ivoire");
const FILLER = new Set(["لون", "اللون", "الوان", "color", "colour", "farbe", "couleur", "de", "en", "و", "a", "an", "the"].map(normalizeText));

export type Description = { families: ColorFamily[]; mods: Modifier[] };

/**
 * Understand a query made only of colour words ("بيج فاتح", "rouge foncé").
 * Returns null if any word is not a colour word (then the normal name/code search is used).
 */
export function describeQuery(query: string): Description | null {
  const tokens = normalizeText(query).split(/[\s,،]+/).filter(Boolean);
  if (!tokens.length) return null;
  const families: ColorFamily[] = [];
  const mods: Modifier[] = [];
  for (const raw of tokens) {
    if (FILLER.has(raw)) continue;
    const w = WORDS[raw] ?? (raw.startsWith("ال") ? WORDS[raw.slice(2)] : undefined);
    if (!w) return null;
    if (w.family && !families.includes(w.family)) families.push(w.family);
    for (const m of w.mods ?? []) if (!mods.includes(m)) mods.push(m);
  }
  return families.length || mods.length ? { families, mods } : null;
}

/** Colours matching a description, most typical first. */
export function describedColors(d: Description, candidates: PaintColor[]): PaintColor[] {
  const test = (c: PaintColor, strict: boolean) => {
    const { L, C, h } = labToLch(c.lab);
    const neutral = c.family === "white" || c.family === "grey" || c.family === "black";
    if (d.mods.includes("cream")) {
      if (!(L >= 84 && C >= 3 && C <= 22 && hueIn(h, 55, 105))) return false;
    } else if (d.families.length && !d.families.includes(c.family)) return false;
    if (!strict) return true;
    if (d.mods.includes("light") && L < (neutral ? 80 : 72)) return false;
    if (d.mods.includes("dark") && L > 45) return false;
    if (d.mods.includes("soft") && !neutral && C > 20) return false;
    if (d.mods.includes("bright") && C < 45) return false;
    return true;
  };
  let list = candidates.filter((c) => usable(c) && test(c, true));
  if (!list.length) list = candidates.filter((c) => usable(c) && test(c, false));
  const key = (c: PaintColor) => {
    const { L, C } = labToLch(c.lab);
    if (d.mods.includes("dark")) return L;
    if (d.mods.includes("bright")) return -C;
    if (d.mods.includes("soft")) return C - L / 10;
    return -L;
  };
  return list.sort((a, b) => key(a) - key(b));
}

/**
 * Search used by the colour chart: plain-language descriptions first
 * ("بيج فاتح"), otherwise codes and names. Optionally limited to a group.
 */
export function smartSearch(query: string, opts: SearchOptions & { group?: GroupId | null } = {}): PaintColor[] {
  const d = describeQuery(query);
  let list: PaintColor[];
  if (d) {
    const scope = searchColors("", opts);
    list = describedColors(d, scope);
  } else list = searchColors(query, opts);
  if (opts.group) {
    const g = opts.group;
    list = list.filter((c) => inGroup(c, g));
    if (g === "popular" && !query.trim()) {
      const order = new Map(POPULAR_CODES.map((code, i) => [code, i]));
      list.sort((a, b) => (order.get(a.code) ?? 999) - (order.get(b.code) ?? 999));
    }
  }
  return list;
}
