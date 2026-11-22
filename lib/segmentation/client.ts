/**
 * Main-thread client for the SAM worker. Owns the worker lifecycle, request
 * ids, status reporting and the "device too slow → server" fallback.
 */
import type { LoadedImage } from "@/lib/image/load";
import { decodeHalf, unpackEnvelope } from "./f16";
import { idbGet, idbPut } from "./idbCache";
import type { Point } from "./postprocess";
import { WALL_CLASSES, type SceneKind, type SceneMap, type SceneResponseHeader } from "./scene";
import type { Sam3Mask, Sam3ResponseHeader } from "./sam3";
import { rleDecode } from "@/lib/mask/rle";
import { wallHintPoint } from "./sceneOps";
import {
  SAM_MODEL_ID,
  type CandidatePreview,
  type Device,
  type EmbedResponseHeader,
  type ExternalEmbeddings,
  type Hypothesis,
  type WorkerRequest,
  type WorkerResponse,
} from "./protocol";

export type SegmentationMode = "auto" | "device" | "server";

export type SegStatus =
  | { phase: "idle" }
  | { phase: "loading"; loaded: number; total: number }
  | { phase: "analyzing"; source: "device" | "server" }
  | { phase: "ready"; source: "device" | "server"; device: Device; encodeMs: number }
  | { phase: "error"; message: string };

export type DecodeResult = {
  mask: Uint8Array;
  hypotheses: Hypothesis[];
  chosen: number;
  usedSurfaces: boolean;
  ms: number;
  kind: SceneKind | null;
  merged: number;
};
export type CandidatesResult = { list: CandidatePreview[]; previewW: number; previewH: number; ms: number };

/** Local encoding slower than this (after the model is loaded) switches to the server, if available. */
const LOCAL_ENCODE_TIMEOUT_MS = 25_000;
const SERVER_ENDPOINT = "/api/sam/embed";
const PE_CACHE_KEY = `sam-positional:${SAM_MODEL_ID}`;

/** WorkerRequest without the id (distributes over the union). */
type RequestBody = WorkerRequest extends infer R ? (R extends WorkerRequest ? Omit<R, "id"> : never) : never;

type Pending = { resolve: (msg: WorkerResponse) => void; reject: (e: Error) => void };

let serverAvailable: Promise<boolean> | null = null;
export function isServerAvailable(): Promise<boolean> {
  serverAvailable ??= fetch(SERVER_ENDPOINT, { method: "GET" })
    .then((r) => (r.ok ? (r.json() as Promise<{ available?: boolean }>) : { available: false }))
    .then((j) => !!j.available)
    .catch(() => false);
  return serverAvailable;
}

function hasWebGPU(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

/** Phones and tablets: tighter memory limits (the browser reloads the page if exceeded). */
export function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1);
}

/** iPhone / iPad: Safari closes a page that uses more than ~1.4 GB. */
export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1);
}

/** Heuristic for devices where on-device encoding would take too long. */
export function isLikelySlowDevice(): boolean {
  if (hasWebGPU()) return false;
  const cores = navigator.hardwareConcurrency ?? 4;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  return cores <= 4 && memory <= 4;
}

async function canvasToJpeg(canvas: HTMLCanvasElement, maxSize: number): Promise<Blob> {
  const scale = Math.min(1, maxSize / Math.max(canvas.width, canvas.height));
  const c = document.createElement("canvas");
  c.width = Math.round(canvas.width * scale);
  c.height = Math.round(canvas.height * scale);
  c.getContext("2d")?.drawImage(canvas, 0, 0, c.width, c.height);
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/jpeg", 0.9));
}

const SCENE_ENDPOINT = "/api/scene";
/**
 * SAM 3 walls: this site's /api/walls, or a separate walls server called
 * directly from the browser (NEXT_PUBLIC_SAM3_URL, e.g. a Hugging Face Space —
 * no time limit of the site's own functions).
 */
const SAM3_URL = (process.env.NEXT_PUBLIC_SAM3_URL ?? "").replace(/\/+$/, "");
const WALLS_ENDPOINT = SAM3_URL ? `${SAM3_URL}/api/walls` : "/api/walls";

