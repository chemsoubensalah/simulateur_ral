# ColorVision

AI-assisted paint visualizer: upload a photo of a room or facade, select the walls and repaint them
realistically — shadows, light gradients and texture are preserved. Arabic (RTL, default), German and English.

> **Status: Phase 1 of 7** — project setup, i18n with RTL, photo upload, manual masking (brush, eraser,
> lasso, edge softness, undo/redo, multiple surfaces), real-time WebGL CIELAB recoloring with finishes,
> before/after slider and JPG download. Later phases: SAM wall detection, color database & palettes,
> paint calculator & PDF, accounts & sharing, live camera, shop.

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
| `npm test` | Unit tests (Vitest): LAB conversion, ΔE2000 (Sharma reference data), recolor model, mask ops, i18n completeness |
| `npm run test:e2e` | Builds, then runs Playwright on desktop Chrome and an emulated Android phone (incl. touch strokes) |
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

## Project structure

```
app/[locale]/            pages (home, editor); root layout sets lang/dir
components/editor/       Editor, Stage (canvas + gestures), Toolbar, panels
lib/color/               sRGB/XYZ/CIELAB/LCh conversions, CIEDE2000
lib/recolor/             recolor model, GLSL shaders, WebGL renderer
lib/mask/                brush/eraser/blur/merge ops, polygon raster, undo history
lib/image/               JPG/PNG/HEIC loading, EXIF orientation, resize to 2048 px
lib/i18n/ + messages/    typed translations (missing keys are compile errors)
tests/unit/  e2e/        Vitest and Playwright tests
```

## Editor controls

- **Brush / Eraser** (`B` / `E`): paint the selected surface; `[` `]` change brush size.
- **Lasso** (`L`): tap points, tap the first point or press *Done*/Enter to close; Esc cancels, Backspace removes a point. Add or remove mode.
- **Move** (`H`), mouse wheel / pinch to zoom, two fingers to pan.
- **Undo / Redo**: Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z or Ctrl+Y. `M` toggles the selection overlay.

## Environment variables

Phase 1 needs none. Copy `.env.example` to `.env.local` once later phases (Supabase, Stripe, SAM fallback) are added.

## Deploying to Vercel

1. Push the repository to GitHub and import it in Vercel (framework preset: Next.js, defaults are fine).
2. Add the variables from `.env.example` in *Project → Settings → Environment Variables* when later phases need them.
3. Deploy. The middleware redirects `/` to the user's last language (cookie) or Arabic.
