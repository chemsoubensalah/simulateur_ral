/**
 * Scene understanding: semantic segmentation of a room or facade photo
 * (SegFormer-B5, ADE20K: wall, ceiling, floor, door, window, furniture…).
 * POST body: JPEG/PNG (≤ 4 MB, ideally ≤ 1024 px). Returns a binary envelope:
 * JSON header + one class index (uint8) per cell of the label map.
 */
import os from "node:os";
import path from "node:path";
import { packEnvelope } from "@/lib/segmentation/f16";
import { SCENE_MODEL_ID, type SceneResponseHeader } from "@/lib/segmentation/scene";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 4 * 1024 * 1024;

type Loaded = {
  model: (inputs: unknown) => Promise<{ logits: { data: Float32Array; dims: number[] } }>;
  processor: (img: unknown) => Promise<unknown>;
  RawImage: { fromBlob(b: Blob): Promise<unknown> };
};

let loading: Promise<Loaded> | null = null;

function load(): Promise<Loaded> {
  loading ??= (async () => {
    const t = await import("@huggingface/transformers");
    t.env.cacheDir = process.env.SAM_CACHE_DIR ?? path.join(os.tmpdir(), "colorvision-models");
    t.env.allowLocalModels = false;
    const [model, processor] = await Promise.all([
      t.AutoModelForSemanticSegmentation.from_pretrained(SCENE_MODEL_ID, { dtype: "q8" }),
      t.AutoProcessor.from_pretrained(SCENE_MODEL_ID),
    ]);
    return { model, processor, RawImage: t.RawImage } as unknown as Loaded;
  })();
  loading.catch(() => (loading = null));
  return loading;
}

export async function GET() {
  return Response.json({ available: process.env.SCENE_SERVER !== "off", model: SCENE_MODEL_ID });
}

export async function POST(req: Request) {
  if (process.env.SCENE_SERVER === "off") return Response.json({ error: "disabled" }, { status: 503 });
  const type = req.headers.get("content-type") ?? "";
  if (!/^image\/(jpeg|png|webp)$/.test(type)) return Response.json({ error: "unsupported media type" }, { status: 415 });
  try {
    const buf = await req.arrayBuffer();
    if (buf.byteLength === 0 || buf.byteLength > MAX_BYTES) return Response.json({ error: "invalid body" }, { status: 400 });
    const { model, processor, RawImage } = await load();
    const t0 = performance.now();
    const image = await RawImage.fromBlob(new Blob([buf], { type }));
    const out = await model(await processor(image));
    const [, C, h, w] = out.logits.dims as [number, number, number, number];
    const d = out.logits.data;
    const classes = new Uint8Array(h * w);
    const plane = h * w;
    for (let i = 0; i < plane; i++) {
      let best = 0;
      let bv = -Infinity;
      for (let c = 0; c < C; c++) {
        const v = d[c * plane + i]!;
        if (v > bv) {
          bv = v;
          best = c;
        }
      }
      classes[i] = best;
    }
    const header: SceneResponseHeader = { model: SCENE_MODEL_ID, width: w, height: h, ms: Math.round(performance.now() - t0) };
    return new Response(packEnvelope(header, classes).buffer as ArrayBuffer, {
      headers: { "content-type": "application/octet-stream", "cache-control": "no-store" },
    });
  } catch (e) {
    console.error("[scene]", e);
    return Response.json({ error: "scene analysis failed" }, { status: 500 });
  }
}
