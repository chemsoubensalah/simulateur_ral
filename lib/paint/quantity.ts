/**
 * How much paint to buy: area → litres → cans. No prices (the seller
 * confirms quantities and prices in the shop).
 */

export type MeasureMode = "wall" | "room" | "ceiling";

export type Measure = {
  mode: MeasureMode;
  /** Wall: width; room: length of the floor; ceiling: length. Metres. */
  a: number;
  /** Room: width of the floor; ceiling: width. Metres. */
  b: number;
  /** Wall / room height in metres. */
  height: number;
  doors: number;
  windows: number;
};

/** Standard openings (m²): an interior door 0.9 × 2.1 m, a window 1.2 × 1.25 m. */
export const DOOR_M2 = 1.9;
export const WINDOW_M2 = 1.5;
/** Typical coverage of interior emulsion per coat. */
export const DEFAULT_COVERAGE_M2_PER_L = 10;
export const DEFAULT_COATS = 2;
/** Extra for rough walls, cutting in and touch-ups. */
export const WASTE = 0.1;
/** Can sizes in litres; set NEXT_PUBLIC_CAN_SIZES (e.g. "1,4,10,15") to match the shop. */
export const DEFAULT_CAN_SIZES = parseCanSizes(process.env.NEXT_PUBLIC_CAN_SIZES) ?? [1, 2.5, 5, 10];

export function parseCanSizes(v: string | undefined): number[] | null {
  if (!v) return null;
  const sizes = v
    .split(/[,;\s]+/)
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0 && n <= 100);
  return sizes.length ? [...new Set(sizes)].sort((x, y) => x - y) : null;
}

export const defaultMeasure = (mode: MeasureMode): Measure => ({ mode, a: 0, b: 0, height: mode === "ceiling" ? 0 : 2.7, doors: 0, windows: 0 });

/** Paintable area in m² (openings subtracted, never negative). */
export function paintableArea(m: Measure): number {
  const pos = (v: number) => (Number.isFinite(v) && v > 0 ? v : 0);
  let area: number;
  if (m.mode === "ceiling") area = pos(m.a) * pos(m.b);
  else if (m.mode === "room") area = 2 * (pos(m.a) + pos(m.b)) * pos(m.height);
  else area = pos(m.a) * pos(m.height);
  if (m.mode !== "ceiling") area -= pos(m.doors) * DOOR_M2 + pos(m.windows) * WINDOW_M2;
  return Math.max(0, area);
}

/** Litres for an area, a number of coats and a coverage, including the waste margin. */
export function litersNeeded(areaM2: number, coats = DEFAULT_COATS, coverage = DEFAULT_COVERAGE_M2_PER_L, waste = WASTE): number {
  if (areaM2 <= 0 || coats <= 0 || coverage <= 0) return 0;
  return (areaM2 * coats * (1 + waste)) / coverage;
}

export type CanPlan = { size: number; count: number }[];

/** Each extra can counts like this many litres of left-over paint (small cans cost more per litre). */
const CAN_PENALTY_L = 0.75;

/**
 * Combination of cans covering `liters`: least left-over paint, but one
 * fewer can is worth up to 0.75 L more paint. Exact (dynamic programming
 * over 0.25 L steps).
 */
export function canCombination(liters: number, sizes: number[] = DEFAULT_CAN_SIZES): CanPlan {
  if (liters <= 0 || !sizes.length) return [];
  const STEP = 0.25;
  const units = sizes.map((s) => Math.max(1, Math.round(s / STEP)));
  const need = Math.ceil(liters / STEP - 1e-9);
  const max = need + Math.max(...units);
  // best[v] = fewest cans that make exactly v units; from[v] = last can index.
  const best = new Array<number>(max + 1).fill(Infinity);
  const from = new Array<number>(max + 1).fill(-1);
  best[0] = 0;
  for (let v = 1; v <= max; v++)
    for (let i = 0; i < units.length; i++) {
      const u = units[i]!;
      if (u <= v && best[v - u]! + 1 < best[v]!) {
        best[v] = best[v - u]! + 1;
        from[v] = i;
      }
    }
  let v = -1;
  let bestScore = Infinity;
  for (let x = need; x <= max; x++) {
    if (best[x] === Infinity) continue;
    const score = x * STEP + CAN_PENALTY_L * best[x]!;
    if (score < bestScore - 1e-9) [bestScore, v] = [score, x];
  }
  if (v < 0) return [];
  const counts = new Map<number, number>();
  while (v > 0) {
    const i = from[v]!;
    counts.set(sizes[i]!, (counts.get(sizes[i]!) ?? 0) + 1);
    v -= units[i]!;
  }
  return [...counts.entries()].sort((x, y) => y[0] - x[0]).map(([size, count]) => ({ size, count }));
}

export const planLiters = (plan: CanPlan) => plan.reduce((s, c) => s + c.size * c.count, 0);
