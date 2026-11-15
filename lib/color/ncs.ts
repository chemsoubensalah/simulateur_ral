/**
 * NCS — Natural Color System notation and an approximate colour model.
 *
 * An NCS notation such as "S 1050-Y90R" describes a colour by
 *   blackness s = 10, chromaticness c = 50 (whiteness w = 100 − s − c) and
 *   hue Y90R = 90 % of the way from yellow to red.
 * The four elementary hues are Y, R, B, G (in that circular order).
 *
 * NCS Colour AB's official colorimetric data is licensed, so ColorVision
 * computes an on-screen approximation:
 *  1. Elementary hues are anchored at the CIELAB hue angles of the unique hues
 *     (yellow ≈ 92°, red ≈ 27°, blue ≈ 245°, green ≈ 160°); intermediate
 *     hues are interpolated (NCS hue steps are perceptually equal).
 *  2. The "full colour" of the hue is the most saturated sRGB colour with that
 *     CIELAB hue (one channel 0, one channel 1).
 *  3. Whiteness / blackness / chromaticness are mixed like the HWB model
 *     (NCS and HWB share the Hering/Ostwald structure), with the NCS white
 *     slightly below paper white and a small extra darkening for strongly
 *     chromatic nuances, calibrated against published screen approximations
 *     (e.g. S 1080-Y90R ≈ #D11C2D).
 * Results are labelled "approximate"; official values can replace them via
 * the catalogue's measured Lab field.
 */
import { hexToRgb, rgbToHex, rgbToLab, type Lab, type RGB } from "./lab";

export type NcsHue = { from: ElementaryHue; to: ElementaryHue; pct: number } | null;
export type ElementaryHue = "Y" | "R" | "B" | "G";
export type NcsColor = { s: number; c: number; hue: NcsHue };

const ORDER: ElementaryHue[] = ["Y", "R", "B", "G"];

const NCS_RE = /^(?:NCS\s*)?(?:S\s*)?(\d{2})(\d{2})\s*-?\s*(N|([YRBG])(?:(\d{2})([YRBG]))?)$/i;

/** Parse NCS notation leniently ("S 1050-Y90R", "ncs s1050y90r", "1050-y90r", "0500-N"). */
export function parseNcs(input: string): NcsColor | null {
  const m = NCS_RE.exec(input.trim().replace(/\s+/g, " "));
  if (!m) return null;
  const s = Number(m[1]);
  const c = Number(m[2]);
  if (s + c > 100) return null;
  if (m[3]!.toUpperCase() === "N") return c === 0 ? { s, c, hue: null } : null;
  const from = m[4]!.toUpperCase() as ElementaryHue;
  if (!m[5]) return { s, c, hue: { from, to: from, pct: 0 } };
  const pct = Number(m[5]);
  const to = m[6]!.toUpperCase() as ElementaryHue;
  const next = ORDER[(ORDER.indexOf(from) + 1) % 4];
  if (to !== next || pct <= 0 || pct >= 100) return null;
  return { s, c, hue: { from, to, pct } };
}

const pad2 = (n: number) => String(Math.round(n)).padStart(2, "0");

/** Canonical form, e.g. "S 1050-Y90R", "S 0500-N", "S 2030-B". */
export function formatNcs(n: NcsColor): string {
  const nuance = `${pad2(n.s)}${pad2(n.c)}`;
  if (!n.hue) return `S ${nuance}-N`;
  if (n.hue.pct === 0) return `S ${nuance}-${n.hue.from}`;
  return `S ${nuance}-${n.hue.from}${pad2(n.hue.pct)}${n.hue.to}`;
}

/** Hue as a position on the NCS circle in [0, 400): Y=0, R=100, B=200, G=300. */
export function huePosition(h: NonNullable<NcsHue>): number {
  return ORDER.indexOf(h.from) * 100 + h.pct;
}

/** CIELAB hue angles (degrees) of the elementary hues, in NCS circle order. */
// Y → R → B → G → Y goes once round the circle with decreasing CIELAB hue.
const ANCHORS = [92, 27, 245 - 360, 160 - 360, 92 - 360];

export function cielabHueForNcs(position: number): number {
  const q = Math.min(3, Math.floor(position / 100));
  const t = (position - q * 100) / 100;
  const h = ANCHORS[q]! + (ANCHORS[q + 1]! - ANCHORS[q]!) * t;
  return ((h % 360) + 360) % 360;
}

/* ---------- full colours: sRGB cube edge, indexed by CIELAB hue ---------- */

type EdgeSample = { hab: number; rgb: [number, number, number] };
let edge: EdgeSample[] | null = null;

function hsvPure(theta: number): [number, number, number] {
  const h = ((theta % 360) + 360) % 360 / 60;
  const x = 1 - Math.abs((h % 2) - 1);
  if (h < 1) return [1, x, 0];
  if (h < 2) return [x, 1, 0];
  if (h < 3) return [0, 1, x];
  if (h < 4) return [0, x, 1];
  if (h < 5) return [x, 0, 1];
  return [1, 0, x];
}

