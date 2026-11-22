import type { EncoderGeometry, Point } from "./postprocess";
import type { SceneKind, SceneMap } from "./scene";

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
  /** What the surface is, when scene understanding is available. */
  kind?: SceneKind;
};

export type Hypothesis = { index: number; score: number; area: number };

export type WorkerRequest =
  | { type: "init"; id: number; preferWebGPU: boolean; numThreads: number }
  /** expectScene: a scene map will follow (taps before it are provisional). */
  | { type: "setImage"; id: number; rgba: ArrayBuffer; width: number; height: number; expectScene?: boolean }
  /** analyze=false skips the background surface analysis (throw-away encoder worker). */
  | { type: "encode"; id: number; analyze?: boolean }
  | { type: "exportEmbeddings"; id: number }
  | { type: "setEmbeddings"; id: number; embeddings: ExternalEmbeddings }
  /** merge=false: only the tapped part, without joining other parts of the same wall. */
  | { type: "decode"; id: number; points: Point[]; variant: number | null; merge?: boolean }
  | { type: "setScene"; id: number; scene: SceneMap | null }
  | { type: "autoSurfaces"; id: number }
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
  | {
      type: "decoded";
      id: number;
      mask: ArrayBuffer;
      hypotheses: Hypothesis[];
      chosen: number;
      usedSurfaces: boolean;
      ms: number;
      /** What was tapped (scene understanding), and how many other parts of the same surface were joined. */
      kind: SceneKind | null;
      merged: number;
    }
  | { type: "sceneSet"; id: number }
  | { type: "autoSurfaces"; id: number; surfaces: { kind: "wall" | "ceiling"; mask: ArrayBuffer }[] }
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
