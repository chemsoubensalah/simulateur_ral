/**
 * Post-processing of Segment Anything outputs, independent of the runtime so it
 * can be unit-tested and shared by the Web Worker.
 *
 * SAM's decoder returns 256×256 mask logits for a 1024×1024 padded input. Only
 * the top-left region (reshapedW/4 × reshapedH/4) covers the actual image.
 */

export const LOW_RES = 256;

/** Geometry of the encoder input, needed to map between image and model space. */
export type EncoderGeometry = {
  /** Size of the image the embeddings were computed from. */
  originalWidth: number;
  originalHeight: number;
  /** Size of the resized image inside the 1024 padded square. */
  reshapedWidth: number;
  reshapedHeight: number;
};

export type Point = { x: number; y: number; label: 0 | 1 };

/** Width/height of the valid (non-padding) part of the 256×256 logits. */
export function validLowRes(g: EncoderGeometry): { w: number; h: number } {
  return { w: (g.reshapedWidth * LOW_RES) / 1024, h: (g.reshapedHeight * LOW_RES) / 1024 };
}

/** Convert points in image pixels (of an image of size imgW×imgH) to model (1024) space. */
export function toModelPoints(points: Point[], imgW: number, imgH: number, g: EncoderGeometry): number[] {
  const sx = g.reshapedWidth / imgW;
  const sy = g.reshapedHeight / imgH;
  return points.flatMap((p) => [p.x * sx, p.y * sy]);
}

/**
 * Bilinearly upsample one 256×256 logit map (at `offset` in `logits`) to
 * outW×outH and convert to an 8-bit mask. SAM's decision threshold is logit 0;
 * a narrow soft zone (±0.25) gives a thin anti-aliased edge that edge
 * refinement then snaps to the photo. A wider zone would turn SAM's uncertain
 * regions into semi-transparent blotches.
 */
export function upsampleLogits(
  logits: Float32Array,
  offset: number,
  g: EncoderGeometry,
  outW: number,
  outH: number,
): Uint8Array {
  const { w: vw, h: vh } = validLowRes(g);
  const maxX = Math.ceil(vw) - 1;
  const maxY = Math.ceil(vh) - 1;
  const out = new Uint8Array(outW * outH);
  const fx = vw / outW;
  const fy = vh / outH;
  // Precompute horizontal sample positions.
  const x0s = new Int32Array(outW);
  const x1s = new Int32Array(outW);
  const wx = new Float32Array(outW);
  for (let x = 0; x < outW; x++) {
    const u = Math.min(maxX, Math.max(0, (x + 0.5) * fx - 0.5));
    const x0 = Math.floor(u);
    x0s[x] = x0;
    x1s[x] = Math.min(maxX, x0 + 1);
    wx[x] = u - x0;
  }
  for (let y = 0; y < outH; y++) {
    const v = Math.min(maxY, Math.max(0, (y + 0.5) * fy - 0.5));
    const y0 = Math.floor(v);
    const y1 = Math.min(maxY, y0 + 1);
    const wy = v - y0;
    const r0 = offset + y0 * LOW_RES;
    const r1 = offset + y1 * LOW_RES;
    const row = y * outW;
    for (let x = 0; x < outW; x++) {
      const a = logits[r0 + x0s[x]!]!;
      const b = logits[r0 + x1s[x]!]!;
      const c = logits[r1 + x0s[x]!]!;
      const d = logits[r1 + x1s[x]!]!;
      const t = wx[x]!;
      const top = a + (b - a) * t;
      const bot = c + (d - c) * t;
      const l = top + (bot - top) * wy;
      const alpha = (l + 0.25) * 2;
      out[row + x] = alpha <= 0 ? 0 : alpha >= 1 ? 255 : Math.round(alpha * 255);
    }
  }
  return out;
}

export type LowResStats = {
  /** Fraction of the valid area with logit > 0. */
  area: number;
  /** SAM stability score: |logit > +1| / |logit > −1|. */
  stability: number;
  bbox: { x0: number; y0: number; x1: number; y1: number } | null;
};