function edgeTable(): EdgeSample[] {
  if (edge) return edge;
  const out: EdgeSample[] = [];
  for (let t = 0; t < 360; t += 0.25) {
    const rgb = hsvPure(t);
    const lab = rgbToLab({ r: rgb[0] * 255, g: rgb[1] * 255, b: rgb[2] * 255 });
    let h = (Math.atan2(lab.b, lab.a) * 180) / Math.PI;
    if (h < 0) h += 360;
    out.push({ hab: h, rgb });
  }
  out.sort((a, b) => a.hab - b.hab);
  edge = out;
  return out;
}

/** Most saturated sRGB colour (0..1 gamma-encoded) with the given CIELAB hue. */
export function fullColorForHue(hab: number): [number, number, number] {
  const tab = edgeTable();
  let lo = 0;
  let hi = tab.length - 1;
  if (hab <= tab[0]!.hab || hab >= tab[hi]!.hab) {
    // Wrap-around segment between the last and first sample.
    const a = tab[hi]!;
    const b = tab[0]!;
    const span = b.hab + 360 - a.hab;
    const t = ((hab < a.hab ? hab + 360 : hab) - a.hab) / span;
    return a.rgb.map((v, i) => v + (b.rgb[i]! - v) * t) as [number, number, number];
  }
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (tab[mid]!.hab <= hab) lo = mid;
    else hi = mid;
  }
  const a = tab[lo]!;
  const b = tab[hi]!;
  const t = (hab - a.hab) / (b.hab - a.hab || 1);
  return a.rgb.map((v, i) => v + (b.rgb[i]! - v) * t) as [number, number, number];
}

/* ---------- NCS → sRGB ---------- */

const WHITE_LEVEL = 0.97;
const BLACK_SLOPE = 0.88;
const CHROMA_DARKENING = 0.06;

export function ncsToRgb(n: NcsColor): RGB {
  const s = n.s / 100;
  const c = n.c / 100;
  const w = Math.max(0, 1 - s - c);
  const sEff = s + CHROMA_DARKENING * c * (1 - s);
  const v = WHITE_LEVEL - BLACK_SLOPE * sEff; // value of the brightest channel
  let rgb: [number, number, number];
  if (!n.hue || c === 0) rgb = [v, v, v];
  else {
    const full = fullColorForHue(cielabHueForNcs(huePosition(n.hue)));
    const k = v / Math.max(1e-6, c + w);
    rgb = full.map((f) => k * (f * c + w)) as [number, number, number];
  }
  const to8 = (x: number) => Math.round(Math.min(1, Math.max(0, x)) * 255);
  return { r: to8(rgb[0]), g: to8(rgb[1]), b: to8(rgb[2]) };
}

export function ncsToHex(n: NcsColor): string {
  return rgbToHex(ncsToRgb(n));
}

export function ncsToLab(n: NcsColor): Lab {
  return rgbToLab(hexToRgb(ncsToHex(n)));
}

/* ---------- the browsable NCS grid ---------- */

const ALL_HUES: NonNullable<NcsHue>[] = ORDER.flatMap((from, i) => {
  const to = ORDER[(i + 1) % 4]!;
  return [{ from, to: from, pct: 0 }, ...[10, 20, 30, 40, 50, 60, 70, 80, 90].map((pct) => ({ from, to, pct }))];
});

/** Approximate maximum chromaticness reachable with paint, by hue quadrant position. */
function maxChroma(position: number): number {
  if (position < 100) return 80; // Y → R
  if (position < 150) return 70; // R → R50B
  if (position < 250) return 60; // R50B → B50G
  if (position < 300) return 50; // B50G → G
  if (position < 350) return 60; // G → G50Y
  return 70; // G50Y → Y
}

const BLACKNESS = [5, 10, 15, 20, 30, 40, 50, 60, 70, 80, 85];
const CHROMATICNESS = [2, 5, 10, 20, 30, 40, 50, 60, 70, 80];

/**
 * NCS nuances on the standard steps for 40 hues plus the grey scale, limited
 * to what paints can realistically reach. This covers the structure of the
 * NCS atlas; the official NCS 1950 sample set is a subset of these notations.
 */
export function ncsGrid(): NcsColor[] {
  const out: NcsColor[] = [];
  for (const s of [3, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90]) out.push({ s, c: 0, hue: null });
  for (const hue of ALL_HUES) {
    const pos = huePosition(hue);
    const cMax = maxChroma(pos);
    for (const s of BLACKNESS) {
      for (const c of CHROMATICNESS) {
        if (c === 2 && hue.pct % 50 !== 0) continue; // near-neutral tints only on main hues
        if (s + c > 95 || c > cMax || c > 100 - s - 5) continue;
        if (s >= 70 && c > 30) continue;
        out.push({ s, c, hue });
      }
    }
  }
  return out;
}
