/** Run-length encoding of masks (long runs of 0 / 255): a few KB per mask. */

/** RLE: [value u8][run length LEB128 varint]… */
export function rleEncode(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < data.length) {
    const v = data[i]!;
    let run = 1;
    while (i + run < data.length && data[i + run] === v) run++;
    out.push(v);
    let n = run;
    while (n >= 0x80) {
      out.push((n & 0x7f) | 0x80);
      n >>>= 7;
    }
    out.push(n);
    i += run;
  }
  return Uint8Array.from(out);
}

export function rleDecode(data: Uint8Array, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let o = 0;
  let i = 0;
  while (i < data.length && o < length) {
    const v = data[i++]!;
    let run = 0;
    let shift = 0;
    for (;;) {
      const b = data[i++]!;
      run |= (b & 0x7f) << shift;
      if (b < 0x80) break;
      shift += 7;
    }
    out.fill(v, o, Math.min(length, o + run));
    o += run;
  }
  return out;
}

