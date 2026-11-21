/// <reference lib="webworker" />
/**
 * Segment Anything (SlimSAM) Web Worker.
 *
 * - Loads the model with transformers.js (WebGPU if available, else WASM) and
 *   caches model + ONNX Runtime binaries in IndexedDB.
 * - Computes the image embedding once per photo (or accepts server-computed embeddings).
 * - Decodes taps in ~30–100 ms and returns full-resolution, edge-refined masks.
 * - Runs automatic surface detection in the background, in small batches, so
 *   interactive taps always take priority.
 */
import { AutoProcessor, env, RawImage, SamModel, Tensor } from "@huggingface/transformers";
import { idbModelCache } from "./idbCache";
import {
  binaryArea,
  chooseHypothesis,
  gridPoints,
  iou,
  LOW_RES,
  lowResBinary,
  lowResStats,
  cleanLogits,
  selectCandidates,
  toModelPoints,
  upsampleLogits,
  validLowRes,
  type EncoderGeometry,
  type Point,
  type RawCandidate,
} from "./postprocess";
import { defaultRefineOptions, edgeMap, growMask, refineMask } from "@/lib/mask/refine";
import { SAM_MODEL_ID, type CandidatePreview, type Device, type Hypothesis, type WorkerRequest, type WorkerResponse } from "./protocol";

declare const self: DedicatedWorkerGlobalScope;

const MASK_SIZE = LOW_RES * LOW_RES;
const GRID = 8;
const BATCH = 8;
const PREVIEW_MAX = 512;

env.allowLocalModels = false;
env.useBrowserCache = false;
env.useCustomCache = true;
env.customCache = idbModelCache;

type Embeddings = { image: Tensor; positional: Tensor; geometry: EncoderGeometry };
type KeptCandidate = { id: number; logits: Float32Array; bin: Uint8Array; area: number; score: number; seed: { x: number; y: number } };

let model: SamModel | null = null;
let processor: Awaited<ReturnType<typeof AutoProcessor.from_pretrained>> | null = null;
let device: Device = "wasm";
let image: { width: number; height: number; rgba: Uint8ClampedArray; edges: Uint8Array } | null = null;
let emb: Embeddings | null = null;
let generation = 0;
let candidates: KeptCandidate[] | null = null;
let candidateWaiters: number[] = [];
let candidateStart = 0;
let latestDecode = 0;

function post(msg: WorkerResponse, transfer: Transferable[] = []) {
  self.postMessage(msg, transfer);
}

/* ---------------- job queue (interactive work first) ---------------- */

type Job = { priority: number; run: () => Promise<void> };
const queue: Job[] = [];
let pumping = false;

function enqueue(priority: number, run: () => Promise<void>) {
  queue.push({ priority, run });
  // Stable sort: higher priority first, FIFO within a priority.
  queue.sort((a, b) => b.priority - a.priority);
  void pump();
}

async function pump() {
  if (pumping) return;
  pumping = true;
  while (queue.length) {
    const job = queue.shift()!;
    try {
      await job.run();
    } catch (e) {
      post({ type: "error", id: null, message: e instanceof Error ? e.message : String(e) });
    }
    // Yield so newly arrived messages can enqueue higher-priority jobs.
    await new Promise((r) => setTimeout(r, 0));
  }
  pumping = false;
}

const PRIORITY = { setup: 3, interactive: 2, background: 1 } as const;

/** Wrap a job so failures are reported against its request id. */
function withId(id: number, fn: () => Promise<void> | void): () => Promise<void> {
  return async () => {
    try {
      await fn();
    } catch (e) {
      post({ type: "error", id, message: e instanceof Error ? e.message : String(e) });
    }
  };
}

/* ---------------- model ---------------- */

async function pickDevice(preferWebGPU: boolean): Promise<{ device: Device; f16: boolean }> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ features: Set<string> } | null> } }).gpu;
  if (!preferWebGPU || !gpu) return { device: "wasm", f16: false };
  try {
    const adapter = await gpu.requestAdapter();
    if (!adapter) return { device: "wasm", f16: false };
    return { device: "webgpu", f16: adapter.features.has("shader-f16") };
  } catch {
    return { device: "wasm", f16: false };
  }
}

function setWasmPaths(dev: Device, numThreads: number) {
  const onnx = env.backends.onnx;
  if (!onnx.wasm) return;
  const base = new URL("/ort/", self.location.origin).href;
  const name = dev === "webgpu" ? "ort-wasm-simd-threaded.asyncify" : "ort-wasm-simd-threaded";
  onnx.wasm.wasmPaths = { mjs: `${base}${name}.mjs`, wasm: `${base}${name}.wasm` };
  onnx.wasm.numThreads = numThreads;
}

