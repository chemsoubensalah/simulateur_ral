import type { Rect } from "./ops";
import { clampRect } from "./ops";

export type Point = { x: number; y: number };

export function polygonBounds(points: Point[], width: number, height: number): Rect {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  return clampRect({ x: x0 - 2, y: y0 - 2, w: Math.max(...xs) - x0 + 4, h: Math.max(...ys) - y0 + 4 }, width, height);
}

/**
 * Rasterise a closed polygon into an anti-aliased coverage buffer (0..255)
 * using a 2D canvas (hardware AA, works on every browser incl. iOS Safari).
 */
export function rasterizePolygon(points: Point[], width: number, height: number): { coverage: Uint8Array; rect: Rect } {
  const coverage = new Uint8Array(width * height);
  const rect = polygonBounds(points, width, height);
  if (points.length < 3 || rect.w === 0 || rect.h === 0) return { coverage, rect };
  const canvas = document.createElement("canvas");
  canvas.width = rect.w;
  canvas.height = rect.h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { coverage, rect };
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x - rect.x, p.y - rect.y) : ctx.lineTo(p.x - rect.x, p.y - rect.y)));
  ctx.closePath();
  ctx.fill();
  const data = ctx.getImageData(0, 0, rect.w, rect.h).data;
  for (let y = 0; y < rect.h; y++) {
    for (let x = 0; x < rect.w; x++) {
      coverage[(rect.y + y) * width + rect.x + x] = data[(y * rect.w + x) * 4 + 3] ?? 0;
    }
  }
  return { coverage, rect };
}