let wallsInfo: Promise<{ available: boolean; provider: string | null }> | null = null;
/** Whether the server offers SAM 3 walls, and which provider (checked once per page load). */
export function wallsServer(): Promise<{ available: boolean; provider: string | null }> {
  wallsInfo ??= fetch(WALLS_ENDPOINT)
    .then((r) => (r.ok ? r.json() : { available: false, provider: null }))
    .then((j: { available?: boolean; provider?: string | null }) => ({ available: !!j.available, provider: j.provider ?? null }))
    .catch(() => ({ available: false, provider: null }));
  return wallsInfo;
}

function decodeSam3(buf: ArrayBuffer): Sam3Mask[] {
  const { header, payload } = unpackEnvelope<Sam3ResponseHeader>(buf);
  const n = header.width * header.height;
  return header.instances.map((m) => ({
    kind: m.kind,
    score: m.score,
    width: header.width,
    height: header.height,
    mask: rleDecode(payload.subarray(m.offset, m.offset + m.length), n),
  }));
}

/**
 * SAM 3 walls and ceiling from the server (null if unavailable or failed).
 * The answer is kept on the device per photo: opening the same photo again
 * costs nothing.
 */
export async function fetchSam3(canvas: HTMLCanvasElement): Promise<Sam3Mask[] | null> {
  if (!(await wallsServer()).available) return null;
  try {
    const blob = await canvasToJpeg(canvas, 1536);
    const bytes = await blob.arrayBuffer();
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
    const key = `sam3:${hash}`;
    const cached = await idbGet(key).catch(() => undefined);
    if (cached) return decodeSam3(cached.body);
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch(WALLS_ENDPOINT, { method: "POST", body: blob, headers: { "content-type": "image/jpeg" }, signal: AbortSignal.timeout(150_000) }).catch(() => null);
      if (res?.ok) {
        const buf = await res.arrayBuffer();
        void idbPut(key, buf, "application/octet-stream").catch(() => undefined);
        return decodeSam3(buf);
      }
      // 429 = this visitor's or today's limit reached: use the built-in AI instead.
      if (res && res.status < 500) return null;
      await new Promise((r) => setTimeout(r, 2000));
    }
  } catch {
    /* optional */
  }
  return null;
}

/** Scene understanding from the server (null if unavailable). */
export async function fetchScene(canvas: HTMLCanvasElement): Promise<SceneMap | null> {
  try {
    const body = await canvasToJpeg(canvas, 1024);
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(SCENE_ENDPOINT, { method: "POST", body, headers: { "content-type": "image/jpeg" } }).catch(() => null);
      if (res?.ok) {
        const { header, payload } = unpackEnvelope<SceneResponseHeader>(await res.arrayBuffer());
        return { width: header.width, height: header.height, classes: payload.slice() };
      }
      // Retry server errors and timeouts (e.g. a cold start loading the model); give up on 4xx.
      if (res && res.status < 500) return null;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  } catch {
    /* scene understanding is optional */
  }
  return null;
}

export async function fetchServerEmbeddings(canvas: HTMLCanvasElement): Promise<ExternalEmbeddings> {
  const cachedPe = await idbGet(PE_CACHE_KEY);
  const body = await canvasToJpeg(canvas, 1024);
  let res: Response | null = null;
  // Retry briefly when the server is busy (503) or the network hiccups.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      res = await fetch(`${SERVER_ENDPOINT}?pe=${cachedPe ? 0 : 1}`, { method: "POST", body, headers: { "content-type": "image/jpeg" } });
      if (res.status !== 503) break;
    } catch {
      res = null;
    }
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
  if (!res || !res.ok) throw new Error(`Server segmentation failed (${res?.status ?? "network"})`);
  const { header, payload } = unpackEnvelope<EmbedResponseHeader>(await res.arrayBuffer());
  const n = header.dims.reduce((a, b) => a * b, 1);
  const halves = new Uint16Array(payload.buffer, payload.byteOffset, payload.byteLength / 2);
  const imageEmbeddings = decodeHalf(halves.subarray(0, n));
  let positionalEmbeddings: Float32Array;
  if (header.hasPositional) {
    const pe = halves.slice(n, 2 * n);
    positionalEmbeddings = decodeHalf(pe);
    void idbPut(PE_CACHE_KEY, pe.buffer);
  } else if (cachedPe) {
    positionalEmbeddings = decodeHalf(new Uint16Array(cachedPe.body));
  } else throw new Error("Missing positional embeddings");
  return { geometry: header.geometry, dims: header.dims, imageEmbeddings, positionalEmbeddings };
}