export function lowResStats(logits: Float32Array, offset: number, g: EncoderGeometry): LowResStats {
  const { w, h } = validLowRes(g);
  const W = Math.floor(w);
  const H = Math.floor(h);
  let pos = 0;
  let hi = 0;
  let lo = 0;
  let x0 = W;
  let y0 = H;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < H; y++) {
    const r = offset + y * LOW_RES;
    for (let x = 0; x < W; x++) {
      const v = logits[r + x]!;
      if (v > -1) lo++;
      if (v > 1) hi++;
      if (v > 0) {
        pos++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        y1 = y;
      }
    }
  }
  return {
    area: pos / (W * H),
    stability: lo > 0 ? hi / lo : 0,
    bbox: x1 < 0 ? null : { x0: x0 / W, y0: y0 / H, x1: (x1 + 1) / W, y1: (y1 + 1) / H },
  };
}

/** Binary (logit > 0) low-res mask of the valid region, as a bitset-ish Uint8Array. */
export function lowResBinary(logits: Float32Array, offset: number, g: EncoderGeometry): { data: Uint8Array; w: number; h: number } {
  const { w, h } = validLowRes(g);
  const W = Math.floor(w);
  const H = Math.floor(h);
  const data = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const r = offset + y * LOW_RES;
    for (let x = 0; x < W; x++) data[y * W + x] = logits[r + x]! > 0 ? 1 : 0;
  }
  return { data, w: W, h: H };
}

export function binaryArea(a: Uint8Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]!;
  return s;
}

export function intersection(a: Uint8Array, b: Uint8Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! & b[i]!;
  return s;
}

export function iou(a: Uint8Array, b: Uint8Array): number {
  const inter = intersection(a, b);
  const uni = binaryArea(a) + binaryArea(b) - inter;
  return uni === 0 ? 0 : inter / uni;
}

/** Index of the best of SAM's 3 mask hypotheses for a prompt. */
export function bestMaskIndex(scores: ArrayLike<number>, offset = 0, count = 3): number {
  let best = 0;
  for (let k = 1; k < count; k++) if (scores[offset + k]! > scores[offset + best]!) best = k;
  return best;
}

export type RawCandidate = {
  /** Index into the flattened (prompt, hypothesis) output. */
  index: number;
  score: number;
  stability: number;
  area: number;
  bin: Uint8Array;
};

export type CandidateOptions = {
  minScore: number;
  minStability: number;
  minArea: number;
  maxArea: number;
  nmsIou: number;
  maxCount: number;
};

export const DEFAULT_CANDIDATE_OPTIONS: CandidateOptions = {
  minScore: 0.83,
  // Walls with windows/doors cut out are legitimately less "stable" than solid objects.
  minStability: 0.7,
  minArea: 0.012,
  maxArea: 0.92,
  nmsIou: 0.7,
  maxCount: 14,
};

/**
 * Automatic mask generation filtering: quality thresholds, non-maximum
 * suppression, then removal of "union" masks that are just several kept
 * surfaces together (e.g. wall + ceiling), so the user picks atomic surfaces.
 * Returns kept candidates sorted by area (largest first).
 */
export function selectCandidates(raw: RawCandidate[], opts: CandidateOptions = DEFAULT_CANDIDATE_OPTIONS): RawCandidate[] {
  const ok = raw
    .filter((c) => c.score >= opts.minScore && c.stability >= opts.minStability && c.area >= opts.minArea && c.area <= opts.maxArea)
    .sort((a, b) => b.score * b.stability - a.score * a.stability);

  const kept: RawCandidate[] = [];
  for (const c of ok) {
    if (kept.some((k) => iou(k.bin, c.bin) > opts.nmsIou)) continue;
    kept.push(c);
  }

  // Remove unions: a mask mostly covered by ≥2 smaller kept masks that lie inside it.
  const bySize = [...kept].sort((a, b) => b.area - a.area);
  const removed = new Set<RawCandidate>();
  for (const big of bySize) {
    const bigArea = binaryArea(big.bin);
    const parts = kept.filter((k) => k !== big && !removed.has(k) && k.area < big.area && intersection(k.bin, big.bin) >= 0.85 * binaryArea(k.bin));
    if (parts.length < 2) continue;
    const covered = new Uint8Array(big.bin.length);
    for (const p of parts) for (let i = 0; i < covered.length; i++) covered[i] = covered[i]! | (p.bin[i]! & big.bin[i]!);
    if (binaryArea(covered) >= 0.85 * bigArea) removed.add(big);
  }

  return kept
    .filter((k) => !removed.has(k))
    .sort((a, b) => b.area - a.area)
    .slice(0, opts.maxCount);
}

