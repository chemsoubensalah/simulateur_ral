# ALSY PAINTS colour visualizer (ColorVision)

AI-assisted paint visualizer for a paint shop and its customers: take a photo of a room or facade, tap the
walls and try the shop's colours realistically — shadows, light and texture are preserved, old stains are not.
Arabic (RTL, default), German and English. The shop name comes from `NEXT_PUBLIC_BRAND_NAME`.

**For customers (three big steps):**
1. **Walls** — photo tips, then *Paint all walls* (scene understanding finds every wall and the ceiling) or tap a
   wall (an animated hint shows where). Each tapped wall becomes its own surface; furniture, windows and floors
   are recognised and named. A progress bar shows the remaining time while the AI prepares.
2. **Colour** — the shop's most popular colours first, named groups (off-white, warm beige, stone grey, calm
   grey, soft green, sky blue, soft pink, terracotta, deep colours), RAL Classic and NCS, plain-language search
   (“بيج فاتح”, “light grey”, “rouge foncé”), favourites, *compare up to 4 colours side by side on your own wall*,
   finishes, *hide stains and defects*, and the light of the room (as photographed / daylight / evening lamps).
3. **Save & send** — summary of the chosen colours, paint quantity per wall (litres and cans, no prices),
   send the choice to the shop on WhatsApp, share or save the picture.

Work is saved on the device automatically (a reload or the phone's back gesture does not lose it).
Shops can print a QR poster from `/<locale>/qr`. Expert tools (brush, eraser, lasso, edge snapping, detect all
surfaces) are under *More tools*.

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
| `node scripts/build-ral-data.mjs` | Rebuilds the RAL Classic data file from its sources |

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
8. **Hide stains and defects** (on by default, `lib/recolor/shading.ts`): a mask-aware blur of the wall's
   luminance (≈3.5 % of the photo) estimates the lighting; the shading ratio becomes
   `(light / Y(Lm)) · (local / light)^0.15 · (Y / local)^0.8`, so new paint covers stains, patches and dirt
   while keeping the room's light, shadows and fine plaster texture (cracks stay visible — paint doesn't fix them).
9. **Room light** (`lib/recolor/lighting.ts`): the colour of the light is estimated from the brightest
   near-neutral surfaces. *As photographed* gives the paint part of that cast (so it sits in the room),
   *Daylight* neutralises the whole photo, *Evening* simulates warm lamps; before/after uses the same light.

All surfaces are composited in one pass per surface on the GPU (a few ms on phones; the in-app "Render"
readout shows the measured time). Masks are 8-bit, edited on the CPU, uploaded as dirty-rectangle texture updates.

## Color database (RAL Classic & NCS)

- **RAL Classic** (`lib/color/data/ral-classic.json`, built by `node scripts/build-ral-data.mjs`): 217 colors with
  code, hex and names in Arabic, German and English. Hex values come from Wikipedia's *List of RAL colours*
  (CC BY-SA 4.0); RAL's binding values are only available in the licensed RAL DIGITAL. Pearl, fluorescent and
  metallic finishes are flagged and never suggested as wall paint.
- **NCS** (`lib/color/ncs.ts`): NCS Colour AB's colorimetric data is licensed, so colors are **calculated from the
  NCS notation** (blackness, chromaticness, hue). Elementary hues Y/R/B/G are anchored at the unique-hue angles in
  CIELAB, intermediate hues interpolated, and nuances mixed like the HWB model, calibrated against published screen
  approximations. The chart offers 2,472 notations on the standard steps for 40 hues plus the grey scale; any valid
  code (e.g. `S 1052-Y92R`) can be typed. All NCS colors are marked "approximate".
- **Data model** (`lib/color/catalog.ts`): `PaintColor` has collection, code, localized names, hex, Lab, family,
  and optional manufacturer fields (`brand`, `pricePerLiter`, `coverageM2PerLiter`, `labMeasured` for official
  measured values) so a seller's own collections and prices can be added later.
- **Search:** codes in any format (`9010`, `ral9010`, `S 1050-Y90R`, `1050y90r`), names in all languages (accents
  and Arabic letter variants normalized), family filter computed from CIELAB.
- **Closest paint:** CIEDE2000 against the whole catalogue (or one collection), with a quality label.
- **Ideas** (`lib/color/palettes.ts`): complementary, analogous, triadic, split-complementary and tone-on-tone palettes
  generated in LCh from the current color or from colors detected in the photo (k-means in Lab, excluding the
  surfaces being painted), each mapped to the closest real paint; five style presets (Modern, Scandinavian,
  Mediterranean, Classic, Arabic/Moroccan).

