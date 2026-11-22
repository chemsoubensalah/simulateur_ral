/**
 * Room lighting: estimate the colour cast of the light in the photo (e.g. a
 * warm bulb at night) so that
 *  - "as photographed": the paint takes on part of that cast, like everything
 *    else in the room (otherwise it looks pasted on);
 *  - "daylight": the whole photo is neutralised to show true colours;
 *  - "evening": warm lamp light, as most rooms look at night.
 */
import { srgbToLinear } from "@/lib/color/lab";

export type LightMode = "photo" | "day" | "evening";
export const LIGHT_MODES: LightMode[] = ["photo", "day", "evening"];
export type Rgb3 = [number, number, number];

/** Per-channel multipliers in linear RGB: the light's cast relative to neutral (luminance 1). */
export type LightingEstimate = { cast: Rgb3 };
export type LightingGains = { image: Rgb3; paint: Rgb3 };

export const NEUTRAL: Rgb3 = [1, 1, 1];
/** Warm lamp light (~3000 K, partially adapted), luminance-normalised. */
const WARM: Rgb3 = [1.13, 0.98, 0.76];
/** Evenings are darker than the photo. */
const EVENING_LEVEL = 0.85;
/** How much of the measured cast the paint takes on in "as photographed" (partial adaptation). */
const PAINT_ADAPTATION = 0.5;

const lumOf = (c: Rgb3) => 0.2126729 * c[0] + 0.7151522 * c[1] + 0.072175 * c[2];
const normalise = (c: Rgb3): Rgb3 => {
  const k = lumOf(c);
  return [c[0] / k, c[1] / k, c[2] / k];
};

/**
 * "Bright greys" estimate: the light's colour shows best on the brightest
 * near-neutral surfaces (ceilings, white trims, window frames), not on the
 * walls, which may be genuinely beige. Damped and clamped so a room that
 * really is warm or cool is not over-corrected.
 */
export function estimateLighting(rgba: Uint8Array | Uint8ClampedArray, w: number, h: number): LightingEstimate {
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) lut[i] = srgbToLinear(i / 255);
  const step = Math.max(1, Math.round(Math.sqrt((w * h) / 40000)));
  const samples: { y: number; r: number; g: number; b: number }[] = [];
  for (let y = 0; y < h; y += step)
    for (let x = 0; x < w; x += step) {
      const k = (y * w + x) * 4;
      const r = lut[rgba[k]!]!;
      const g = lut[rgba[k + 1]!]!;
      const b = lut[rgba[k + 2]!]!;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (max < 0.05 || max > 0.96) continue; // too dark or clipped
      if ((max - min) / max > 0.35) continue; // clearly coloured
      samples.push({ y: lumOf([r, g, b]), r, g, b });
    }
  if (samples.length < 50) return { cast: NEUTRAL };
  samples.sort((a, b) => b.y - a.y);
  const top = samples.slice(0, Math.max(50, Math.round(samples.length * 0.2)));
  let r = 0;
  let g = 0;
  let b = 0;
  for (const s of top) {
    r += s.r;
    g += s.g;
    b += s.b;
  }
  const raw = normalise([r, g, b]);
  const cast = raw.map((c) => Math.min(1.3, Math.max(0.75, 1 + 0.6 * (c - 1)))) as Rgb3;
  return { cast: normalise(cast) };
}

/** Multipliers (linear RGB) for the photo and for the paint, for a lighting mode. */
export function lightingGains(est: LightingEstimate, mode: LightMode): LightingGains {
  const inv = est.cast.map((c) => 1 / c) as Rgb3;
  if (mode === "day") return { image: inv, paint: NEUTRAL };
  if (mode === "evening")
    return {
      image: inv.map((c, i) => c * WARM[i]! * EVENING_LEVEL) as Rgb3,
      paint: WARM.map((c) => c * EVENING_LEVEL) as Rgb3,
    };
  return { image: NEUTRAL, paint: normalise(est.cast.map((c) => Math.pow(c, PAINT_ADAPTATION)) as Rgb3) };
}