/** Regular grid of prompt points (normalised 0..1) for automatic mask generation. */
export function gridPoints(cols: number, rows: number): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) pts.push({ x: (c + 0.5) / cols, y: (r + 0.5) / rows });
  return pts;
}

/**
 * Remove small disconnected blobs from one 256×256 logit map. A component is
 * kept if it contains a seed (model-space positive point) or covers at least
 * `minFrac` of the mask's total area. Returns a copy of that map (offset 0).
 */
export function removeSpecks(
  logits: Float32Array,
  offset: number,
  g: EncoderGeometry,
  seeds: { x: number; y: number }[],
  minFrac = 0.03,
): Float32Array {
  const out = logits.slice(offset, offset + LOW_RES * LOW_RES);
  const { w, h } = validLowRes(g);
  const W = Math.ceil(w);
  const H = Math.ceil(h);
  const label = new Int32Array(LOW_RES * LOW_RES).fill(-1);
  const sizes: number[] = [];
  const queue = new Int32Array(W * H);
  let total = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * LOW_RES + x;
      if (out[i]! <= 0 || label[i] !== -1) continue;
      const id = sizes.length;
      let head = 0;
      let tail = 0;
      queue[tail++] = i;
      label[i] = id;
      let size = 0;
      while (head < tail) {
        const j = queue[head++]!;
        size++;
        const jx = j % LOW_RES;
        const jy = (j - jx) / LOW_RES;
        const nb = [jx > 0 ? j - 1 : -1, jx < W - 1 ? j + 1 : -1, jy > 0 ? j - LOW_RES : -1, jy < H - 1 ? j + LOW_RES : -1];
        for (const k of nb) {
          if (k < 0 || label[k] !== -1 || out[k]! <= 0) continue;
          label[k] = id;
          queue[tail++] = k;
        }
      }
      sizes.push(size);
      total += size;
    }
  if (sizes.length <= 1) return out;
  const keep = sizes.map((s) => s >= minFrac * total);
  for (const s of seeds) {
    const x = Math.min(W - 1, Math.max(0, Math.floor(s.x / 4)));
    const y = Math.min(H - 1, Math.max(0, Math.floor(s.y / 4)));
    const id = label[y * LOW_RES + x]!;
    if (id >= 0) keep[id] = true;
  }
  for (let i = 0; i < out.length; i++) {
    const id = label[i]!;
    if (id >= 0 && !keep[id]) out[i] = -20;
  }
  return out;
}

/**
 * Choose which of SAM's 3 hypotheses to use for a single tap. If automatic
 * analysis already found atomic surfaces, prefer the hypothesis that best
 * matches the most specific surface under the tap (so tapping a facade wall
 * selects the wall, not "the whole house"). Otherwise use the highest score.
 */
export function chooseHypothesis(
  hypotheses: { score: number; stability: number; bin: Uint8Array }[],
  surfacesAtTap: Uint8Array[],
): number {
  // Without surface knowledge, prefer confident AND stable masks: unstable
  // hypotheses tend to carry blocky fragments of neighbouring objects.
  const quality = (h: { score: number; stability: number }) => h.score + 0.5 * h.stability;
  let best = 0;
  for (let k = 1; k < hypotheses.length; k++) if (quality(hypotheses[k]!) > quality(hypotheses[best]!)) best = k;
  if (surfacesAtTap.length === 0) return best;
  // Most specific surface = smallest area containing the tap.
  const target = surfacesAtTap.reduce((a, b) => (binaryArea(b) < binaryArea(a) ? b : a));
  let bestIou = 0;
  let pick = best;
  hypotheses.forEach((hyp, k) => {
    const v = iou(hyp.bin, target);
    if (v > bestIou) {
      bestIou = v;
      pick = k;
    }
  });
  return bestIou >= 0.5 ? pick : best;
}

