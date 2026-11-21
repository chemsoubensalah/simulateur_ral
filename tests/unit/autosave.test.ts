import { describe, expect, it } from "vitest";
import { deserializeSession, rleDecode, rleEncode, serializeSession, type SavedSession } from "@/lib/editor/autosave";

describe("autosave", () => {
  it("run-length encodes masks compactly and losslessly", () => {
    const w = 2048, h = 1536;
    const m = new Uint8Array(w * h);
    for (let y = 300; y < 900; y++) for (let x = 200; x < 1500; x++) m[y * w + x] = 255;
    for (let y = 300; y < 900; y++) m[y * w + 1500] = 128; // anti-aliased edge
    const enc = rleEncode(m);
    expect(enc.length).toBeLessThan(10_000); // 3 MB mask → a few KB
    expect(Buffer.compare(Buffer.from(rleDecode(enc, m.length)), Buffer.from(m))).toBe(0);
  });

  it("handles long runs, single values and empty masks", () => {
    for (const m of [new Uint8Array(0), new Uint8Array([7]), new Uint8Array(300_000).fill(255), Uint8Array.from({ length: 1000 }, (_, i) => i % 256)])
      expect(Buffer.compare(Buffer.from(rleDecode(rleEncode(m), m.length)), Buffer.from(m))).toBe(0);
  });

  it("serialises and restores a whole session", () => {
    const n = 64 * 48;
    const s: SavedSession = {
      savedAt: 1_700_000_000_000,
      width: 64,
      height: 48,
      selectedId: "b",
      surfaces: [
        { id: "a", name: "Wall", hex: "#F7F9EF", paintId: "ral-classic:RAL 9010", finish: "matte", brightness: 1, feather: 0, visible: true, mask: new Uint8Array(n).fill(255) },
        { id: "b", name: "سطح 2", hex: null, paintId: null, finish: "gloss", brightness: 1.2, feather: 1, visible: false, mask: Uint8Array.from({ length: n }, (_, i) => (i % 7 ? 0 : 200)) },
      ],
    };
    const bytes = serializeSession(s);
    const back = deserializeSession(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    expect(back).toEqual(s);
    expect(deserializeSession(new ArrayBuffer(8))).toBeNull();
  });
});
