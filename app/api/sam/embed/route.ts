/**
 * Server fallback for devices too slow to run the SAM image encoder locally.
 * Runs the same SlimSAM encoder with ONNX Runtime (Node) and returns the
 * embeddings as float16; the browser then decodes taps locally as usual.
 *
 * POST body: JPEG/PNG (≤ 4 MB, ideally ≤ 1024 px). Query `pe=0` skips the
 * constant positional embeddings when the client already has them cached.
 */
import os from "node:os";
import path from "node:path";
import { encodeHalf, packEnvelope } from "@/lib/segmentation/f16";
import { SAM_MODEL_ID, type EmbedResponseHeader } from "@/lib/segmentation/protocol";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 4 * 1024 * 1024;
const MAX_CONCURRENT = 2;

type Loaded = {
  // Typed loosely: the transformers.js Node build is imported dynamically.
  model: { get_image_embeddings(i: unknown): Promise<{ image_embeddings: { data: Float32Array; dims: number[] }; image_positional_embeddings: { data: Float32Array } }> };
  processor: (img: unknown) => Promise<{ original_sizes: number[][]; reshaped_input_sizes: number[][] }>;
  RawImage: { fromBlob(b: Blob): Promise<unknown> };
};

let loading: Promise<Loaded> | null = null;
let active = 0;

function enabled(): boolean {
  return process.env.SAM_SERVER_FALLBACK !== "off";
}

function load(): Promise<Loaded> {
  loading ??= (async () => {
    const t = await import("@huggingface/transformers");
    t.env.cacheDir = process.env.SAM_CACHE_DIR ?? path.join(os.tmpdir(), "colorvision-models");
    t.env.allowLocalModels = false;
    const [model, processor] = await Promise.all([
      t.SamModel.from_pretrained(SAM_MODEL_ID, { dtype: "q8" }),
      t.AutoProcessor.from_pretrained(SAM_MODEL_ID),
    ]);
    return { model, processor, RawImage: t.RawImage } as unknown as Loaded;
  })();
  loading.catch(() => (loading = null));
  return loading;
}

export async function GET() {
  return Response.json({ available: enabled(), model: SAM_MODEL_ID });
}

export async function POST(req: Request) {
  if (!enabled()) return Response.json({ error: "disabled" }, { status: 503 });
  const type = req.headers.get("content-type") ?? "";
  if (!/^image\/(jpeg|png|webp)$/.test(type)) return Response.json({ error: "unsupported media type" }, { status: 415 });
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_BYTES) return Response.json({ error: "too large" }, { status: 413 });
  if (active >= MAX_CONCURRENT) return Response.json({ error: "busy" }, { status: 503, headers: { "retry-after": "2" } });

  active++;
  try {
    const buf = await req.arrayBuffer();
    if (buf.byteLength === 0 || buf.byteLength > MAX_BYTES) return Response.json({ error: "invalid body" }, { status: 400 });
    const withPe = new URL(req.url).searchParams.get("pe") !== "0";
    const { model, processor, RawImage } = await load();
    const t0 = performance.now();
    const image = await RawImage.fromBlob(new Blob([buf], { type }));
    const inputs = await processor(image);
    const out = await model.get_image_embeddings(inputs);
    const [oh, ow] = inputs.original_sizes[0] as [number, number];
    const [rh, rw] = inputs.reshaped_input_sizes[0] as [number, number];
    const img = encodeHalf(out.image_embeddings.data);
    const pe = withPe ? encodeHalf(out.image_positional_embeddings.data) : new Uint16Array(0);
    const payload = new Uint8Array(img.byteLength + pe.byteLength);
    payload.set(new Uint8Array(img.buffer), 0);
    payload.set(new Uint8Array(pe.buffer), img.byteLength);
    const header: EmbedResponseHeader = {
      model: SAM_MODEL_ID,
      geometry: { originalWidth: ow, originalHeight: oh, reshapedWidth: rw, reshapedHeight: rh },
      dims: out.image_embeddings.dims,
      hasPositional: withPe,
      ms: Math.round(performance.now() - t0),
    };
    return new Response(packEnvelope(header, payload).buffer as ArrayBuffer, {
      headers: { "content-type": "application/octet-stream", "cache-control": "no-store" },
    });
  } catch (e) {
    console.error("[sam/embed]", e);
    return Response.json({ error: "segmentation failed" }, { status: 500 });
  } finally {
    active--;
  }
}
