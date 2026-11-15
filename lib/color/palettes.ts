/**
 * Colour suggestions: harmonies generated in CIE LCh, style presets, and the
 * dominant colours of a photo (furniture, floor…). Every suggestion is mapped
 * to the closest real paint with CIEDE2000.
 */
import { closestColors, getColor, type CollectionId, type PaintColor } from "./catalog";
import { labToLch, lchToLab, rgbToLab, type Lab, type LCh } from "./lab";

export const HARMONIES = ["complementary", "analogous", "triadic", "split", "monochrome"] as const;
export type Harmony = (typeof HARMONIES)[number];

const wrap = (h: number) => ((h % 360) + 360) % 360;
const clampL = (L: number) => Math.min(96, Math.max(18, L));

/** A soft, wall-friendly version of a colour (lighter, less saturated). */
function soften(c: LCh, L = 88, chromaScale = 0.35): LCh {
  return { L, C: Math.min(c.C * chromaScale, 18), h: c.h };
}

/**
 * Target colours for a harmony around `base`. Interior palettes are built as:
 * base, its accent(s), and light, low-chroma companions suitable for large walls.
 */
export function harmonyTargets(base: Lab, type: Harmony): Lab[] {
  const b = labToLch(base);
  const C = Math.max(b.C, 12);
  const at = (dh: number, L = b.L, Cs = C): LCh => ({ L: clampL(L), C: Cs, h: wrap(b.h + dh) });
  let lch: LCh[];
  switch (type) {
    case "complementary":
      lch = [b, soften(b), at(180), soften(at(180), 84), { L: 93, C: 3, h: b.h }];
      break;
    case "analogous":
      lch = [at(-30), b, at(30), soften(at(-30), 86), soften(at(30), 90)];
      break;
    case "triadic":
      lch = [b, at(120, b.L, C * 0.85), at(240, b.L, C * 0.85), soften(b, 90), { L: 93, C: 3, h: b.h }];
      break;
    case "split":
      lch = [b, at(150), at(210), soften(at(150), 86), soften(b, 91)];
      break;
    case "monochrome":
      lch = [92, 80, 66, 50, 34].map((L) => ({ L, C: Math.min(C, 10 + (100 - L) * 0.35), h: b.h }));
      break;
  }
  return lch.map(lchToLab);
}

/** Map target colours to distinct real paints. */
export function toPaints(targets: Lab[], collection: CollectionId | "all"): PaintColor[] {
  const used = new Set<string>();
  const out: PaintColor[] = [];
  for (const t of targets) {
    const m = closestColors(t, { collection, limit: 1, exclude: used })[0];
    if (!m) continue;
    used.add(m.color.id);
    out.push(m.color);
  }
  return out;
}

export function suggestPalette(base: Lab, type: Harmony, collection: CollectionId | "all"): PaintColor[] {
  return toPaints(harmonyTargets(base, type), collection);
}

/* ---------- style presets (defined with RAL Classic references) ---------- */

export const STYLES = ["modern", "scandinavian", "mediterranean", "classic", "moroccan"] as const;
export type Style = (typeof STYLES)[number];

const STYLE_CODES: Record<Style, string[]> = {
  modern: ["RAL 9003", "RAL 7035", "RAL 7044", "RAL 7016", "RAL 5014"],
  scandinavian: ["RAL 9010", "RAL 9002", "RAL 1013", "RAL 6021", "RAL 5024"],
  mediterranean: ["RAL 9001", "RAL 1015", "RAL 5012", "RAL 8023", "RAL 6013"],
  classic: ["RAL 1013", "RAL 1019", "RAL 7006", "RAL 3005", "RAL 6009"],
  moroccan: ["RAL 1015", "RAL 1001", "RAL 8023", "RAL 5002", "RAL 5018"],
};

export function stylePalette(style: Style, collection: CollectionId | "all"): PaintColor[] {
  const ral = STYLE_CODES[style].map((code) => getColor(`ral-classic:${code}`)).filter((c): c is PaintColor => !!c);
  if (collection === "ral-classic" || collection === "all") return ral;
  return toPaints(
    ral.map((c) => c.lab),
    collection,
  );
}

/* ---------- dominant colours of a photo ---------- */

/** Deterministic PRNG for reproducible clustering. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Dominant colours of an RGBA image by k-means in CIELAB on a subsample.
 * Pixels where `exclude` (8-bit, same size) is > 127 are skipped — e.g. the
 * walls being repainted — so the result describes furniture, floor and decor.
 * Returns up to k colours, largest cluster first, without near-duplicates.
 */
export function dominantColors(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  k = 5,
  exclude?: (i: number) => boolean,
): { lab: Lab; share: number }[] {
  const step = Math.max(1, Math.round(Math.sqrt((width * height) / 6000)));
  const pts: Lab[] = [];
  for (let y = 0; y < height; y += step)
    for (let x = 0; x < width; x += step) {
      const i = y * width + x;
      if (exclude?.(i)) continue;
      pts.push(rgbToLab({ r: rgba[i * 4]!, g: rgba[i * 4 + 1]!, b: rgba[i * 4 + 2]! }));
    }
  if (pts.length === 0) return [];
  const rnd = mulberry32(42);
  const d2 = (a: Lab, b: Lab) => (a.L - b.L) ** 2 + (a.a - b.a) ** 2 + (a.b - b.b) ** 2;
  // k-means++ initialisation
  const centers: Lab[] = [pts[Math.floor(rnd() * pts.length)]!];
  const dist = new Float64Array(pts.length).fill(Infinity);
  while (centers.length < Math.min(k + 2, pts.length)) {
    const c = centers[centers.length - 1]!;
    let sum = 0;
    for (let i = 0; i < pts.length; i++) {
      dist[i] = Math.min(dist[i]!, d2(pts[i]!, c));
      sum += dist[i]!;
    }
    let r = rnd() * sum;
    let idx = 0;
    for (; idx < pts.length - 1 && r > dist[idx]!; idx++) r -= dist[idx]!;
    centers.push({ ...pts[idx]! });
  }
  const assign = new Int32Array(pts.length);
  for (let iter = 0; iter < 12; iter++) {
    for (let i = 0; i < pts.length; i++) {
      let best = 0;
      let bd = Infinity;
      for (let j = 0; j < centers.length; j++) {
        const d = d2(pts[i]!, centers[j]!);
        if (d < bd) {
          bd = d;
          best = j;
        }
      }
      assign[i] = best;
    }
    const sums = centers.map(() => ({ L: 0, a: 0, b: 0, n: 0 }));
    for (let i = 0; i < pts.length; i++) {
      const s = sums[assign[i]!]!;
      s.L += pts[i]!.L;
      s.a += pts[i]!.a;
      s.b += pts[i]!.b;
      s.n++;
    }
    sums.forEach((s, j) => {
      if (s.n) centers[j] = { L: s.L / s.n, a: s.a / s.n, b: s.b / s.n };
    });
  }
  const counts = centers.map((_, j) => assign.filter((a) => a === j).length);
  const clusters = centers.map((lab, j) => ({ lab, share: counts[j]! / pts.length })).sort((a, b) => b.share - a.share);
  const out: { lab: Lab; share: number }[] = [];
  for (const c of clusters) {
    if (c.share < 0.02) continue;
    if (out.some((o) => Math.sqrt(d2(o.lab, c.lab)) < 12)) continue;
    out.push(c);
    if (out.length === k) break;
  }
  return out;
}
