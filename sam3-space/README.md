---
title: ALSY PAINTS walls
emoji: 🎨
colorFrom: green
colorTo: yellow
sdk: docker
app_port: 7860
pinned: false
---

# ALSY PAINTS — walls server (SAM 3)

Finds every wall and the ceiling in a room photo with Meta's **SAM 3** (text prompts
"wall" and "ceiling"), for the ALSY PAINTS colour visualizer. Objects on or in front of
the walls (air conditioners, frames, furniture, windows) are left out.

- `GET /api/walls` → status
- `POST /api/walls` with the photo (JPEG) → masks (binary format, see `server.mjs`)

About 40 s per photo on the free CPU hardware (2 vCPU). The model is downloaded once
while the Space is built (ONNX int8 export: `danilobukvic/sam3-text-onnx`).

Settings (Space → Settings → Variables): `ALLOWED_ORIGINS` = your site's address
(e.g. `https://alsy-paints-simulateur.vercel.app`), optional `PER_HOUR`, `PER_DAY`.

SAM 3 is released by Meta under the SAM License.
