import { copyRegion, pasteRegion, type Rect } from "./ops";

/** A reversible change to one surface mask, stored as before/after patches of the touched rect. */
export type MaskPatch = { surfaceId: string; rect: Rect; before: Uint8Array; after: Uint8Array };

/** Undo/redo stack bounded by total patch bytes (keeps memory low on phones). */
export class MaskHistory {
  private undoStack: MaskPatch[] = [];
  private redoStack: MaskPatch[] = [];

  constructor(private readonly maxBytes = 48 * 1024 * 1024) {}

  /** Record an edit, given the full mask before the edit and the mask after it. */
  record(surfaceId: string, beforeFull: Uint8Array, afterFull: Uint8Array, width: number, rect: Rect): void {
    if (rect.w === 0 || rect.h === 0) return;
    this.undoStack.push({
      surfaceId,
      rect,
      before: copyRegion(beforeFull, width, rect),
      after: copyRegion(afterFull, width, rect),
    });
    this.redoStack = [];
    this.trim();
  }

  private trim(): void {
    let bytes = this.undoStack.reduce((s, p) => s + p.before.length * 2, 0);
    while (bytes > this.maxBytes && this.undoStack.length > 1) {
      const p = this.undoStack.shift();
      if (p) bytes -= p.before.length * 2;
    }
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Apply undo; `getMask` resolves the live mask array for a surface. Returns the patch applied. */
  undo(getMask: (id: string) => Uint8Array | undefined, width: number): MaskPatch | null {
    const p = this.undoStack.pop();
    if (!p) return null;
    const m = getMask(p.surfaceId);
    if (m) pasteRegion(m, width, p.rect, p.before);
    this.redoStack.push(p);
    return p;
  }

  redo(getMask: (id: string) => Uint8Array | undefined, width: number): MaskPatch | null {
    const p = this.redoStack.pop();
    if (!p) return null;
    const m = getMask(p.surfaceId);
    if (m) pasteRegion(m, width, p.rect, p.after);
    this.undoStack.push(p);
    return p;
  }

  /** Forget patches belonging to a deleted surface. */
  dropSurface(surfaceId: string): void {
    this.undoStack = this.undoStack.filter((p) => p.surfaceId !== surfaceId);
    this.redoStack = this.redoStack.filter((p) => p.surfaceId !== surfaceId);
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