async function loadModel(preferWebGPU: boolean, numThreads: number): Promise<void> {
  const files = new Map<string, { loaded: number; total: number }>();
  const progress_callback = (p: { status: string; file?: string; loaded?: number; total?: number }) => {
    // Only the large binaries matter for the progress bar (configs are tiny and
    // would make the percentage jump back and forth).
    if (p.status !== "progress" || !p.file || !/\.(onnx|wasm)$/.test(p.file)) return;
    files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 });
    let loaded = 0;
    let total = 0;
    for (const f of files.values()) {
      loaded += f.loaded;
      total += f.total;
    }
    post({ type: "progress", stage: "download", loaded, total });
  };

  const choice = await pickDevice(preferWebGPU);
  const attempt = async (dev: Device, f16: boolean) => {
    setWasmPaths(dev, numThreads);
    const m = (await SamModel.from_pretrained(SAM_MODEL_ID, {
      device: dev,
      dtype: dev === "webgpu" ? (f16 ? "fp16" : "fp32") : "q8",
      progress_callback,
    })) as SamModel;
    return m;
  };
  try {
    model = await attempt(choice.device, choice.f16);
    device = choice.device;
  } catch (e) {
    if (choice.device === "wasm") throw e;
    model = await attempt("wasm", false);
    device = "wasm";
  }
  processor = await AutoProcessor.from_pretrained(SAM_MODEL_ID, { progress_callback });
}

function hasNaN(t: Tensor): boolean {
  const d = t.data as Float32Array;
  for (let i = 0; i < d.length; i += 97) if (Number.isNaN(d[i]!)) return true;
  return false;
}

async function encode(): Promise<number> {
  if (!model || !processor || !image) throw new Error("Model or image missing");
  const t0 = performance.now();
  const raw = new RawImage(image.rgba, image.width, image.height, 4);
  const inputs = (await processor(raw)) as { pixel_values: Tensor; original_sizes: number[][]; reshaped_input_sizes: number[][] };
  const out = (await model.get_image_embeddings(inputs)) as { image_embeddings: Tensor; image_positional_embeddings: Tensor };
  if (device === "webgpu" && hasNaN(out.image_embeddings)) {
    // Some mobile GPUs produce NaNs in fp16; fall back to CPU once.
    model = null;
    await loadModel(false, env.backends.onnx.wasm?.numThreads ?? 1);
    return encode();
  }
  const [oh, ow] = inputs.original_sizes[0] as [number, number];
  const [rh, rw] = inputs.reshaped_input_sizes[0] as [number, number];
  emb = {
    image: out.image_embeddings,
    positional: out.image_positional_embeddings,
    geometry: { originalWidth: ow, originalHeight: oh, reshapedWidth: rw, reshapedHeight: rh },
  };
  return performance.now() - t0;
}

/** Run the prompt decoder for `prompts` (each a list of points), returning logits & scores. */
async function runDecoder(prompts: Point[][]): Promise<{ logits: Float32Array; scores: Float32Array }> {
  if (!model || !emb || !image) throw new Error("Not ready");
  const n = prompts.length;
  const k = prompts[0]!.length;
  const coords: number[] = [];
  const labels: bigint[] = [];
  for (const p of prompts) {
    coords.push(...toModelPoints(p, image.width, image.height, emb.geometry));
    labels.push(...p.map((q) => BigInt(q.label)));
  }
  const out = (await model({
    image_embeddings: emb.image,
    image_positional_embeddings: emb.positional,
    input_points: new Tensor("float32", Float32Array.from(coords), [1, n, k, 2]),
    input_labels: new Tensor("int64", BigInt64Array.from(labels), [1, n, k]),
  })) as { pred_masks: Tensor; iou_scores: Tensor };
  return { logits: out.pred_masks.data as Float32Array, scores: out.iou_scores.data as Float32Array };
}

/* ---------------- operations ---------------- */

function finishMask(logits: Float32Array, offset: number, seeds: { x: number; y: number }[]): Uint8Array {
  if (!emb || !image) throw new Error("Not ready");
  const clean = cleanLogits(logits, offset, emb.geometry, seeds);
  const coarse = upsampleLogits(clean, 0, emb.geometry, image.width, image.height);
  // Close gaps at faint boundaries, then snap the edge to the photo.
  const grown = growMask(coarse, image.rgba, image.width, image.height, image.edges);
  return refineMask(grown, image.rgba, image.width, image.height, undefined, image.edges);
}

