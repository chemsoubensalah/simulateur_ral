// Copies the ONNX Runtime WebAssembly binaries used by the SAM worker into
// public/ort/ so they are served from our own origin (required for
// cross-origin isolation, works offline-first, no CDN dependency).
import { copyFile, mkdir, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
// Resolve the exact onnxruntime-web version transformers.js depends on.
const transformersDir = path.dirname(require.resolve("@huggingface/transformers"));
let dist = path.dirname(require.resolve("onnxruntime-web", { paths: [transformersDir] }));
while (path.basename(dist) !== "dist") dist = path.dirname(dist);
const out = path.join(process.cwd(), "public", "ort");
const files = [
  "ort-wasm-simd-threaded.mjs",
  "ort-wasm-simd-threaded.wasm",
  "ort-wasm-simd-threaded.asyncify.mjs",
  "ort-wasm-simd-threaded.asyncify.wasm",
];
await mkdir(out, { recursive: true });
for (const f of files) {
  const src = path.join(dist, f);
  const dst = path.join(out, f);
  const [a, b] = await Promise.all([stat(src), stat(dst).catch(() => null)]);
  if (b && b.size === a.size) continue;
  await copyFile(src, dst);
  console.log(`copied ${f} (${(a.size / 1e6).toFixed(1)} MB)`);
}
