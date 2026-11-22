/**
 * Precise walls and ceiling with SAM 3 (text prompts "wall" / "ceiling").
 * Provider: fal.ai (FAL_KEY), a self-hosted ONNX model in this server
 * (SAM3_ONNX_DIR), or another server running this app with SAM3_ONNX_DIR
 * (SAM3_REMOTE_URL, optional shared secret SAM3_REMOTE_TOKEN).
 * GET → { available, provider }. POST body: the photo as JPEG (≤ 4 MB).
 * Response: binary envelope — JSON header (instances: kind, score, offset,
 * length) + run-length encoded 0/255 masks of maskSize(width, height).
 */
import sharp from "sharp";
import { packEnvelope } from "@/lib/segmentation/f16";
import { rleEncode } from "@/lib/mask/rle";
import { dedupe, maskSize, type Sam3ResponseHeader } from "@/lib/segmentation/sam3";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 4 * 1024 * 1024;
let running = 0;

function provider(): "fal" | "local" | "remote" | null {
  if (process.env.SAM3 === "off") return null;
  if (process.env.FAL_KEY) return "fal";
  if (process.env.SAM3_ONNX_DIR) return "local";
  if (process.env.SAM3_REMOTE_URL) return "remote";
  return null;
}

export async function GET() {
  const p = provider();
  return Response.json({ available: !!p, provider: p });
}

export async function POST(req: Request) {
  const p = provider();
  if (!p) return Response.json({ error: "SAM 3 is not configured" }, { status: 404 });
  // Shared secret, when this server does the work for another one.
  const token = process.env.SAM3_REMOTE_TOKEN;
  if (p === "local" && token && req.headers.get("x-sam3-token") !== token && process.env.SAM3_PUBLIC !== "on")
    return Response.json({ error: "Forbidden" }, { status: 403 });
  const type = req.headers.get("content-type") ?? "";
  if (!/^image\/(jpeg|png|webp)/.test(type)) return Response.json({ error: "Expected an image" }, { status: 415 });
  const body = Buffer.from(await req.arrayBuffer());
  if (body.length > MAX_BYTES) return Response.json({ error: "Image too large" }, { status: 413 });
  // The self-hosted model uses all cores for one photo at a time.
  if (p === "local" && running >= 2) return Response.json({ error: "Busy" }, { status: 503 });
  if (p === "remote") {
    // Forward to the server that runs the model.
    const res = await fetch(`${process.env.SAM3_REMOTE_URL!.replace(/\/+$/, "")}/api/walls`, {
      method: "POST",
      body,
      headers: { "content-type": type, ...(token ? { "x-sam3-token": token } : {}) },
    }).catch(() => null);
    if (!res) return Response.json({ error: "SAM 3 server unreachable" }, { status: 502 });
    return new Response(res.body, { status: res.status, headers: { "content-type": res.headers.get("content-type") ?? "application/octet-stream", "cache-control": "no-store" } });
  }
  running++;
  const t0 = Date.now();
  try {
    const meta = await sharp(body).metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    if (!w || !h) return Response.json({ error: "Unreadable image" }, { status: 400 });
    const jpeg = type.startsWith("image/jpeg") ? body : await sharp(body).jpeg({ quality: 90 }).toBuffer();
    const found =
      p === "fal"
        ? await (await import("@/lib/server/sam3Fal")).sam3Fal(process.env.FAL_KEY!, jpeg, w, h)
        : await (await import("@/lib/server/sam3Local")).sam3Local(process.env.SAM3_ONNX_DIR!, jpeg);
    const list = dedupe(found);
    const { width, height } = maskSize(w, h);
    const chunks = list.map((m) => rleEncode(m.mask));
    let offset = 0;
    const header: Sam3ResponseHeader = {
      provider: p,
      width,
      height,
      ms: Date.now() - t0,
      instances: list.map((m, i) => {
        const entry = { kind: m.kind, score: Math.round(m.score * 1000) / 1000, offset, length: chunks[i]!.length };
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
    const buf = packEnvelope(header, payload);
    return new Response(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, {
      headers: { "content-type": "application/octet-stream", "cache-control": "no-store" },
    });
  } catch (e) {
    console.error("sam3", e);
    return Response.json({ error: "Segmentation failed" }, { status: 502 });
  } finally {
    running--;
  }
}
