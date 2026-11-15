/**
 * Color space conversions: sRGB <-> linear RGB <-> CIE XYZ (D65) <-> CIELAB / LCh.
 *
 * All conversions use the D65 white point and the IEC 61966-2-1 sRGB transfer
 * function. The same formulas are mirrored in the WebGL recolor shader
 * (lib/recolor/shaders.ts) so CPU and GPU agree.
 */

export type RGB = { r: number; g: number; b: number }; // 0..255
export type Lab = { L: number; a: number; b: number };
export type LCh = { L: number; C: number; h: number }; // h in degrees [0, 360)
export type XYZ = { x: number; y: number; z: number };

/** D65 reference white (Y normalised to 1). */
export const D65 = { x: 0.95047, y: 1.0, z: 1.08883 } as const;

const EPSILON = 216 / 24389; // (6/29)^3
const KAPPA = 24389 / 27; // (29/3)^3

export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

export function rgbToXyz({ r, g, b }: RGB): XYZ {
  const R = srgbToLinear(r / 255);
  const G = srgbToLinear(g / 255);
  const B = srgbToLinear(b / 255);
  return {
    x: 0.4124564 * R + 0.3575761 * G + 0.1804375 * B,
    y: 0.2126729 * R + 0.7151522 * G + 0.072175 * B,
    z: 0.0193339 * R + 0.119192 * G + 0.9503041 * B,
  };
}

/** Returns unclamped linear RGB (may fall outside [0,1] for out-of-gamut colors). */
export function xyzToLinearRgb({ x, y, z }: XYZ): [number, number, number] {
  return [
    3.2404542 * x - 1.5371385 * y - 0.4985314 * z,
    -0.969266 * x + 1.8760108 * y + 0.041556 * z,
    0.0556434 * x - 0.2040259 * y + 1.0572252 * z,
  ];
}

export function xyzToRgb(xyz: XYZ): RGB {
  const [R, G, B] = xyzToLinearRgb(xyz);
  const to8 = (v: number) => Math.round(Math.min(1, Math.max(0, linearToSrgb(Math.min(1, Math.max(0, v))))) * 255);
  return { r: to8(R), g: to8(G), b: to8(B) };
}

function f(t: number): number {
  return t > EPSILON ? Math.cbrt(t) : (KAPPA * t + 16) / 116;
}

function fInv(t: number): number {
  const t3 = t * t * t;
  return t3 > EPSILON ? t3 : (116 * t - 16) / KAPPA;
}

export function xyzToLab({ x, y, z }: XYZ): Lab {
  const fx = f(x / D65.x);
  const fy = f(y / D65.y);
  const fz = f(z / D65.z);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

export function labToXyz({ L, a, b }: Lab): XYZ {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const yr = L > KAPPA * EPSILON ? fy * fy * fy : L / KAPPA;
  return { x: fInv(fx) * D65.x, y: yr * D65.y, z: fInv(fz) * D65.z };
}

export function rgbToLab(rgb: RGB): Lab {
  return xyzToLab(rgbToXyz(rgb));
}

export function labToRgb(lab: Lab): RGB {
  return xyzToRgb(labToXyz(lab));
}

/** Relative luminance Y (0..1) -> CIE L* (0..100). */
export function yToL(y: number): number {
  return y > EPSILON ? 116 * Math.cbrt(y) - 16 : KAPPA * y;
}

/** CIE L* (0..100) -> relative luminance Y (0..1). */
export function lToY(L: number): number {
  return L > KAPPA * EPSILON ? Math.pow((L + 16) / 116, 3) : L / KAPPA;
}

export function labToLch({ L, a, b }: Lab): LCh {
  const C = Math.hypot(a, b);
  let h = (Math.atan2(b, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { L, C, h };
}

export function lchToLab({ L, C, h }: LCh): Lab {
  const rad = (h * Math.PI) / 180;
  return { L, a: C * Math.cos(rad), b: C * Math.sin(rad) };
}

export function hexToRgb(hex: string): RGB {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m || !m[1]) throw new Error(`Invalid hex color: ${hex}`);
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex({ r, g, b }: RGB): string {
  const h = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase();
}

export function hexToLab(hex: string): Lab {
  return rgbToLab(hexToRgb(hex));
}

export function isValidHex(hex: string): boolean {
  return /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex.trim());
}