async function decode(id: number, points: Point[], variant: number | null) {
  if (id < latestDecode) return post({ type: "error", id, message: "superseded" });
  if (!emb || !image) throw new Error("Not ready");
  const t0 = performance.now();
  const { logits, scores } = await runDecoder([points]);
  const g = emb.geometry;
  const hyps = [0, 1, 2].map((k) => ({
    score: scores[k]!,
    stability: lowResStats(logits, k * MASK_SIZE, g).stability,
    bin: lowResBinary(logits, k * MASK_SIZE, g).data,
  }));
  const positives = points.filter((p) => p.label === 1);

  let chosen: number;
  let usedSurfaces = false;
  /** A clean surface from the background analysis to use instead of an unstable tap mask. */
  let surface: KeptCandidate | null = null;
  if (variant !== null && variant >= 0 && variant < 3) {
    chosen = variant;
    usedSurfaces = true; // explicit user choice: nothing to re-evaluate
  } else if (positives.length === 1 && points.length === 1 && candidates) {
    usedSurfaces = true;
    const mp = toModelPoints(positives, image.width, image.height, g);
    const { w } = validLowRes(g);
    const idx = Math.floor(mp[1]! / 4) * Math.floor(w) + Math.floor(mp[0]! / 4);
    const containing = candidates.filter((c) => c.bin[idx] === 1);
    chosen = chooseHypothesis(hyps, containing.map((c) => c.bin));
    if (containing.length) {
      // On real photos the tap's own mask can be unstable (blotchy) where the
      // analysed surface is clean: prefer the surface unless the tap mask is
      // both stable and essentially the same region.
      const target = containing.reduce((a, b) => (binaryArea(b.bin) < binaryArea(a.bin) ? b : a));
      const h = hyps[chosen]!;
      if (!(h.stability >= 0.75 && iou(h.bin, target.bin) >= 0.85)) surface = target;
    }
  } else chosen = chooseHypothesis(hyps, []);

  const seedsModel = toModelPoints(positives, image.width, image.height, g);
  const seeds = positives.map((_, i) => ({ x: seedsModel[2 * i]!, y: seedsModel[2 * i + 1]! }));
  const mask = surface ? finishMask(surface.logits, 0, [surface.seed, ...seeds]) : finishMask(logits, chosen * MASK_SIZE, seeds);
  const total = hyps[0]!.bin.length;
  // Offer only visibly different alternatives for "Smaller / Larger" (SAM often
  // returns two near-identical masks).
  const distinct = [chosen];
  for (let k = 0; k < hyps.length; k++) {
    if (k !== chosen && distinct.every((j) => iou(hyps[k]!.bin, hyps[j]!.bin) < 0.9)) distinct.push(k);
  }
  const hypotheses: Hypothesis[] = distinct.map((index) => ({ index, score: hyps[index]!.score, area: binaryArea(hyps[index]!.bin) / total }));
  post(
    { type: "decoded", id, mask: mask.buffer as ArrayBuffer, hypotheses, chosen, usedSurfaces: usedSurfaces || points.length > 1, ms: performance.now() - t0 },
    [mask.buffer as ArrayBuffer],
  );
}

function startCandidates(gen: number) {
  const grid = gridPoints(GRID, GRID);
  const raw: (RawCandidate & { logits: Float32Array; seed: { x: number; y: number } })[] = [];
  candidateStart = performance.now();
  const runBatch = (start: number) =>
    enqueue(PRIORITY.background, async () => {
      if (gen !== generation || !emb || !image) return;
      const chunk = grid.slice(start, start + BATCH);
      const prompts = chunk.map((p) => [{ x: p.x * image!.width, y: p.y * image!.height, label: 1 as const }]);
      const { logits, scores } = await runDecoder(prompts);
      if (gen !== generation) return;
      for (let j = 0; j < chunk.length * 3; j++) {
        const st = lowResStats(logits, j * MASK_SIZE, emb.geometry);
        const pt = toModelPoints(prompts[Math.floor(j / 3)]!, image.width, image.height, emb.geometry);
        raw.push({
          index: raw.length,
          score: scores[j]!,
          stability: st.stability,
          area: st.area,
          bin: lowResBinary(logits, j * MASK_SIZE, emb.geometry).data,
          logits: logits.slice(j * MASK_SIZE, (j + 1) * MASK_SIZE),
          seed: { x: pt[0]!, y: pt[1]! },
        });
      }
      if (start + BATCH < grid.length) runBatch(start + BATCH);
      else {
        const kept = selectCandidates(raw);
        candidates = kept.map((c, i) => {
          const r = raw[c.index]!;
          return { id: i, logits: r.logits, bin: r.bin, area: r.area, score: r.score, seed: r.seed };
        });
        post({ type: "surfacesReady" });
        const waiters = candidateWaiters;
        candidateWaiters = [];
        for (const id of waiters) sendCandidates(id);
      }
    });
  runBatch(0);
}

