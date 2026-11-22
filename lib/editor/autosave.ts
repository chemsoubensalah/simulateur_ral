/**
 * Automatic saving of the current editing session on the device (IndexedDB),
 * so nothing is lost if the browser reloads the page (e.g. low memory on a
 * phone), the user navigates back, or switches language.
 *
 * Stored: the working photo (JPEG) and the surfaces with their masks
 * (run-length encoded — masks are long runs of 0 / 255, typically a few KB).
 */
import { idbDelete, idbGet, idbPut } from "@/lib/segmentation/idbCache";
import { packEnvelope, unpackEnvelope } from "@/lib/segmentation/f16";
import type { Finish } from "@/lib/recolor/model";
import type { LightMode } from "@/lib/recolor/lighting";

const IMAGE_KEY = "session:image";
const STATE_KEY = "session:state";
const MAX_AGE_MS = 14 * 24 * 3600 * 1000;

export type SavedSurface = {
  id: string;
  name: string;
  hex: string | null;
  paintId: string | null;
  finish: Finish;
  brightness: number;
  feather: number;
  visible: boolean;
  /** Hide stains and defects (missing in sessions saved before it existed: on). */
  cleanup?: boolean;
  mask: Uint8Array;
};

export type SavedSession = {
  savedAt: number;
  width: number;
  height: number;
  selectedId: string | null;
  /** Lighting view (missing: as photographed). */
  light?: LightMode;
  surfaces: SavedSurface[];
};

/* ---------- run-length encoding ---------- */

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

/* ---------- (de)serialisation ---------- */

type Header = Omit<SavedSession, "surfaces"> & {
  version: 1;
  surfaces: (Omit<SavedSurface, "mask"> & { offset: number; length: number })[];
};

export function serializeSession(s: SavedSession): Uint8Array {
  const chunks = s.surfaces.map((x) => rleEncode(x.mask));
  let offset = 0;
  const header: Header = {
    version: 1,
    savedAt: s.savedAt,
    width: s.width,
    height: s.height,
    selectedId: s.selectedId,
    light: s.light,
    surfaces: s.surfaces.map((x, i) => {
      const { mask: _mask, ...meta } = x;
      void _mask;
      const entry = { ...meta, offset, length: chunks[i]!.length };
      offset += chunks[i]!.length;
      return entry;
    }),
  };
  const payload = new Uint8Array(offset);
  let o = 0;
  for (const c of chunks) {
    payload.set(c, o);
    o += c.length;
  }
  return packEnvelope(header, payload);
}

export function deserializeSession(buf: ArrayBuffer): SavedSession | null {
  try {
    const { header, payload } = unpackEnvelope<Header>(buf);
    if (header.version !== 1) return null;
    const n = header.width * header.height;
    return {
      savedAt: header.savedAt,
      width: header.width,
      height: header.height,
      selectedId: header.selectedId,
      light: header.light,
      surfaces: header.surfaces.map(({ offset, length, ...meta }) => ({
        ...meta,
        mask: rleDecode(payload.subarray(offset, offset + length), n),
      })),
    };
  } catch {
    return null;
  }
}

/* ---------- storage ---------- */

export async function saveSessionImage(blob: Blob): Promise<void> {
  await idbPut(IMAGE_KEY, await blob.arrayBuffer(), blob.type || "image/jpeg");
  await idbDelete(STATE_KEY); // a new photo starts a new session
}

export async function saveSessionState(s: SavedSession): Promise<void> {
  const bytes = serializeSession(s);
  await idbPut(STATE_KEY, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
}

/** The last saved session, if any (photo + state). */
export async function loadSession(): Promise<{ image: Blob; state: SavedSession | null; savedAt: number } | null> {
  const img = await idbGet(IMAGE_KEY);
  if (!img) return null;
  const st = await idbGet(STATE_KEY);
  const state = st ? deserializeSession(st.body) : null;
  const savedAt = state?.savedAt ?? img.storedAt;
  if (Date.now() - savedAt > MAX_AGE_MS) return null;
  return { image: new Blob([img.body], { type: img.contentType ?? "image/jpeg" }), state, savedAt };
}

export async function clearSession(): Promise<void> {
  await Promise.all([idbDelete(IMAGE_KEY), idbDelete(STATE_KEY)]);
}
