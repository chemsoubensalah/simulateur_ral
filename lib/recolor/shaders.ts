/**
 * GLSL (WebGL 1 / GLSL ES 1.00) shaders for real-time recoloring.
 * The surface shader is a 1:1 port of recolorPixel() in ./model.ts.
 */

export const VERTEX_SHADER = /* glsl */ `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  // aPos in [0,1]^2; texture row 0 is the top of the image.
  vUv = aPos;
  gl_Position = vec4(aPos.x * 2.0 - 1.0, 1.0 - aPos.y * 2.0, 0.0, 1.0);
}
`;


const COLOR_GLSL = /* glsl */ `
const float EPS = 0.008856451679035631; // 216/24389
const float KAPPA = 903.2962962962963;  // 24389/27
const vec3 D65 = vec3(0.95047, 1.0, 1.08883);

float srgbToLinear(float c) {
  return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4);
}
vec3 srgbToLinear3(vec3 c) {
  return vec3(srgbToLinear(c.r), srgbToLinear(c.g), srgbToLinear(c.b));
}
float linearToSrgb(float c) {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * pow(c, 1.0 / 2.4) - 0.055;
}
vec3 linearToSrgb3(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return vec3(linearToSrgb(c.r), linearToSrgb(c.g), linearToSrgb(c.b));
}
float luminance(vec3 lin) {
  return dot(lin, vec3(0.2126729, 0.7151522, 0.072175));
}
float yToL(float y) {
  return y > EPS ? 116.0 * pow(y, 1.0 / 3.0) - 16.0 : KAPPA * y;
}
float lToY(float L) {
  return L > KAPPA * EPS ? pow((L + 16.0) / 116.0, 3.0) : L / KAPPA;
}
float fInv(float t) {
  float t3 = t * t * t;
  return t3 > EPS ? t3 : (116.0 * t - 16.0) / KAPPA;
}
vec3 labToLinear(vec3 lab) {
  float fy = (lab.x + 16.0) / 116.0;
  float fx = fy + lab.y / 500.0;
  float fz = fy - lab.z / 200.0;
  float yr = lab.x > KAPPA * EPS ? fy * fy * fy : lab.x / KAPPA;
  vec3 xyz = vec3(fInv(fx), yr, fInv(fz)) * D65;
  return vec3(
     3.2404542 * xyz.x - 1.5371385 * xyz.y - 0.4985314 * xyz.z,
    -0.9692660 * xyz.x + 1.8760108 * xyz.y + 0.0415560 * xyz.z,
     0.0556434 * xyz.x - 0.2040259 * xyz.y + 1.0572252 * xyz.z);
}
float softClip(float y, float knee) {
  if (y <= knee) return y;
  float range = 1.0 - knee;
  return knee + range * (1.0 - exp(-(y - knee) / range));
}
float gamutT(float c, float g) {
  if (c > 1.0) return (1.0 - g) / (c - g);
  if (c < 0.0) return g / (g - c);
  return 1.0;
}
vec3 gamutMap(vec3 rgb, float y) {
  float g = clamp(y, 0.0, 1.0);
  float t = min(1.0, min(gamutT(rgb.r, g), min(gamutT(rgb.g, g), gamutT(rgb.b, g))));
  t = max(0.0, t);
  return clamp(vec3(g) + t * (rgb - vec3(g)), 0.0, 1.0);
}
`;