> Before commercial launch, check whether your use of RAL and NCS names/codes requires a license from RAL gGmbH
> or NCS Colour AB (both offer digital licences). Official measured values can be imported into `labMeasured`.

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
- **Scene understanding:** `POST /api/scene` runs SegFormer-B5 (ADE20K, 150 classes) on the server and returns a
  160×160 class map. Combined with SAM it powers *Paint all walls* (one surface for the walls, one for the
  ceiling), joins parts of the same wall split by furniture (*This part only* undoes it), names surfaces, warns
  when a tap hits furniture/window/floor, and places the “tap the wall” hint. Disable with `SCENE_SERVER=off`.
- **Phones:** iPhones and Android phones always use the server embedding path (the in-browser encoder needs
  ~2.3 GB and mobile Safari reloads the page above ~1.4 GB); taps are still decoded on the device.
- **Cross-origin isolation:** the editor page is served with COOP/COEP headers (see `next.config.ts`) so
  WebAssembly can use multiple threads.

## Project structure

```
app/[locale]/            pages (home, editor, qr poster); root layout sets lang/dir
components/editor/       Editor, Stage (canvas + gestures), Toolbar, panels
lib/color/               sRGB/XYZ/CIELAB/LCh, CIEDE2000, catalogue (RAL/NCS), NCS model, palettes,
                         shop groups and plain-language search (groups.ts)
lib/recolor/             recolor model, GLSL shaders, WebGL renderer
lib/mask/                brush/eraser/blur/merge ops, polygon raster, undo history, edge refinement
lib/segmentation/        SAM worker, client (status, fallback), post-processing, IndexedDB cache
app/api/sam/embed/       server fallback that computes SAM embeddings
app/api/scene/           scene understanding (SegFormer-B5, ADE20K classes)
lib/paint/               paint quantity: area, litres, can combination
lib/editor/              document (masks, lighting maps), autosave (IndexedDB)
lib/brand.ts             shop name and WhatsApp number
lib/image/               JPG/PNG/HEIC loading, EXIF orientation, resize to 2048 px
lib/i18n/ + messages/    typed translations (missing keys are compile errors)
tests/unit/  e2e/        Vitest and Playwright tests
```

## Editor controls

- **Smart select** (`S`, default): tap a wall. Tap more points to extend it; choose *Remove* and tap to take
  areas away. *Smaller / Larger* switch between alternative selections; *Done* (or Esc) finishes.
- **Detect all surfaces:** highlights every surface found; tap the ones to paint, then *Add selected*.
- **Color chart / Ideas / Match a color:** pick a RAL or NCS paint, get palette ideas, or use *Pick from photo*
  (eyedropper) to find the closest real paints.
- **Brush / Eraser** (`B` / `E`): paint the selected surface; `[` `]` change brush size.
- **Lasso** (`L`): tap points, tap the first point or press *Done*/Enter to close; Esc cancels, Backspace removes a point. Add or remove mode.
- **Move** (`H`), mouse wheel / pinch to zoom, two fingers to pan.
- **Undo / Redo**: Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z or Ctrl+Y. `M` toggles the selection overlay.

## Environment variables

None are required. All are optional (see `.env.example`):

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_BRAND_NAME` | Shop name in the header, titles, messages and file names (default `ALSY PAINTS`) |
| `NEXT_PUBLIC_SELLER_WHATSAPP` | Shop's WhatsApp number, international digits (e.g. `213550123456`); without it, *Send on WhatsApp* lets the customer pick a contact |
| `NEXT_PUBLIC_CAN_SIZES` | Can sizes sold, in litres (default `1,2.5,5,10`) |
| `NEXT_PUBLIC_SITE_URL` | Address printed in the QR poster (default: the address the poster is opened on) |
| `SAM_SERVER_FALLBACK=off` | Disable server-side SAM embeddings (phones then cannot use the AI) |
| `SCENE_SERVER=off` | Disable scene understanding (*Paint all walls*, wall names, hints) |
| `SAM_CACHE_DIR` | Where the server caches downloaded models (default: temp dir) |

The shop's best sellers (the colour chart's first group) are listed in `POPULAR_CODES` in `lib/color/groups.ts`.

## Deploying to Vercel

1. Push the repository to GitHub and import it in Vercel (framework preset: Next.js, defaults are fine).
2. Add the variables from `.env.example` in *Project → Settings → Environment Variables* when later phases need them.
3. Deploy. The middleware redirects `/` to the user's last language (cookie) or Arabic.
4. The SAM server fallback runs as a Node serverless function (`maxDuration` 60 s, ~90 MB incl. the Linux
   ONNX runtime; GPU/other-platform binaries are excluded in `next.config.ts`). The model is downloaded to
   the function's temp dir on cold start. Give the function at least 1 GB of memory.
5. Scene understanding (`/api/scene`) works the same way with a larger model (~85 MB, quantized); its first
   request after a cold start takes longer (the client retries). Give it the same memory as the SAM function.
6. After deploying, open `/ar/qr` on the production address and print the poster for the counter.
