/**
 * Guided filter (He, Sun & Tang): smooths a mask while following the edges of
 * a guide image. Stair-steps left by low-resolution masks become straight
 * edges that sit on the photo's real edges; where the photo has no edge the
 * mask gets a short, soft transition instead of a jagged one.
 */

/** Box mean with radius r (clamped borders), separable, O(n). */
function boxMean(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = 0;
    let n = 0;
    for (let x = 0; x <= Math.min(r, w - 1); x++) {
      acc += src[row + x]!;
      n++;
    }
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / n;
      const add = x + r + 1;
      const sub = x - r;
      if (add < w) {
        acc += src[row + add]!;
        n++;
      }
      if (sub >= 0) {
        acc -= src[row + sub]!;
        n--;
      }
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    let n = 0;
    for (let y = 0; y <= Math.min(r, h - 1); y++) {
      acc += tmp[y * w + x]!;
      n++;
    }
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / n;
      const add = y + r + 1;
      const sub = y - r;
      if (add < h) {
        acc += tmp[add * w + x]!;
        n++;
      }
      if (sub >= 0) {
        acc -= tmp[sub * w + x]!;
        n--;
      }
    }
  }
  return out;
}

/**
 * Fast guided filter (He & Sun 2015): the linear coefficients are computed at
 * 1/`s` resolution and interpolated, so a 2048 px photo takes tens of ms.
 * Pixels that are fully inside or outside the mask (whole neighbourhood) are
 * left untouched.
 */
export function guidedFilterMask(
  mask: Uint8Array,
  rgba: Uint8Array | Uint8ClampedArray,
  w: number,
  h: number,
  r: number,
  eps = 0.0015,
  s = Math.max(1, Math.min(4, Math.floor(r / 2))),
  /** Sharpening of the result around 0.5: keeps the straightened edge crisp instead of a wide soft ramp. */
  gain = 2.5,
): Uint8Array {
  const sw = Math.ceil(w / s);
  const sh = Math.ceil(h / s);
  const n = sw * sh;
  // Downsample guide (luminance) and mask by area averaging.
  const I = new Float32Array(n);
  const p = new Float32Array(n);
  const cnt = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    const row = Math.floor(y / s) * sw;
    for (let x = 0; x < w; x++) {
      const j = row + Math.floor(x / s);
      const k = (y * w + x) * 4;
      I[j] = I[j]! + (0.299 * rgba[k]! + 0.587 * rgba[k + 1]! + 0.114 * rgba[k + 2]!) / 255;
      p[j] = p[j]! + mask[y * w + x]! / 255;
      cnt[j] = cnt[j]! + 1;
    }
  }
  const II = new Float32Array(n);
  const Ip = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    I[i] = I[i]! / cnt[i]!;
    p[i] = p[i]! / cnt[i]!;
    II[i] = I[i]! * I[i]!;
    Ip[i] = I[i]! * p[i]!;
  }
  const rs = Math.max(1, Math.round(r / s));
  const mI = boxMean(I, sw, sh, rs);
  const mp = boxMean(p, sw, sh, rs);
  const mII = boxMean(II, sw, sh, rs);
  const mIp = boxMean(Ip, sw, sh, rs);
  const a = new Float32Array(n);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const varI = mII[i]! - mI[i]! * mI[i]!;
    const cov = mIp[i]! - mI[i]! * mp[i]!;
    a[i] = cov / (varI + eps);
    b[i] = mp[i]! - a[i]! * mI[i]!;
  }
  const ma = boxMean(a, sw, sh, rs);
  const mb = boxMean(b, sw, sh, rs);
  // A cell is "settled" when its whole neighbourhood is in (1) or out (0) of the mask.
  const settledMean = boxMean(p, sw, sh, rs + 1);

  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(sh - 1, Math.max(0, (y + 0.5) / s - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(sh - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const cell = Math.floor(y / s) * sw + Math.floor(x / s);
      const m = settledMean[cell]!;
      if (m <= 1e-6 || m >= 1 - 1e-6) {
        out[i] = mask[i]!;
        continue;
      }
      const fx = Math.min(sw - 1, Math.max(0, (x + 0.5) / s - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(sw - 1, x0 + 1);
      const tx = fx - x0;
      const lerp = (arr: Float32Array) =>
        (arr[y0 * sw + x0]! * (1 - tx) + arr[y0 * sw + x1]! * tx) * (1 - ty) + (arr[y1 * sw + x0]! * (1 - tx) + arr[y1 * sw + x1]! * tx) * ty;
      const k = i * 4;
      const lum = (0.299 * rgba[k]! + 0.587 * rgba[k + 1]! + 0.114 * rgba[k + 2]!) / 255;
      const q = (lerp(ma) * lum + lerp(mb) - 0.5) * gain + 0.5;
      out[i] = Math.round(Math.min(1, Math.max(0, q)) * 255);
    }
  }
  return out;
}