function sendCandidates(id: number) {
  if (!candidates || !emb || !image) return;
  const scale = Math.min(1, PREVIEW_MAX / Math.max(image.width, image.height));
  const pw = Math.round(image.width * scale);
  const ph = Math.round(image.height * scale);
  const list: CandidatePreview[] = candidates.map((c) => {
    const clean = cleanLogits(c.logits, 0, emb!.geometry, [c.seed]);
    return { id: c.id, area: c.area, score: c.score, preview: upsampleLogits(clean, 0, emb!.geometry, pw, ph) };
  });
  post(
    { type: "candidates", id, list, previewW: pw, previewH: ph, ms: performance.now() - candidateStart },
    list.map((c) => c.preview.buffer as ArrayBuffer),
  );
}

/* ---------------- message handling ---------------- */

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  switch (msg.type) {
    case "init":
      enqueue(PRIORITY.setup, async () => {
        try {
          if (!model) await loadModel(msg.preferWebGPU, msg.numThreads);
          post({ type: "ready", id: msg.id, device });
        } catch (e) {
          post({ type: "error", id: msg.id, message: e instanceof Error ? e.message : String(e) });
        }
      });
      break;
    case "setImage": {
      generation++;
      candidates = null;
      emb = null;
      const rgba = new Uint8ClampedArray(msg.rgba);
      image = { width: msg.width, height: msg.height, rgba, edges: edgeMap(rgba, msg.width, msg.height) };
      post({ type: "imageSet", id: msg.id });
      break;
    }
    case "encode": {
      const gen = generation;
      enqueue(
        PRIORITY.setup,
        withId(msg.id, async () => {
          const ms = await encode();
          if (gen !== generation) return;
          post({ type: "embedded", id: msg.id, ms });
          startCandidates(gen);
        }),
      );
      break;
    }
    case "setEmbeddings": {
      const e = msg.embeddings;
      emb = {
        image: new Tensor("float32", e.imageEmbeddings, e.dims),
        positional: new Tensor("float32", e.positionalEmbeddings, e.dims),
        geometry: e.geometry,
      };
      candidates = null;
      post({ type: "embedded", id: msg.id, ms: 0 });
      startCandidates(generation);
      break;
    }
    case "decode":
      latestDecode = Math.max(latestDecode, msg.id);
      enqueue(PRIORITY.interactive, withId(msg.id, () => decode(msg.id, msg.points, msg.variant)));
      break;
    case "candidates":
      if (candidates) enqueue(PRIORITY.interactive, withId(msg.id, () => sendCandidates(msg.id)));
      else candidateWaiters.push(msg.id);
      break;
    case "materialize":
      enqueue(PRIORITY.interactive, withId(msg.id, () => {
        if (!candidates) throw new Error("No candidates");
        const masks = msg.candidateIds
          .map((cid) => candidates!.find((c) => c.id === cid))
          .filter((c): c is KeptCandidate => !!c)
          .map((c) => ({ id: c.id, mask: finishMask(c.logits, 0, [c.seed]).buffer as ArrayBuffer }));
        post({ type: "materialized", id: msg.id, masks }, masks.map((m) => m.mask));
      }));
      break;
    case "refine":
      enqueue(PRIORITY.interactive, withId(msg.id, () => {
        if (!image) throw new Error("No image");
        // Wider band than for AI masks so hand-drawn edges can snap to the photo.
        const scale = Math.max(image.width, image.height) / 2048;
        const band = Math.max(4, Math.round(8 * scale));
        const opts = { ...defaultRefineOptions(image.width, image.height, band), radius: band * 3 };
        const grown = growMask(new Uint8Array(msg.mask), image.rgba, image.width, image.height, image.edges);
        const refined = refineMask(grown, image.rgba, image.width, image.height, opts, image.edges);
        post({ type: "refined", id: msg.id, mask: refined.buffer as ArrayBuffer }, [refined.buffer as ArrayBuffer]);
      }));
      break;
  }
};
