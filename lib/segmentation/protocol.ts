import type { EncoderGeometry, Point } from "./postprocess";

export const SAM_MODEL_ID = "Xenova/slimsam-77-uniform";

export type Device = "webgpu" | "wasm";

/** Embeddings computed elsewhere (server fallback). */
export type ExternalEmbeddings = {
  geometry: EncoderGeometry;
  dims: number[];
  imageEmbeddings: Float32Array;
  positionalEmbeddings: Float32Array;
};

export type CandidatePreview = {
  id: number;
  area: number;
  score: number;
  /** Soft mask at preview resolution (previewW × previewH). */
  preview: Uint8Array;
};

export type Hypothesis = { index: number; score: number; area: number };

export type WorkerRequest =
  | { type: "init"; id: number; preferWebGPU: boolean; numThreads: number }
  | { type: "setImage"; id: number; rgba: ArrayBuffer; width: number; height: number }
  /** analyze=false skips the background surface analysis (throw-away encoder worker). */
  | { type: "encode"; id: number; analyze?: boolean }
  | { type: "exportEmbeddings"; id: number }
  | { type: "setEmbeddings"; id: number; embeddings: ExternalEmbeddings }
  | { type: "decode"; id: number; points: Point[]; variant: number | null }
  | { type: "candidates"; id: number }
  | { type: "materialize"; id: number; candidateIds: number[] }
  | { type: "refine"; id: number; mask: ArrayBuffer };

export type WorkerResponse =
  | { type: "progress"; stage: "download"; loaded: number; total: number }
  | { type: "ready"; id: number; device: Device }
  | { type: "imageSet"; id: number }
  | { type: "embedded"; id: number; ms: number }
  | { type: "embeddings"; id: number; embeddings: ExternalEmbeddings }
  /** usedSurfaces: whether automatic surface analysis informed the choice of hypothesis. */
  | { type: "decoded"; id: number; mask: ArrayBuffer; hypotheses: Hypothesis[]; chosen: number; usedSurfaces: boolean; ms: number }
  /** Background surface analysis finished (unsolicited). */
  | { type: "surfacesReady" }
  | { type: "candidates"; id: number; list: CandidatePreview[]; previewW: number; previewH: number; ms: number }
  | { type: "materialized"; id: number; masks: { id: number; mask: ArrayBuffer }[] }
  | { type: "refined"; id: number; mask: ArrayBuffer }
  | { type: "error"; id: number | null; message: string };

/** Header of the binary /api/sam/embed response. */
export type EmbedResponseHeader = {
  model: string;
  geometry: EncoderGeometry;
  dims: number[];
  /** Whether positional embeddings follow the image embeddings in the payload. */
  hasPositional: boolean;
  ms: number;
};
