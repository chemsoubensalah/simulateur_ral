/**
 * SAM 3 walls server for the ALSY PAINTS colour visualizer.
 *
 * GET  /api/walls → { available: true, provider: "space", ready }
 * POST /api/walls  (body: JPEG/PNG/WebP photo, ≤ 4 MB)
 *   → binary envelope: [u32 LE header length][JSON header][pad to 2][payload]
 *     header: { provider, width, height, ms, instances: [{ kind, score, offset, length }] }
 *     payload: run-length encoded 0/255 masks ([value u8][run LEB128]…) of width × height
 * Same format as the app's /api/walls (lib/segmentation/sam3.ts).
 *
 * Environment: MODELS_DIR (ONNX files + tokenizer), PORT (7860),
 * ALLOWED_ORIGINS (comma-separated site addresses, default "*"),
 * PER_HOUR (analyses per visitor per hour, default 20), PER_DAY (default 1000).
 */
import http from "node:http";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import * as ort from "onnxruntime-node";
import { CLIPTokenizer } from "@huggingface/transformers";

const DIR = process.env.MODELS_DIR ?? "/models";
const PORT = Number(process.env.PORT ?? 7860);
const ORIGINS = (process.env.ALLOWED_ORIGINS ?? "*").split(",").map((s) => s.trim()).filter(Boolean);
const PER_HOUR = Number(process.env.PER_HOUR ?? 20);
const PER_DAY = Number(process.env.PER_DAY ?? 1000);
const MAX_BYTES = 4 * 1024 * 1024;

const PROMPTS = { wall: "wall", ceiling: "ceiling" };
const MIN_SCORE = { wall: 0.4, ceiling: 0.5 };
const MASK_SIZE = 768;
const SIZE = 1008;
const GRID = 288;

/* ---------- model (loaded at start, prompts encoded once) ---------- */

