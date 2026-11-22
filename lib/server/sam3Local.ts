/**
 * Self-hosted SAM 3 (text prompts) with ONNX Runtime on the CPU, from the
 * int8 export (vision_encoder_int8.onnx, text_encoder_int8.onnx,
 * decoder_int8.onnx + tokenizer files) in SAM3_ONNX_DIR. About 20 s per
 * photo on 4 cores and ~2 GB of memory: for a dedicated server, not for
 * serverless functions. Server-only module.
 */
import path from "node:path";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { maskSize, SAM3_MIN_SCORE, SAM3_PROMPTS, type Sam3Kind } from "@/lib/segmentation/sam3";

type Ort = typeof import("onnxruntime-node");
type Session = import("onnxruntime-node").InferenceSession;
type Loaded = { ort: Ort; vision: Session; decoder: Session; text: Map<Sam3Kind, { features: unknown; mask: unknown }> };

const SIZE = 1008;
const GRID = 288;
let loading: Promise<Loaded> | null = null;

function load(dir: string): Promise<Loaded> {
  if (loading) return loading;
  const p = (async (): Promise<Loaded> => {
    const ort = await import("onnxruntime-node");
    const { CLIPTokenizer } = await import("@huggingface/transformers");
    // Built from the local files (no global settings changed: other routes still download their models).
    const readJson = async (f: string) => JSON.parse(await readFile(path.join(dir, f), "utf8")) as object;
    const tokenizer = new CLIPTokenizer(await readJson("tokenizer.json"), await readJson("tokenizer_config.json"));
    // No memory arena / pattern cache: peak memory drops from ~9 GB to the model size plus one request.
    const opts = {
      executionProviders: ["cpu"],
      enableCpuMemArena: false,
      enableMemPattern: false,
      graphOptimizationLevel: "all",
    } as import("onnxruntime-node").InferenceSession.SessionOptions;
    const [vision, textEnc, decoder] = (await Promise.all(
      ["vision_encoder_int8.onnx", "text_encoder_int8.onnx", "decoder_int8.onnx"].map((f) => ort.InferenceSession.create(path.join(dir, f), opts)),
    )) as [Session, Session, Session];
    // The prompts never change: encode them once.
    const text = new Map<Sam3Kind, { features: unknown; mask: unknown }>();
    for (const kind of Object.keys(SAM3_PROMPTS) as Sam3Kind[]) {
      const enc = await tokenizer(SAM3_PROMPTS[kind], { padding: "max_length", max_length: 32, truncation: true });
      const ids = new ort.Tensor("int64", BigInt64Array.from(enc.input_ids.data as BigInt64Array), [1, 32]);
      const mask = new ort.Tensor("int64", BigInt64Array.from(enc.attention_mask.data as BigInt64Array), [1, 32]);
      const out = await textEnc.run({ input_ids: ids, attention_mask: mask });
      text.set(kind, { features: out[textEnc.outputNames[0]!], mask });
    }
    await textEnc.release();
    return { ort, vision, decoder, text };
  })();
  loading = p;
  p.catch(() => (loading = null));
  return p;
}

/** Segment walls and ceiling; masks at maskSize() of the image, 0/255. */
export async function sam3Local(dir: string, jpeg: Buffer): Promise<{ kind: Sam3Kind; score: number; mask: Uint8Array }[]> {
  const { ort, vision, decoder, text } = await load(dir);
  const meta = await sharp(jpeg).metadata();
  const { width: ow, height: oh } = maskSize(meta.width ?? SIZE, meta.height ?? SIZE);
  const rgb = await sharp(jpeg).resize(SIZE, SIZE, { fit: "fill" }).removeAlpha().raw().toBuffer();
  const px = new Float32Array(3 * SIZE * SIZE);
  for (let i = 0; i < SIZE * SIZE; i++) for (let c = 0; c < 3; c++) px[c * SIZE * SIZE + i] = (rgb[i * 3 + c]! / 255 - 0.5) / 0.5;
  const v = await vision.run({ pixel_values: new ort.Tensor("float32", px, [1, 3, SIZE, SIZE]) });
  const names = vision.outputNames;
  const fpn = (n: string) => v[n] ?? v[names[Number(n.slice(-1)) + (n.includes("position") ? 4 : 0)]!]!;
  const out: { kind: Sam3Kind; score: number; mask: Uint8Array }[] = [];
  for (const [kind, t] of text) {
    const feed: Record<string, unknown> = {};
    for (const n of decoder.inputNames) feed[n] = n === "text_features" ? t.features : n === "attention_mask" ? t.mask : fpn(n);
    const d = await decoder.run(feed as Record<string, import("onnxruntime-node").Tensor>);
    const [masks, , logits] = decoder.outputNames.map((n) => d[n]!);
    const L = logits!.data as Float32Array;
    const M = masks!.data as Float32Array;
    for (let q = 0; q < L.length; q++) {
      const score = 1 / (1 + Math.exp(-L[q]!));
      if (score < SAM3_MIN_SCORE[kind]) continue;
      // 288×288 logits of the stretched square image → mask grid of the photo (bilinear, threshold 0).
      const mask = new Uint8Array(ow * oh);
      const off = q * GRID * GRID;
      for (let y = 0; y < oh; y++) {
        const fy = Math.min(GRID - 1, Math.max(0, ((y + 0.5) / oh) * GRID - 0.5));
        const y0 = Math.floor(fy);
        const y1 = Math.min(GRID - 1, y0 + 1);
        const ty = fy - y0;
        for (let x = 0; x < ow; x++) {
          const fx = Math.min(GRID - 1, Math.max(0, ((x + 0.5) / ow) * GRID - 0.5));
          const x0 = Math.floor(fx);
          const x1 = Math.min(GRID - 1, x0 + 1);
          const tx = fx - x0;
          const val =
            (M[off + y0 * GRID + x0]! * (1 - tx) + M[off + y0 * GRID + x1]! * tx) * (1 - ty) + (M[off + y1 * GRID + x0]! * (1 - tx) + M[off + y1 * GRID + x1]! * tx) * ty;
          mask[y * ow + x] = val > 0 ? 255 : 0;
        }
      }
      out.push({ kind, score, mask });
    }
  }
  return out;
}
