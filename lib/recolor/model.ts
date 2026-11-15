/**
 * Recoloring model (CPU reference implementation).
 *
 * The WebGL fragment shader in ./shaders.ts implements exactly this algorithm;
 * this TypeScript version exists so the math can be unit-tested and used for
 * CPU fallbacks (e.g. thumbnails).
 *
 * Idea — paint changes the surface reflectance, not the lighting:
 *  1. For every masked pixel take its relative luminance Y (linear light).
 *  2. Lm = mean L* of the whole surface and Ym = Y(Lm) its reference luminance.
 *     Shading ratio r = Y / Ym captures shadows, light gradients and texture.
 *  3. New luminance Y' = Yt · r^k (Yt = target paint luminance, k depends on the
 *     finish). Because L* + 16 ∝ Y^(1/3), this gives
 *         L*' + 16 = (Lt + 16) · ((L* + 16) / (Lm + 16))^k
 *     so for k = 1 the mean L* of the painted surface equals the target L*
 *     exactly, and every pixel keeps its relative lightness variation. This is
 *     multiplicative in linear light — how real light behaves — so very dark →
 *     very light (and back) does not go grey or muddy.
 *  4. L* = f(Y'). a*, b* are replaced by the target's a*, b*, scaled by the
 *     same cube-root factor shading applies to chroma in CIELAB, so shadows stay
 *     the same hue instead of becoming oversaturated.
 *  5. For light paints the shading exponent is reduced just enough that the
 *     lit parts stay below white (see shadingConstants); anything above is
 *     soft-compressed (no hard clipping). Out-of-gamut results are mapped back
 *     by reducing chroma at constant Y.
 *  6. Gloss/satin finishes add back part of the original specular highlights.
 */

import { lToY, yToL, labToXyz, xyzToLinearRgb, srgbToLinear, linearToSrgb, type Lab, type RGB } from "@/lib/color/lab";

export type Finish = "matte" | "satin" | "gloss";

export const FINISH_PARAMS: Record<Finish, { contrast: number; specular: number }> = {
  matte: { contrast: 0.92, specular: 0.0 },
  satin: { contrast: 1.0, specular: 0.3 },
  gloss: { contrast: 1.04, specular: 0.65 },
};

/** Lightness statistics of the original pixels under a surface mask. */
export type SurfaceStats = {
  /** Mean L* (mask-weighted). */
  meanL: number;
  /** 95th-percentile L* — how bright the lit parts of the surface are. */
  highL: number;
};

export type RecolorParams = {
  target: Lab;
  stats: SurfaceStats;
  finish: Finish;
  /** Exposure multiplier (1 = exact mean-lightness match). */
  brightness: number;
};

/** Per-surface constants shared by the CPU model and the shader uniforms. */
export type ShadingConstants = {
  /** Target luminance after the brightness adjustment. */
  targetY: number;
  /** Reference luminance of the source surface: Y(mean L*). */
  refY: number;
  /** Shading exponent k (finish contrast, reduced if needed for highlight headroom). */
  contrast: number;
  /** Highlight preservation strength (finish). */
  specular: number;
  /** Soft-clip knee in luminance. */
  knee: number;
};

/** Brightest L* the lit parts of a surface may reach before soft-clipping. */
const HEADROOM_L = 98;
/** Keep at least this much of the original shading contrast. */
const MIN_CONTRAST = 0.35;

export function luminance(r: number, g: number, b: number): number {
  return 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
}

/** Soft knee: identity below `knee`, asymptotically approaches 1 above it. */
export function softClip(y: number, knee: number): number {
  if (y <= knee) return y;
  const range = 1 - knee;
  return knee + range * (1 - Math.exp(-(y - knee) / range));
}

/**
 * Derive the shading constants for a surface. With k the shading exponent,
 *   L*' + 16 = (Lt + 16) · ((L* + 16) / (Lm + 16))^k .
 * For light paints the lit parts (highL) could exceed white; k is then reduced
 * just enough that highL maps to HEADROOM_L, so light paints keep visible
 * shading instead of blowing out (a camera would expose such a wall the same way).
 */
