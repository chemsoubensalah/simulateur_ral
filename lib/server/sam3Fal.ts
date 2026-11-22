/**
 * SAM 3 on fal.ai's GPUs (endpoint fal-ai/sam-3/image, text prompt, one
 * mask per detected instance). Needs FAL_KEY. Server-only module.
 */
import sharp from "sharp";
import { maskSize, SAM3_MIN_SCORE, SAM3_PROMPTS, type Sam3Kind } from "@/lib/segmentation/sam3";

const ENDPOINT = "https://fal.run/fal-ai/sam-3/image";

type FalImage = { url: string; width?: number; height?: number };
type FalOutput = { masks?: FalImage[]; scores?: number[]; metadata?: { index?: number; score?: number }[] };

async function maskBytes(img: FalImage): Promise<Buffer> {
  if (img.url.startsWith("data:")) return Buffer.from(img.url.slice(img.url.indexOf(",") + 1), "base64");
  const res = await fetch(img.url);
  if (!res.ok) throw new Error(`mask download ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Mask image → 0/255 at the target size (alpha channel if present, else brightness). */
async function toBinary(png: Buffer, w: number, h: number): Promise<Uint8Array> {
  const img = sharp(png);
  const meta = await img.metadata();
  const channel = meta.hasAlpha ? img.extractChannel("alpha") : img.greyscale();
  const raw = await channel.resize(w, h, { fit: "fill" }).raw().toBuffer();
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = raw[i]! >= 128 ? 255 : 0;
  return out;
}

export async function sam3Fal(key: string, jpeg: Buffer, imgW: number, imgH: number): Promise<{ kind: Sam3Kind; score: number; mask: Uint8Array }[]> {
  const { width, height } = maskSize(imgW, imgH);
  const imageUrl = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  const results = await Promise.all(
    (Object.keys(SAM3_PROMPTS) as Sam3Kind[]).map(async (kind) => {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          image_url: imageUrl,
          prompt: SAM3_PROMPTS[kind],
          apply_mask: false,
          return_multiple_masks: true,
          max_masks: 16,
          include_scores: true,
          output_format: "png",
          sync_mode: true,
        }),
      });
      if (!res.ok) throw new Error(`fal ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = (await res.json()) as FalOutput;
      const masks = data.masks ?? [];
      const out: { kind: Sam3Kind; score: number; mask: Uint8Array }[] = [];
      for (let i = 0; i < masks.length; i++) {
        const score = data.scores?.[i] ?? data.metadata?.[i]?.score ?? 1;
        if (score < SAM3_MIN_SCORE[kind]) continue;
        out.push({ kind, score, mask: await toBinary(await maskBytes(masks[i]!), width, height) });
      }
      return out;
    }),
  );
  return results.flat();
}
