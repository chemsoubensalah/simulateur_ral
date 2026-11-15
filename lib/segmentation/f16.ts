/** IEEE 754 half-precision encode/decode (used to halve the size of server-computed embeddings). */

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

export function toHalf(value: number): number {
  f32[0] = value;
  const x = u32[0]!;
  const sign = (x >>> 16) & 0x8000;
  const exp = ((x >>> 23) & 0xff) - 127 + 15;
  let mant = x & 0x7fffff;
  if (exp >= 0x1f) {
    // Overflow / Inf / NaN
    return sign | 0x7c00 | (((x >>> 23) & 0xff) === 0xff && mant ? 0x200 : 0);
  }
  if (exp <= 0) {
    if (exp < -10) return sign; // underflow to zero
    mant |= 0x800000;
    const shift = 14 - exp;
    let half = mant >> shift;
    if ((mant >> (shift - 1)) & 1) half += 1; // round half up
    return sign | half;
  }
  let half = sign | (exp << 10) | (mant >> 13);
  if (mant & 0x1000) half += 1; // round to nearest
  return half;
}

export function fromHalf(h: number): number {
  const sign = h & 0x8000 ? -1 : 1;
  const exp = (h >> 10) & 0x1f;
  const mant = h & 0x3ff;
  if (exp === 0) return sign * Math.pow(2, -14) * (mant / 1024);
  if (exp === 0x1f) return mant ? NaN : sign * Infinity;
  return sign * Math.pow(2, exp - 15) * (1 + mant / 1024);
}

export function encodeHalf(data: Float32Array): Uint16Array {
  const out = new Uint16Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = toHalf(data[i]!);
  return out;
}

export function decodeHalf(data: Uint16Array): Float32Array {
  // Lookup table: 65536 entries, built once.
  const lut = halfLut();
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = lut[data[i]!]!;
  return out;
}

let lutCache: Float32Array | null = null;
function halfLut(): Float32Array {
  if (!lutCache) {
    lutCache = new Float32Array(65536);
    for (let i = 0; i < 65536; i++) lutCache[i] = fromHalf(i);
  }
  return lutCache;
}

/**
 * Binary envelope: [u32 header length][UTF-8 JSON header][padding to 2][payload].
 * Used by /api/sam/embed.
 */
export function packEnvelope(header: object, payload: Uint8Array): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(header));
  const pad = (4 + json.length) % 2;
  const out = new Uint8Array(4 + json.length + pad + payload.length);
  new DataView(out.buffer).setUint32(0, json.length, true);
  out.set(json, 4);
  out.set(payload, 4 + json.length + pad);
  return out;
}

export function unpackEnvelope<T>(buf: ArrayBuffer): { header: T; payload: Uint8Array } {
  const len = new DataView(buf).getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, len))) as T;
  const start = 4 + len + ((4 + len) % 2);
  return { header, payload: new Uint8Array(buf, start) };
}