/**
 * Decisive clean-up of one 256×256 logit map (SAM's "remove small regions"
 * step, extended). Where SAM is unsure, logits hover around 0 and a soft
 * conversion would produce semi-transparent, blotchy squares on the wall.
 * We instead decide every low-res pixel:
 *  1. binarise at 0, then two 3×3 majority passes remove checkerboard noise;
 *  2. enclosed holes smaller than `holeFrac` of the mask are filled;
 *  3. islands not containing a seed and smaller than `islandFrac` are removed;
 * and return logits pushed to at least ±`margin` on the decided side, so that
 * upsampling gives a smooth, crisp boundary. Returns a copy (offset 0).
 */
export function cleanLogits(
  logits: Float32Array,
  offset: number,
  g: EncoderGeometry,
  seeds: { x: number; y: number }[],
  opts: { holeFrac?: number; islandFrac?: number; margin?: number } = {},
): Float32Array {
  const holeFrac = opts.holeFrac ?? 0.02;
  const islandFrac = opts.islandFrac ?? 0.03;
  const margin = opts.margin ?? 2;
  const { w, h } = validLowRes(g);
  const W = Math.ceil(w);
  const H = Math.ceil(h);
  const src = logits.subarray(offset, offset + LOW_RES * LOW_RES);
  let bin = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) bin[y * W + x] = src[y * LOW_RES + x]! > 0 ? 1 : 0;

  // 1. majority filter (twice)
  for (let pass = 0; pass < 2; pass++) {
    const next = new Uint8Array(W * H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let s = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
            s += bin[yy * W + xx]!;
            n++;
          }
        next[y * W + x] = s * 2 > n ? 1 : s * 2 < n ? 0 : bin[y * W + x]!;
      }
    bin = next;
  }

  // Connected components of value `v` (4-connectivity).
  const components = (v: number) => {
    const label = new Int32Array(W * H).fill(-1);
    const comps: { size: number; border: boolean; pixels: number[] }[] = [];
    const queue = new Int32Array(W * H);
    for (let i = 0; i < W * H; i++) {
      if (bin[i] !== v || label[i] !== -1) continue;
      const id = comps.length;
      const pixels: number[] = [];
      let border = false;
      let head = 0;
      let tail = 0;
      queue[tail++] = i;
      label[i] = id;
      while (head < tail) {
        const j = queue[head++]!;
        pixels.push(j);
        const x = j % W;
        const y = (j - x) / W;
        if (x === 0 || y === 0 || x === W - 1 || y === H - 1) border = true;
        for (const k of [x > 0 ? j - 1 : -1, x < W - 1 ? j + 1 : -1, y > 0 ? j - W : -1, y < H - 1 ? j + W : -1]) {
          if (k < 0 || label[k] !== -1 || bin[k] !== v) continue;
          label[k] = id;
          queue[tail++] = k;
        }
      }
      comps.push({ size: pixels.length, border, pixels });
    }
    return { label, comps };
  };

  let area = 0;
  for (let i = 0; i < W * H; i++) area += bin[i]!;
  // 2. fill small enclosed holes
  for (const c of components(0).comps) if (!c.border && c.size < holeFrac * area) for (const p of c.pixels) bin[p] = 1;
  // 3. remove small islands without a seed
  const { label, comps } = components(1);
  const keep = comps.map((c) => c.size >= islandFrac * area);
  for (const s of seeds) {
    const x = Math.min(W - 1, Math.max(0, Math.floor(s.x / 4)));
    const y = Math.min(H - 1, Math.max(0, Math.floor(s.y / 4)));
    const id = label[y * W + x]!;
    if (id >= 0) keep[id] = true;
  }
  comps.forEach((c, id) => {
    if (!keep[id]) for (const p of c.pixels) bin[p] = 0;
  });

  const out = new Float32Array(LOW_RES * LOW_RES).fill(-20);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const v = src[y * LOW_RES + x]!;
      out[y * LOW_RES + x] = bin[y * W + x] ? Math.max(v, margin) : Math.min(v, -margin);
    }
  return out;
}
