/**
 * Image loading: JPG / PNG / WebP / HEIC → downscaled (max 2048px) canvas with
 * EXIF orientation applied.
 */

export const MAX_IMAGE_SIZE = 2048;

export type LoadedImage = {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  /** RGBA pixels of the resized image. */
  pixels: Uint8ClampedArray;
};

export class ImageLoadError extends Error {
  constructor(readonly code: "unsupported" | "decode" | "tooSmall") {
    super(code);
  }
}

export function isHeic(file: File): boolean {
  return /image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
}

export function fitSize(w: number, h: number, max = MAX_IMAGE_SIZE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

async function decodeNative(blob: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(blob, { imageOrientation: "from-image" });
    } catch {
      /* fall through to <img> (older Safari) */
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function heicToJpeg(file: File): Promise<Blob> {
  // Lazy-loaded: only users uploading HEIC on non-Safari browsers pay for it.
  const { default: heic2any } = await import("heic2any");
  const out = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.92 });
  return Array.isArray(out) ? (out[0] as Blob) : out;
}

export async function loadImageFile(file: Blob & { name?: string; type: string }): Promise<LoadedImage> {
  const asFile = file as File;
  const heic = typeof asFile.name === "string" && isHeic(asFile);
  if (!heic && file.type && !file.type.startsWith("image/")) throw new ImageLoadError("unsupported");

  let source: ImageBitmap | HTMLImageElement;
  try {
    source = await decodeNative(file);
  } catch {
    if (!heic) throw new ImageLoadError("decode");
    try {
      source = await decodeNative(await heicToJpeg(asFile));
    } catch {
      throw new ImageLoadError("decode");
    }
  }

  const sw = "naturalWidth" in source ? source.naturalWidth : source.width;
  const sh = "naturalHeight" in source ? source.naturalHeight : source.height;
  if (sw < 32 || sh < 32) throw new ImageLoadError("tooSmall");
  const { width, height } = fitSize(sw, sh);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new ImageLoadError("decode");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, width, height);
  if ("close" in source) source.close();
  const pixels = ctx.getImageData(0, 0, width, height).data;
  return { canvas, width, height, pixels };
}

export async function loadImageUrl(url: string): Promise<LoadedImage> {
  const res = await fetch(url);
  if (!res.ok) throw new ImageLoadError("decode");
  const blob = await res.blob();
  return loadImageFile(blob);
}
