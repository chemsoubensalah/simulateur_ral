import { MaskHistory, type MaskPatch } from "@/lib/mask/history";
import { featherMask, maskCoverage } from "@/lib/mask/ops";
import { computeLightness, surfaceStats, type SurfaceStats } from "@/lib/recolor/model";

/**
 * Framework-free container for the per-image editing data that is too large
 * for React state: pixel luminance, raw masks, feathered masks and history.
 */
export class EditorDocument {
  /** CIE L* of every pixel of the original photo, stored as round(L* × 2.55) to save memory. */
  readonly lightness: Uint8Array;
  readonly history: MaskHistory;
  private raw = new Map<string, Uint8Array>();
  private display = new Map<string, Uint8Array>();

  constructor(
    readonly width: number,
    readonly height: number,
    pixels: Uint8ClampedArray,
    /** Undo budget; smaller on phones. */
    historyBytes = 48 * 1024 * 1024,
  ) {
    const L = computeLightness(pixels);
    this.lightness = new Uint8Array(L.length);
    for (let i = 0; i < L.length; i++) this.lightness[i] = Math.round(L[i]! * 2.55);
    this.history = new MaskHistory(historyBytes);
  }

  /** Lightness statistics of the photo under a mask. */
  stats(mask: Uint8Array) {
    return surfaceStats(this.lightness, mask, 1 / 2.55);
  }

  createMask(id: string): Uint8Array {
    const m = new Uint8Array(this.width * this.height);
    this.raw.set(id, m);
    this.display.set(id, m);
    return m;
  }

  rawMask(id: string): Uint8Array | undefined {
    return this.raw.get(id);
  }

  displayMask(id: string): Uint8Array | undefined {
    return this.display.get(id);
  }

  deleteMask(id: string): void {
    this.raw.delete(id);
    this.display.delete(id);
    this.history.dropSurface(id);
  }

  /**
   * Recompute the feathered (displayed) mask and its statistics after an edit.
   * Returns the lightness statistics under the mask (null if empty) and the
   * fraction of the image covered.
   */
  refresh(id: string, feather: number): { stats: SurfaceStats | null; coverage: number; mask: Uint8Array } {
    const raw = this.raw.get(id);
    if (!raw) throw new Error(`Unknown surface ${id}`);
    const shown = feather > 0 ? featherMask(raw, this.width, this.height, feather) : raw;
    this.display.set(id, shown);
    return { stats: this.stats(shown), coverage: maskCoverage(shown), mask: shown };
  }

  undo(): MaskPatch | null {
    return this.history.undo((id) => this.raw.get(id), this.width);
  }

  redo(): MaskPatch | null {
    return this.history.redo((id) => this.raw.get(id), this.width);
  }
}