export class SegmentationClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private listeners = new Set<(s: SegStatus) => void>();
  private disposed = false;
  private latestDecode = 0;
  private surfaceListeners = new Set<() => void>();
  /** Whether background surface analysis has finished for the current photo. */
  surfacesReady = false;
  /** Scene understanding (walls, ceiling…) once received from the server. */
  scene: SceneMap | null = null;
  private scenePromise: Promise<SceneMap | null> | null = null;
  status: SegStatus = { phase: "idle" };

  /** Resolves when surface analysis is available, or after `timeoutMs` (whichever first). */
  waitForSurfaces(timeoutMs: number): Promise<void> {
    if (this.surfacesReady) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        off();
        resolve();
      };
      const timer = setTimeout(done, timeoutMs);
      const off = this.onSurfacesReady(done);
    });
  }

  /** Called once automatic surface analysis is available (taps can then be re-evaluated). */
  onSurfacesReady(fn: () => void): () => void {
    this.surfaceListeners.add(fn);
    return () => this.surfaceListeners.delete(fn);
  }

  constructor(private readonly mode: SegmentationMode = "auto") {}

  subscribe(fn: (s: SegStatus) => void): () => void {
    this.listeners.add(fn);
    fn(this.status);
    return () => this.listeners.delete(fn);
  }

  private setStatus(s: SegStatus) {
    if (this.disposed) return;
    this.status = s;
    for (const l of this.listeners) l(s);
  }

  private createWorker(): Worker {
    const w = new Worker(new URL("./sam.worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (ev: MessageEvent<WorkerResponse>) => this.onMessage(ev.data);
    w.onerror = (ev) => {
      ev.preventDefault();
      this.failAll(new Error(ev.message || "Segmentation worker crashed"));
      this.setStatus({ phase: "error", message: ev.message || "worker error" });
    };
    return w;
  }

  private onMessage(msg: WorkerResponse) {
    if (msg.type === "progress") {
      if (this.status.phase === "idle" || this.status.phase === "loading")
        this.setStatus({ phase: "loading", loaded: msg.loaded, total: msg.total });
      return;
    }
    if (msg.type === "surfacesReady") {
      this.surfacesReady = true;
      for (const l of this.surfaceListeners) l();
      return;
    }
    if (msg.id === null) return; // unsolicited error, already reflected in a pending request
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    if (msg.type === "error") p.reject(new Error(msg.message));
    else p.resolve(msg);
  }

  private failAll(e: Error) {
    for (const p of this.pending.values()) p.reject(e);
    this.pending.clear();
  }

  private request<T extends WorkerResponse["type"]>(
    body: RequestBody,
    expect: T,
    transfer: Transferable[] = [],
    target: Worker | null = this.worker,
  ): Promise<Extract<WorkerResponse, { type: T }>> {
    const worker = target;
    if (!worker) return Promise.reject(new Error("Segmentation not started"));
    const id = this.nextId++;
    if (body.type === "decode") this.latestDecode = id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        resolve: (m) => (m.type === expect ? resolve(m as Extract<WorkerResponse, { type: T }>) : reject(new Error(`Unexpected ${m.type}`))),
        reject,
      });
      worker.postMessage({ ...body, id } as WorkerRequest, transfer);
    });
  }

  private initMessage(): RequestBody {
    const mobile = isMobileDevice();
    const isolated = typeof crossOriginIsolated !== "undefined" && crossOriginIsolated;
    const cores = Math.max(1, (navigator.hardwareConcurrency ?? 2) - 1);
    // Phones: CPU (WASM) only and at most 2 threads, to stay within memory limits.
    return { type: "init", preferWebGPU: !mobile, numThreads: isolated ? Math.min(mobile ? 2 : 4, cores) : 1 };
  }

  private async boot(): Promise<Device> {
    this.surfacesReady = false;
    this.encoder?.terminate();
    this.encoder = null;
    this.worker?.terminate();
    this.failAll(new Error("restarted"));
    this.worker = this.createWorker();
    const ready = await this.request(this.initMessage(), "ready");
    return ready.device;
  }

  /** Throw-away worker that only computes the image embedding (phones). */
  private encoder: Worker | null = null;

  /**
   * Encode in a separate worker and terminate it afterwards: the image encoder's
   * working memory (hundreds of MB of WebAssembly memory that can never shrink)
   * is released, so phones do not run out of memory and reload the page.
   */
  private async encodeIsolated(image: LoadedImage): Promise<ExternalEmbeddings> {
    const enc = this.createWorker();
    this.encoder = enc;
    try {
      await this.request(this.initMessage(), "ready", [], enc);
      this.setStatus({ phase: "analyzing", source: "device" });
      const rgba = image.pixels.slice().buffer as ArrayBuffer;
      await this.request({ type: "setImage", rgba, width: image.width, height: image.height }, "imageSet", [rgba], enc);
      await this.request({ type: "encode", analyze: false }, "embedded", [], enc);
      const r = await this.request({ type: "exportEmbeddings" }, "embeddings", [], enc);
      return r.embeddings;
    } finally {
      enc.terminate();
      if (this.encoder === enc) this.encoder = null;
    }
  }

  /** Load the model (cached after first use) and analyse the photo. */
  async start(image: LoadedImage): Promise<void> {
    this.setStatus({ phase: "loading", loaded: 0, total: 0 });
    // Scene understanding runs on the server in parallel with everything else.
    this.scene = null;
    this.sceneCanvas = image.canvas;
    this.scenePromise = this.mode === "device" ? null : fetchScene(image.canvas).then((s) => (this.scene = s));
    // The most precise walls (SAM 3 on the server), when the server offers them.
    this.sam3Done = undefined;
    this.sam3Promise = null;
    this.sam3Canvas = this.mode === "device" ? null : image.canvas;
    // Free providers start right away; a paid one only when the customer actually
    // selects walls (first tap or "Paint all walls"), so just opening photos costs nothing.
    void wallsServer().then((w) => {
      if (w.available && w.provider !== "fal") this.ensureSam3();
    });
    try {
      const server = this.mode !== "device" && (await isServerAvailable());
      // The image encoder needs ~1.5–2 GB of memory for a few seconds (SAM's
      // global attention). Phones and tablets get killed by the browser at that
      // point, so they use the server for this step; taps still run on the device.
      const useServer = this.mode === "server" ? true : this.mode === "auto" && server && (isMobileDevice() || isLikelySlowDevice());
      if (useServer) return await this.startServer(image);
      if (this.mode === "auto" && isIOS()) throw new Error("On-device analysis is not possible on this device and the server is unavailable");
      await this.startDevice(image, server);
    } catch (e) {
      this.setStatus({ phase: "error", message: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  }

  private async startDevice(image: LoadedImage, serverFallback: boolean) {
    // Always encode in a throw-away worker: measured ~2 GB peak renderer memory
    // when the encoder stays alive vs ~0.6 GB this way (phones reload the page
    // when a tab exceeds ~1–1.5 GB).
    return this.startDeviceIsolated(image, serverFallback);
  }

  private async startDeviceIsolated(image: LoadedImage, serverFallback: boolean) {
    this.surfacesReady = false;
    this.worker?.terminate();
    this.worker = null;
    this.failAll(new Error("restarted"));
    // The encoder worker's download progress drives the status; it switches to
    // "analyzing" once its model is loaded.
    const encoded = this.encodeIsolated(image);
    encoded.catch(() => {});
    const timeout = new Promise<"timeout">((r) => setTimeout(() => r("timeout"), LOCAL_ENCODE_TIMEOUT_MS + 15_000));
    const winner = serverFallback ? await Promise.race([encoded, timeout]) : await encoded;
    if (this.disposed) return;
    if (winner === "timeout") {
      this.encoder?.terminate();
      this.encoder = null;
      return this.startServer(image);
    }
    // Decoder worker: model weights only, no encoder run → small memory footprint.
    this.worker = this.createWorker();
    const ready = await this.request(this.initMessage(), "ready");
    const rgba = image.pixels.slice().buffer as ArrayBuffer;
    await this.request({ type: "setImage", rgba, width: image.width, height: image.height, expectScene: !!this.scenePromise }, "imageSet", [rgba]);
    const t = [winner.imageEmbeddings.buffer, winner.positionalEmbeddings.buffer] as ArrayBuffer[];
    const done = await this.request({ type: "setEmbeddings", embeddings: winner }, "embedded", t);
    void this.sendScene();
    this.setStatus({ phase: "ready", source: "device", device: ready.device, encodeMs: done.ms });
  }

  private async startServer(image: LoadedImage) {
    const device = await this.boot();
    if (this.disposed) return;
    this.setStatus({ phase: "analyzing", source: "server" });
    const rgba = image.pixels.slice().buffer as ArrayBuffer;
    await this.request({ type: "setImage", rgba, width: image.width, height: image.height, expectScene: !!this.scenePromise }, "imageSet", [rgba]);
    const embeddings = await fetchServerEmbeddings(image.canvas);
    if (this.disposed) return;
    const t = [embeddings.imageEmbeddings.buffer, embeddings.positionalEmbeddings.buffer] as ArrayBuffer[];
    const done = await this.request({ type: "setEmbeddings", embeddings }, "embedded", t);
    void this.sendScene();
    this.setStatus({ phase: "ready", source: "server", device, encodeMs: done.ms });
  }

  /** Pass the scene map to the worker as soon as both exist. */
  private async sendScene() {
    const scene = await this.scenePromise;
    if (this.disposed || !this.worker) return;
    // Always answer, so taps are not left "provisional" when no scene is coming.
    const payload = scene ? { ...scene, classes: scene.classes.slice() } : null;
    await this.request({ type: "setScene", scene: payload }, "sceneSet").catch(() => undefined);
    this.sceneSent = !!scene;
    for (const l of this.surfaceListeners) l();
  }
  private sceneSent = false;

  /** Whether scene understanding reached the worker (walls/ceiling known). */
  get sceneReady(): boolean {
    return this.sceneSent;
  }

  /** Where on the photo (fractions of its size) a wall clearly is, for the "tap here" hint. */
  async wallHint(timeoutMs: number): Promise<{ fx: number; fy: number } | null> {
    if (!this.scenePromise) return null;
    const scene = await Promise.race([this.scenePromise.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), timeoutMs))]);
    return scene ? wallHintPoint(scene, WALL_CLASSES) : null;
  }

  private sceneCanvas: HTMLCanvasElement | null = null;
  private sam3Promise: Promise<Sam3Mask[] | null> | null = null;
  private sam3Done: Sam3Mask[] | null | undefined = undefined;
  private sam3Canvas: HTMLCanvasElement | null = null;

  /** Start SAM 3 for this photo (once). */
  ensureSam3(): void {
    if (this.sam3Promise || !this.sam3Canvas || this.disposed) return;
    this.sam3Promise = fetchSam3(this.sam3Canvas);
    void this.sam3Surfaces(180_000);
  }

  /**
   * SAM 3 walls/ceiling (room only), waiting at most `timeoutMs` (default: long
   * enough for a CPU server, short for a GPU service); null when not available.
   */
  async sam3Surfaces(timeoutMs?: number): Promise<Sam3Mask[] | null> {
    timeoutMs ??= (await wallsServer()).provider === "fal" ? 30_000 : 100_000;
    if (this.sam3Done !== undefined) return this.sam3Done;
    this.ensureSam3();
    if (!this.sam3Promise) return null;
    const res = await Promise.race([this.sam3Promise, new Promise<"timeout">((r) => setTimeout(() => r("timeout"), timeoutMs))]);
    if (res === "timeout") return null;
    // Scene understanding (if it comes) removes walls seen through windows and doors.
    const scene = this.scene ?? (await Promise.race([this.scenePromise ?? Promise.resolve(null), new Promise<null>((r) => setTimeout(() => r(null), 5000))]));
    const { roomSurfaces } = await import("./sam3");
    this.sam3Done = res ? roomSurfaces(res, scene) : null;
    return this.sam3Done;
  }

  /** SAM 3 result if it is already there (never waits). */
  get sam3Ready(): Sam3Mask[] | null {
    return this.sam3Done ?? null;
  }

  /**
   * Ask the server again for scene understanding when the first request failed
   * (e.g. the server was starting). Resolves when it reached the worker or failed.
   */
  async retryScene(timeoutMs: number): Promise<boolean> {
    if (this.sceneSent) return true;
    if (this.mode === "device" || !this.sceneCanvas || this.disposed) return false;
    const deadline = Date.now() + timeoutMs;
    const timeout = (ms: number) => new Promise<"timeout">((r) => setTimeout(() => r("timeout"), ms));
    // A request that is still running (slow cold start) gets time to finish first.
    const first = this.scenePromise ? await Promise.race([this.scenePromise.catch(() => null), timeout(timeoutMs)]) : null;
    if (first === "timeout") return false;
    if (first) {
      // Arrived: the pending sendScene() delivers it to the worker.
      while (!this.sceneSent && Date.now() < deadline) await timeout(100);
      return this.sceneSent;
    }
    this.scenePromise = fetchScene(this.sceneCanvas).then((sc) => (this.scene = sc));
    await Promise.race([this.sendScene(), timeout(Math.max(0, deadline - Date.now()))]);
    return this.sceneSent;
  }

  /** Waits until surface analysis and scene understanding are done, or the timeout. */
  async waitForUnderstanding(timeoutMs: number): Promise<void> {
    const end = Date.now() + timeoutMs;
    await this.waitForSurfaces(timeoutMs);
    if (this.scenePromise && !this.sceneSent) {
      const left = Math.max(0, end - Date.now());
      await Promise.race([this.scenePromise.then(() => new Promise((r) => setTimeout(r, 50))), new Promise((r) => setTimeout(r, left))]);
    }
  }

  get ready(): boolean {
    return this.status.phase === "ready";
  }

  /** Decode a prompt. Resolves null if a newer decode superseded this one. */
  async decode(points: Point[], variant: number | null = null, merge = true): Promise<DecodeResult | null> {
    try {
      const r = await this.request({ type: "decode", points, variant, merge }, "decoded");
      return {
        mask: new Uint8Array(r.mask),
        hypotheses: r.hypotheses,
        chosen: r.chosen,
        usedSurfaces: r.usedSurfaces,
        ms: r.ms,
        kind: r.kind,
        merged: r.merged,
      };
    } catch (e) {
      if (e instanceof Error && e.message === "superseded") return null;
      throw e;
    }
  }

  isLatestDecode(): boolean {
    return this.latestDecode === this.nextId - 1;
  }

  async candidates(): Promise<CandidatesResult> {
    const r = await this.request({ type: "candidates" }, "candidates");
    return { list: r.list, previewW: r.previewW, previewH: r.previewH, ms: r.ms };
  }

  /** One mask for all walls and one for the ceiling (needs scene understanding). */
  async autoSurfaces(): Promise<{ kind: "wall" | "ceiling"; mask: Uint8Array }[]> {
    const r = await this.request({ type: "autoSurfaces" }, "autoSurfaces");
    return r.surfaces.map((s) => ({ kind: s.kind, mask: new Uint8Array(s.mask) }));
  }

  async materialize(ids: number[]): Promise<{ id: number; mask: Uint8Array }[]> {
    const r = await this.request({ type: "materialize", candidateIds: ids }, "materialized");
    return r.masks.map((m) => ({ id: m.id, mask: new Uint8Array(m.mask) }));
  }

  async refine(mask: Uint8Array): Promise<Uint8Array> {
    const copy = mask.slice().buffer as ArrayBuffer;
    const r = await this.request({ type: "refine", mask: copy }, "refined", [copy]);
    return new Uint8Array(r.mask);
  }

  dispose() {
    this.disposed = true;
    this.failAll(new Error("disposed"));
    this.encoder?.terminate();
    this.encoder = null;
    this.worker?.terminate();
    this.worker = null;
    this.listeners.clear();
    this.surfaceListeners.clear();
  }
}