export function shadingConstants(target: Lab, stats: SurfaceStats, finish: Finish, brightness: number): ShadingConstants {
  const f = FINISH_PARAMS[finish];
  const targetY = lToY(target.L) * brightness;
  const effL = Math.min(yToL(targetY), HEADROOM_L - 4);
  let contrast = f.contrast;
  const spread = Math.log((stats.highL + 16) / (stats.meanL + 16));
  if (spread > 1e-3) {
    const kMax = Math.log((HEADROOM_L + 16) / (effL + 16)) / spread;
    contrast = Math.max(MIN_CONTRAST, Math.min(contrast, kMax));
  }
  return {
    targetY,
    refY: lToY(stats.meanL),
    contrast,
    specular: f.specular,
    knee: Math.min(0.97, Math.max(lToY(HEADROOM_L - 6), targetY)),
  };
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Pull a linear RGB color into [0,1]^3 by mixing toward grey of equal luminance. */
export function gamutMap(rgb: [number, number, number], y: number): [number, number, number] {
  const g = Math.min(1, Math.max(0, y));
  let t = 1;
  for (const c of rgb) {
    if (c > 1) t = Math.min(t, (1 - g) / (c - g));
    else if (c < 0) t = Math.min(t, g / (g - c));
  }
  t = Math.max(0, t);
  return rgb.map((c) => Math.min(1, Math.max(0, g + t * (c - g)))) as [number, number, number];
}

/** Recolor a single sRGB pixel (0..255) fully covered by the mask. */
export function recolorPixel(src: RGB, p: RecolorParams): RGB {
  const c = shadingConstants(p.target, p.stats, p.finish, p.brightness);
  const sr = srgbToLinear(src.r / 255);
  const sg = srgbToLinear(src.g / 255);
  const sb = srgbToLinear(src.b / 255);
  const Y = luminance(sr, sg, sb);

  const Lt = p.target.L;
  const r = Y / Math.max(c.refY, 1e-4);
  const Yn = softClip(c.targetY * Math.pow(r, c.contrast), c.knee);
  const L = yToL(Yn);
  const chroma = Math.min(1, (L + 16) / (Lt + 16));
  const lab: Lab = { L, a: p.target.a * chroma, b: p.target.b * chroma };

  let rgb = gamutMap(xyzToLinearRgb(labToXyz(lab)), Yn);

  if (c.specular > 0) {
    const maxC = Math.max(sr, sg, sb);
    const minC = Math.min(sr, sg, sb);
    const sat = maxC > 0 ? (maxC - minC) / maxC : 0;
    const spec = smoothstep(1.25, 2.2, r) * (1 - sat) * c.specular;
    rgb = rgb.map((v, i) => {
      const s = [sr, sg, sb][i] ?? 0;
      return v + (Math.max(v, s) - v) * spec;
    }) as [number, number, number];
  }

  const to8 = (v: number) => Math.round(linearToSrgb(Math.min(1, Math.max(0, v))) * 255);
  return { r: to8(rgb[0]), g: to8(rgb[1]), b: to8(rgb[2]) };
}

/**
 * Weighted mean of a per-pixel channel (e.g. L*) under an 8-bit mask.
 * Returns null if the mask is empty.
 */
export function maskedMean(values: Float32Array, mask: Uint8Array): number | null {
  let sum = 0;
  let wsum = 0;
  for (let i = 0; i < mask.length; i++) {
    const w = mask[i] ?? 0;
    if (w === 0) continue;
    sum += (values[i] ?? 0) * w;
    wsum += w;
  }
  return wsum > 0 ? sum / wsum : null;
}

/**
 * Mean and 95th-percentile L* of the pixels under a mask (alpha-weighted),
 * via a 0.25-L* histogram. Returns null for an empty mask.
 */
export function surfaceStats(lightness: Float32Array, mask: Uint8Array): SurfaceStats | null {
  const BINS = 401;
  const hist = new Float64Array(BINS);
  let sum = 0;
  let wsum = 0;
  for (let i = 0; i < mask.length; i++) {
    const w = mask[i] ?? 0;
    if (w === 0) continue;
    const L = lightness[i] ?? 0;
    sum += L * w;
    wsum += w;
    hist[Math.min(BINS - 1, Math.max(0, Math.round(L * 4)))]! += w;
  }
  if (wsum === 0) return null;
  const goal = wsum * 0.95;
  let acc = 0;
  let bin = BINS - 1;
  for (let b = 0; b < BINS; b++) {
    acc += hist[b] ?? 0;
    if (acc >= goal) {
      bin = b;
      break;
    }
  }
  return { meanL: sum / wsum, highL: bin / 4 };
}

/** Linear luminance per pixel from RGBA ImageData-like bytes. */
export function computeLuminance(rgba: Uint8ClampedArray | Uint8Array): Float32Array {
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) lut[i] = srgbToLinear(i / 255);
  const n = rgba.length >> 2;
  const out = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    out[i] = luminance(lut[rgba[j] ?? 0] ?? 0, lut[rgba[j + 1] ?? 0] ?? 0, lut[rgba[j + 2] ?? 0] ?? 0);
  }
  return out;
}

/** CIE L* per pixel from RGBA bytes. */
export function computeLightness(rgba: Uint8ClampedArray | Uint8Array): Float32Array {
  const y = computeLuminance(rgba);
  for (let i = 0; i < y.length; i++) y[i] = yToL(y[i] ?? 0);
  return y;
}