let model = null;
const loading = (async () => {
  const t0 = Date.now();
  const readJson = async (f) => JSON.parse(await readFile(path.join(DIR, f), "utf8"));
  const tokenizer = new CLIPTokenizer(await readJson("tokenizer.json"), await readJson("tokenizer_config.json"));
  // No memory arena: peak memory stays near the model size plus one request (~4 GB).
  const opts = { executionProviders: ["cpu"], enableCpuMemArena: false, enableMemPattern: false, graphOptimizationLevel: "all" };
  const [vision, textEnc, decoder] = await Promise.all(
    ["vision_encoder_int8.onnx", "text_encoder_int8.onnx", "decoder_int8.onnx"].map((f) => ort.InferenceSession.create(path.join(DIR, f), opts)),
  );
  const text = new Map();
  for (const [kind, prompt] of Object.entries(PROMPTS)) {
    const enc = await tokenizer(prompt, { padding: "max_length", max_length: 32, truncation: true });
    const ids = new ort.Tensor("int64", BigInt64Array.from(enc.input_ids.data), [1, 32]);
    const mask = new ort.Tensor("int64", BigInt64Array.from(enc.attention_mask.data), [1, 32]);
    const out = await textEnc.run({ input_ids: ids, attention_mask: mask });
    text.set(kind, { features: out[textEnc.outputNames[0]], mask });
  }
  await textEnc.release();
  model = { vision, decoder, text };
  console.log(`SAM 3 ready in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
})();
loading.catch((e) => {
  console.error("SAM 3 failed to load", e);
  process.exit(1);
});

function maskSize(w, h) {
  const k = Math.min(1, MASK_SIZE / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}

async function segment(image) {
  await loading;
  const { vision, decoder, text } = model;
  const meta = await sharp(image).metadata();
  const { width: ow, height: oh } = maskSize(meta.width ?? SIZE, meta.height ?? SIZE);
  const rgb = await sharp(image).resize(SIZE, SIZE, { fit: "fill" }).removeAlpha().raw().toBuffer();
  const px = new Float32Array(3 * SIZE * SIZE);
  for (let i = 0; i < SIZE * SIZE; i++) for (let c = 0; c < 3; c++) px[c * SIZE * SIZE + i] = (rgb[i * 3 + c] / 255 - 0.5) / 0.5;
  const v = await vision.run({ pixel_values: new ort.Tensor("float32", px, [1, 3, SIZE, SIZE]) });
  const names = vision.outputNames;
  const fpn = (n) => v[n] ?? v[names[Number(n.slice(-1)) + (n.includes("position") ? 4 : 0)]];
  const out = [];
  for (const [kind, t] of text) {
    const feed = {};
    for (const n of decoder.inputNames) feed[n] = n === "text_features" ? t.features : n === "attention_mask" ? t.mask : fpn(n);
    const d = await decoder.run(feed);
    const [masks, , logits] = decoder.outputNames.map((n) => d[n]);
    const L = logits.data;
    const M = masks.data;
    for (let q = 0; q < L.length; q++) {
      const score = 1 / (1 + Math.exp(-L[q]));
      if (score < MIN_SCORE[kind]) continue;
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
          const val = (M[off + y0 * GRID + x0] * (1 - tx) + M[off + y0 * GRID + x1] * tx) * (1 - ty) + (M[off + y1 * GRID + x0] * (1 - tx) + M[off + y1 * GRID + x1] * tx) * ty;
          mask[y * ow + x] = val > 0 ? 255 : 0;
        }
      }
      out.push({ kind, score, mask });
    }
  }
  return { width: ow, height: oh, list: dedupe(out) };
}

function dedupe(list) {
  const iou = (a, b) => {
    let i = 0;
    let u = 0;
    for (let k = 0; k < a.length; k++) {
      const x = a[k] > 127;
      const y = b[k] > 127;
      if (x && y) i++;
      if (x || y) u++;
    }
    return u ? i / u : 0;
  };
  const kept = [];
  for (const m of [...list].sort((a, b) => b.score - a.score)) if (kept.every((k) => iou(k.mask, m.mask) <= 0.8)) kept.push(m);
  return kept;
}

/* ---------- transport ---------- */

function rleEncode(data) {
  const out = [];
  let i = 0;
  while (i < data.length) {
    const v = data[i];
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

function packEnvelope(header, payload) {
  const json = new TextEncoder().encode(JSON.stringify(header));
  const pad = (4 + json.length) % 2;
  const out = new Uint8Array(4 + json.length + pad + payload.length);
  new DataView(out.buffer).setUint32(0, json.length, true);
  out.set(json, 4);
  out.set(payload, 4 + json.length + pad);
  return out;
}

/* ---------- protection: one photo at a time, limits, cache ---------- */

let queue = Promise.resolve();
let waiting = 0;
const cache = new Map();
const perIp = new Map();
let day = "";
let today = 0;

function allow(ip) {
  const now = Date.now();
  const d = new Date(now).toISOString().slice(0, 10);
  if (d !== day) [day, today] = [d, 0];
  if (today >= PER_DAY) return false;
  const recent = (perIp.get(ip) ?? []).filter((t) => now - t < 3600_000);
  if (recent.length >= PER_HOUR) return false;
  recent.push(now);
  perIp.set(ip, recent);
  today++;
  return true;
}

function cors(req, res) {
  const origin = req.headers.origin;
  const ok = ORIGINS.includes("*") ? "*" : origin && ORIGINS.includes(origin) ? origin : null;
  if (ok) res.setHeader("Access-Control-Allow-Origin", ok);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Access-Control-Max-Age", "86400");
}

const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

http
  .createServer(async (req, res) => {
    cors(req, res);
    if (req.method === "OPTIONS") return res.writeHead(204).end();
    const url = new URL(req.url ?? "/", "http://x");
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/api/walls"))
      return json(res, 200, { available: true, provider: "space", ready: !!model, name: "ALSY PAINTS walls (SAM 3)" });
    if (req.method !== "POST" || url.pathname !== "/api/walls") return json(res, 404, { error: "Not found" });

    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > MAX_BYTES) return json(res, 413, { error: "Image too large" });
      chunks.push(c);
    }
    const body = Buffer.concat(chunks);
    if (!/^image\/(jpeg|png|webp)/.test(req.headers["content-type"] ?? "")) return json(res, 415, { error: "Expected an image" });
    const hash = createHash("sha256").update(body).digest("hex");
    const hit = cache.get(hash);
    if (hit) {
      res.writeHead(200, { "content-type": "application/octet-stream" });
      return res.end(hit);
    }
    const ip = String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "?").split(",")[0].trim();
    if (!allow(ip)) return json(res, 429, { error: "Limit reached" });
    if (waiting >= 4) return json(res, 503, { error: "Busy" });

    waiting++;
    const job = queue.then(async () => {
      const t0 = Date.now();
      const { width, height, list } = await segment(body);
      const parts = list.map((m) => rleEncode(m.mask));
      let offset = 0;
      const instances = list.map((m, i) => {
        const e = { kind: m.kind, score: Math.round(m.score * 1000) / 1000, offset, length: parts[i].length };
        offset += parts[i].length;
        return e;
      });
      const payload = new Uint8Array(offset);
      let o = 0;
      for (const p of parts) {
        payload.set(p, o);
        o += p.length;
      }
      return packEnvelope({ provider: "space", width, height, ms: Date.now() - t0, instances }, payload);
    });
    queue = job.catch(() => undefined);
    try {
      const out = await job;
      cache.set(hash, out);
      if (cache.size > 64) cache.delete(cache.keys().next().value);
      res.writeHead(200, { "content-type": "application/octet-stream" });
      res.end(out);
    } catch (e) {
      console.error(e);
      json(res, 500, { error: "Segmentation failed" });
    } finally {
      waiting--;
    }
  })
  .listen(PORT, () => console.log(`Listening on ${PORT}`));