export const BASE_FRAGMENT_SHADER = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uImage;
uniform vec3 uImageGain;   // colour of the light (1,1,1 = as photographed)
${COLOR_GLSL}
void main() {
  vec3 c = texture2D(uImage, vUv).rgb;
  if (uImageGain != vec3(1.0)) c = linearToSrgb3(srgbToLinear3(c) * uImageGain);
  gl_FragColor = vec4(c, 1.0);
}
`;

export const SURFACE_FRAGMENT_SHADER = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uImage;
uniform sampler2D uMask;
uniform vec3 uTargetLab;   // L*, a*, b* of the paint
uniform float uTargetY;    // paint luminance incl. brightness adjustment
uniform float uRefY;       // reference luminance: Y of the surface's mean L*
uniform float uContrast;   // shading exponent k (finish + highlight headroom)
uniform float uKnee;       // soft-clip knee
uniform float uSpecular;   // finish: highlight preservation
uniform sampler2D uShading; // smooth lighting of the surface, L*/100 (see shading.ts)
uniform float uCleanup;    // 1 = hide stains and defects
uniform float uBeta;       // kept share of mid-scale variation (stains)
uniform float uTexture;    // kept share of fine texture
uniform vec2 uTexel;       // 1 / image size
uniform vec3 uImageGain;   // colour of the light on the photo
uniform vec3 uPaintGain;   // colour of the light on the paint
${COLOR_GLSL}
// Cheap luminance proxy (sRGB^2) for ratios between nearby pixels.
float lumProxy(vec3 c) { return dot(c * c, vec3(0.2126729, 0.7151522, 0.072175)); }

void main() {
  float m = texture2D(uMask, vUv).r;
  if (m <= 0.0) discard;
  vec3 srcS = texture2D(uImage, vUv).rgb;
  vec3 src = srgbToLinear3(srcS);
  float Y = luminance(src);

  float Lt = uTargetLab.x;
  float ref = max(uRefY, 1e-4);
  float r = Y / ref;
  if (uCleanup > 0.5) {
    float light = max(lToY(texture2D(uShading, vUv).r * 100.0), 1e-4);
    // Local mean over a 4x4 neighbourhood (4 bilinear taps), weighted by the
    // mask so neighbouring objects do not leak into the wall.
    vec2 d = uTexel * 1.5;
    vec2 o0 = vUv + vec2(-d.x, -d.y);
    vec2 o1 = vUv + vec2(d.x, -d.y);
    vec2 o2 = vUv + vec2(-d.x, d.y);
    vec2 o3 = vUv + d;
    vec4 w = vec4(texture2D(uMask, o0).r, texture2D(uMask, o1).r, texture2D(uMask, o2).r, texture2D(uMask, o3).r);
    vec4 l = vec4(lumProxy(texture2D(uImage, o0).rgb), lumProxy(texture2D(uImage, o1).rgb),
                  lumProxy(texture2D(uImage, o2).rgb), lumProxy(texture2D(uImage, o3).rgb));
    float ws = dot(w, vec4(1.0));
    float fine = ws > 0.05 ? clamp(lumProxy(srcS) / max(dot(w, l) / ws, 1e-5), 0.5, 2.0) : 1.0;
    // local ≈ Y / fine (the luminance averaged over the neighbourhood).
    float local = max(Y / fine, 1e-4);
    r = (light / ref) * pow(local / light, uBeta) * pow(fine, uTexture);
  }

  float Yn = softClip(uTargetY * pow(max(r, 0.0), uContrast), uKnee);
  float L = yToL(Yn);
  float chroma = min(1.0, (L + 16.0) / (Lt + 16.0));
  vec3 rgb = gamutMap(labToLinear(vec3(L, uTargetLab.yz * chroma)) * uPaintGain, Yn * luminance(uPaintGain));

  if (uSpecular > 0.0) {
    float maxC = max(src.r, max(src.g, src.b));
    float minC = min(src.r, min(src.g, src.b));
    float sat = maxC > 0.0 ? (maxC - minC) / maxC : 0.0;
    float spec = smoothstep(1.25, 2.2, Y / ref) * (1.0 - sat) * uSpecular;
    rgb = mix(rgb, max(rgb, src * uImageGain), spec);
  }

  gl_FragColor = vec4(linearToSrgb3(rgb), m);
}
`;

export const OVERLAY_FRAGMENT_SHADER = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uMask;
uniform vec2 uSize;
uniform vec3 uColor;
uniform float uOpacity;
void main() {
  float m = texture2D(uMask, vUv).r;
  // Edge detection on the mask for a crisp outline.
  vec2 px = 1.5 / uSize;
  float e = abs(texture2D(uMask, vUv + vec2(px.x, 0.0)).r - texture2D(uMask, vUv - vec2(px.x, 0.0)).r)
          + abs(texture2D(uMask, vUv + vec2(0.0, px.y)).r - texture2D(uMask, vUv - vec2(0.0, px.y)).r);
  float edge = clamp(e * 2.0, 0.0, 1.0);
  // Diagonal stripes so the selection is visible on any colour.
  vec2 p = vUv * uSize;
  float stripe = step(0.5, fract((p.x + p.y) / 14.0));
  float a = max(m * uOpacity * (0.55 + 0.45 * stripe), edge * 0.95);
  if (a <= 0.0) discard;
  gl_FragColor = vec4(mix(uColor, vec3(1.0), edge * 0.6), a);
}
`;
