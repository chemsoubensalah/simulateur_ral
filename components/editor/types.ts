import type { Lab } from "@/lib/color/lab";
import type { Finish, SurfaceStats } from "@/lib/recolor/model";

export type Tool = "brush" | "eraser" | "lasso" | "pan";

export type Surface = {
  id: string;
  name: string;
  hex: string | null;
  lab: Lab | null;
  finish: Finish;
  /** Exposure multiplier for the recolor (1 = mean-lightness match). */
  brightness: number;
  /** Edge feather radius in image pixels (0–3). */
  feather: number;
  visible: boolean;
  /** Lightness statistics of the photo under the mask (null when empty). */
  stats: SurfaceStats | null;
  coverage: number;
};

export type ViewTransform = { scale: number; x: number; y: number };
