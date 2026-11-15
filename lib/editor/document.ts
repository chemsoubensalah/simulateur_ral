import { MaskHistory, type MaskPatch } from "@/lib/mask/history";
import { featherMask, maskCoverage } from "@/lib/mask/ops";
import { computeLightness, surfaceStats, type SurfaceStats } from "@/lib/recolor/model";

/**
 * Framework-free container for the per-image editing data that is too large
 * for React state: pixel luminance, raw masks, feathered masks and history.
 */
export class EditorDocument {
  /** CIE L* of every pixel of the original photo. */
  readonly lightness: Float32Array;
  readonly history = new MaskHistory();
  private raw = new Map<string, Uint8Array>();
  private display = new Map<string, Uint8Array>();

  constructor(
    readonly width: number,
    readonly height: number,
    pixels: Uint8ClampedArray,
  ) {
    this.lightness = computeLightness(pixels);
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
    return { stats: surfaceStats(this.lightness, shown), coverage: maskCoverage(shown), mask: shown };
  }

  undo(): MaskPatch | null {
    return this.history.undo((id) => this.raw.get(id), this.width);
  }

  redo(): MaskPatch | null {
    return this.history.redo((id) => this.raw.get(id), this.width);
  }
}
