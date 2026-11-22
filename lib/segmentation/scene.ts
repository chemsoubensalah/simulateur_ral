/**
 * Scene understanding (semantic segmentation, ADE20K classes) shared by the
 * server route and the client: which pixels are wall, ceiling, floor, door,
 * window, furniture…
 */

export const SCENE_MODEL_ID = "Xenova/segformer-b5-finetuned-ade-640-640";

/** ADE20K class indices used by the app. */
export const ADE = {
  wall: 0,
  building: 1,
  sky: 2,
  floor: 3,
  tree: 4,
  ceiling: 5,
  bed: 7,
  windowpane: 8,
  grass: 9,
  cabinet: 10,
  person: 12,
  door: 14,
  table: 15,
  plant: 17,
  curtain: 18,
  chair: 19,
  painting: 22,
  sofa: 23,
  shelf: 24,
  house: 25,
  mirror: 27,
  rug: 28,
  armchair: 30,
  fence: 32,
  wardrobe: 35,
  lamp: 36,
  cushion: 39,
  column: 42,
  chestOfDrawers: 44,
  fireplace: 49,
  refrigerator: 50,
  stairs: 53,
  pillow: 57,
  screenDoor: 58,
  stairway: 59,
  coffeeTable: 64,
  tv: 89,
  vase: 135,
} as const;

/** Surfaces people paint (walls and facades) and the ceiling. */
export const WALL_CLASSES: ReadonlySet<number> = new Set([ADE.wall, ADE.building, ADE.house, ADE.column]);
export const CEILING_CLASSES: ReadonlySet<number> = new Set([ADE.ceiling]);

export type SceneKind = "wall" | "ceiling" | "floor" | "door" | "window" | "furniture" | "outdoor" | "other";

export function sceneKind(cls: number): SceneKind {
  if (WALL_CLASSES.has(cls)) return "wall";
  if (CEILING_CLASSES.has(cls)) return "ceiling";
  if (cls === ADE.floor || cls === ADE.rug) return "floor";
  if (cls === ADE.door || cls === ADE.screenDoor) return "door";
  if (cls === ADE.windowpane || cls === ADE.curtain) return "window";
  if (cls === ADE.sky || cls === ADE.tree || cls === ADE.grass || cls === ADE.plant || cls === ADE.fence) return "outdoor";
  const furniture: number[] = [ADE.bed, ADE.cabinet, ADE.table, ADE.chair, ADE.sofa, ADE.shelf, ADE.armchair, ADE.wardrobe, ADE.lamp, ADE.cushion, ADE.chestOfDrawers, ADE.fireplace, ADE.refrigerator, ADE.coffeeTable, ADE.tv, ADE.painting, ADE.mirror, ADE.pillow, ADE.vase];
  if (furniture.includes(cls)) return "furniture";
  return "other";
}

/** Label map: class index per cell, covering the whole image (stretched). */
export type SceneMap = { width: number; height: number; classes: Uint8Array };

/** Class at a point given in image coordinates (image of size imgW×imgH). */
export function sceneClassAt(scene: SceneMap, x: number, y: number, imgW: number, imgH: number): number {
  const sx = Math.min(scene.width - 1, Math.max(0, Math.floor((x / imgW) * scene.width)));
  const sy = Math.min(scene.height - 1, Math.max(0, Math.floor((y / imgH) * scene.height)));
  return scene.classes[sy * scene.width + sx]!;
}

/** Header of the binary /api/scene response. */
export type SceneResponseHeader = { model: string; width: number; height: number; ms: number };
