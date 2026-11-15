# ColorVision

AI-assisted paint visualizer: upload a photo of a room or facade, select the walls and repaint them
realistically — shadows, light gradients and texture are preserved. Arabic (RTL, default), German and English.

> **Status: Phase 2 of 7.**
> Phase 1: project setup, i18n with RTL, photo upload, manual masking (brush, eraser, lasso, edge softness,
> undo/redo, multiple surfaces), real-time WebGL CIELAB recoloring with finishes, before/after slider, JPG download.
> Phase 2: AI wall detection with Segment Anything in the browser — tap a wall to select it, add/remove
> points, smaller/larger alternatives, "detect all surfaces", edge snapping, server fallback for slow devices.
> Next: color database & palettes, paint calculator & PDF, accounts & sharing, live camera, shop.

## Quick start

Requirements: Node.js ≥ 20.

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:3000 — you are redirected to `/ar` (Arabic). Use the language menu for `/de` or `/en`.
To test on a phone in the same network: `npm run dev -- -H 0.0.0.0` and open `http://<your-computer-ip>:3000`.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / server |
| `npm test` | Unit tests (Vitest): LAB conversion, ΔE2000 (Sharma reference data), recolor model, mask ops, SAM post-processing, edge refinement, float16 transport, i18n completeness |
| `npm run test:e2e` | Builds, then runs Playwright on desktop Chrome and an emulated Android phone (incl. touch). The AI tests download the real model from Hugging Face. |
| `npm run typecheck` / `npm run lint` | TypeScript (strict) / ESLint |
| `npm run samples` | Regenerates the two synthetic sample photos in `public/samples/` |

## How the recoloring works

Implemented in `lib/recolor/model.ts` (CPU reference, unit-tested) and mirrored 1:1 in the WebGL fragment
shader `lib/recolor/shaders.ts`:

1. For each surface we measure the original photo's mean L\* (Lm) and 95th-percentile L\* under the mask.
2. Per pixel, the shading ratio `r = Y / Y(Lm)` (linear light) captures shadows, light and texture.
3. New lightness: `L' + 16 = (Lt + 16) · ((L + 16)/(Lm + 16))^k` — the surface's mean L\* equals the paint's
   L\* exactly, local variation is kept multiplicatively (physically, paint changes reflectance, not light),
   so dark → light and light → dark repaints don't go grey or muddy.
4. a\*, b\* are replaced with the paint's a\*, b\*, scaled with the shading so shadows keep the paint's hue.
5. Light paints: `k` is reduced just enough that the lit parts stay below white; anything above is
   soft-compressed. Out-of-gamut colors are mapped back by reducing chroma at constant luminance.
6. Finishes: matte (slightly flatter shading), satin, gloss (restores the photo's specular highlights).
7. A "light adjustment" slider per surface scales exposure when a photo's lighting makes the match look off.

All surfaces are composited in one pass per surface on the GPU (a few ms on phones; the in-app "Render"
readout shows the measured time). Masks are 8-bit, edited on the CPU, uploaded as dirty-rectangle texture updates.

## AI wall detection (Segment Anything)

- **Model:** [`Xenova/slimsam-77-uniform`](https://huggingface.co/Xenova/slimsam-77-uniform) (SlimSAM, ~14 MB
  quantized) via [transformers.js](https://github.com/huggingface/transformers.js), in a Web Worker
  (`lib/segmentation/sam.worker.ts`) so the UI never freezes. WebGPU is used when available (with a NaN check
  and automatic fallback), otherwise multi-threaded WebAssembly.
- **Lazy & cached:** nothing AI-related loads until a photo is opened. Model files and the ONNX Runtime WASM
  are stored in IndexedDB (`lib/segmentation/idbCache.ts`), so the next visit works without downloading.
  The ONNX Runtime binaries are served from our own origin (`public/ort/`, copied by `scripts/copy-ort.mjs`
  on install/build).
- **Flow:** the photo is encoded once (a few seconds, progress shown); every tap is then decoded in tens of
  milliseconds. In the background, an 8×8 grid of prompts finds the photo's atomic surfaces; this powers
  *Detect all surfaces* and also makes taps pick "the wall" rather than "the whole house" (a tap made before
  the analysis finishes is upgraded automatically).
- **Edges:** SAM's 256 px masks are upsampled and snapped to the photo by local two-colour unmixing
  (`lib/mask/refine.ts`), giving physically correct anti-aliasing at real edges (also available for brush and
  lasso selections via *Snap edges to photo*).
- **Slow devices:** if the device has no WebGPU and few cores/little memory — or local encoding takes longer
  than 25 s — the image embedding is computed by `POST /api/sam/embed` (same model on the server, ONNX Runtime
  for Node), sent as float16, and taps are still decoded on the device. Force a mode with `?sam=server` or
  `?sam=device` on the editor URL.
- **Cross-origin isolation:** the editor page is served with COOP/COEP headers (see `next.config.ts`) so
  WebAssembly can use multiple threads.

## Project structure

```
app/[locale]/            pages (home, editor); root layout sets lang/dir
components/editor/       Editor, Stage (canvas + gestures), Toolbar, panels
lib/color/               sRGB/XYZ/CIELAB/LCh conversions, CIEDE2000
lib/recolor/             recolor model, GLSL shaders, WebGL renderer
lib/mask/                brush/eraser/blur/merge ops, polygon raster, undo history, edge refinement
lib/segmentation/        SAM worker, client (status, fallback), post-processing, IndexedDB cache
app/api/sam/embed/       server fallback that computes SAM embeddings
lib/image/               JPG/PNG/HEIC loading, EXIF orientation, resize to 2048 px
lib/i18n/ + messages/    typed translations (missing keys are compile errors)
tests/unit/  e2e/        Vitest and Playwright tests
```

## Editor controls

- **Smart select** (`S`, default): tap a wall. Tap more points to extend it; choose *Remove* and tap to take
  areas away. *Smaller / Larger* switch between alternative selections; *Done* (or Esc) finishes.
- **Detect all surfaces:** highlights every surface found; tap the ones to paint, then *Add selected*.
- **Brush / Eraser** (`B` / `E`): paint the selected surface; `[` `]` change brush size.
- **Lasso** (`L`): tap points, tap the first point or press *Done*/Enter to close; Esc cancels, Backspace removes a point. Add or remove mode.
- **Move** (`H`), mouse wheel / pinch to zoom, two fingers to pan.
- **Undo / Redo**: Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z or Ctrl+Y. `M` toggles the selection overlay.

## Environment variables

None are required for Phases 1–2. See `.env.example` (`SAM_SERVER_FALLBACK=off` disables the server fallback).
Supabase and Stripe keys come with later phases.

## Deploying to Vercel

1. Push the repository to GitHub and import it in Vercel (framework preset: Next.js, defaults are fine).
2. Add the variables from `.env.example` in *Project → Settings → Environment Variables* when later phases need them.
3. Deploy. The middleware redirects `/` to the user's last language (cookie) or Arabic.
4. The SAM server fallback runs as a Node serverless function (`maxDuration` 60 s, ~90 MB incl. the Linux
   ONNX runtime; GPU/other-platform binaries are excluded in `next.config.ts`). The model is downloaded to
   the function's temp dir on cold start. Give the function at least 1 GB of memory.
