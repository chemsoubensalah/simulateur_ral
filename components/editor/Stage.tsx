"use client";

import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { RecolorRenderer, type OverlayInput, type SurfaceRenderInput } from "@/lib/recolor/renderer";
import type { LightingGains } from "@/lib/recolor/lighting";
import type { EditorDocument } from "@/lib/editor/document";
import type { LoadedImage } from "@/lib/image/load";
import { emptyRect, mergeCoverage, strokeSegment, unionRect, type BrushMode, type Rect } from "@/lib/mask/ops";
import { rasterizePolygon, type Point } from "@/lib/mask/polygon";
import type { SurfaceStats } from "@/lib/recolor/model";
import { useI18n } from "@/lib/i18n/client";
import type { Surface, Tool, ViewTransform } from "./types";
import { FitIcon, MinusIcon, PlusIcon } from "./icons";

export type StageHandle = {
  uploadMask: (id: string, mask: Uint8Array, width?: number, height?: number) => void;
  removeMask: (id: string) => void;
  requestRender: () => void;
  exportBlob: (type?: string, quality?: number) => Promise<Blob | null>;
  /** Pixel of the current (recolored) render, image coordinates. */
  readPixel: (x: number, y: number) => [number, number, number];
};

type Props = {
  ref?: Ref<StageHandle>;
  doc: EditorDocument;
  image: LoadedImage;
  surfaces: Surface[];
  selectedId: string | null;
  tool: Tool;
  brushSize: number; // screen px (diameter)
  hardness: number;
  lassoMode: BrushMode;
  showMask: boolean;
  compare: boolean;
  comparePos: number;
  onComparePos: (pos: number) => void;
  onEditEnd: (surfaceId: string, before: Uint8Array, rect: Rect) => void;
  onRenderTime?: (ms: number) => void;
  onWebglError: () => void;
  /** Colour of the light (photo and paint); undefined = as photographed. */
  lighting?: LightingGains;
  /** Additional tinted masks (e.g. detected surfaces), drawn above the selection highlight. */
  overlays?: OverlayInput[];
  /** When true, taps go to onTap whatever the tool (used to pick detected surfaces). */
  tapMode?: boolean;
  onTap?: (p: Point) => void;
  /** Prompt points of the current smart selection. */
  markers?: { x: number; y: number; label: 0 | 1 }[];
  busy?: boolean;
  /** Controls shown at the bottom / top of the photo. */
  bottomBar?: ReactNode;
  topChip?: ReactNode;
};

const MIN_SCALE = 1;
const MAX_SCALE = 8;
const OVERLAY_COLOR: [number, number, number] = [0.13, 0.45, 0.95];

const renderInput = (s: Surface, stats = s.stats): SurfaceRenderInput => ({
  id: s.id,
  target: s.lab,
  stats,
  finish: s.finish,
  brightness: s.brightness,
  visible: s.visible,
  cleanup: s.cleanup,
});

type Gesture =
  | { kind: "idle" }
  | { kind: "stroke"; surfaceId: string; mode: BrushMode; before: Uint8Array; last: Point; rect: Rect; radius: number }
  | { kind: "pan"; startX: number; startY: number; view: ViewTransform }
  | { kind: "pinch"; dist: number; midX: number; midY: number; view: ViewTransform }
  | { kind: "tap"; startX: number; startY: number };

export function Stage(props: Props) {
  const { doc, image, surfaces, selectedId, tool, brushSize, lassoMode, showMask, compare, comparePos } = props;
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const glCanvasRef = useRef<HTMLCanvasElement>(null);
  const origCanvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<RecolorRenderer | null>(null);
  const rafRef = useRef<number | null>(null);
  const liveMean = useRef<{ id: string; stats: SurfaceStats | null; at: number } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<Gesture>({ kind: "idle" });
  const lastRenderReport = useRef(0);
  const renderCount = useRef(0);

  const [box, setBox] = useState({ cw: 0, ch: 0, dw: 0, dh: 0 });
  const [view, setView] = useState<ViewTransform>({ scale: 1, x: 0, y: 0 });
  const [cursor, setCursor] = useState<Point | null>(null);
  const [lasso, setLasso] = useState<Point[]>([]);

  // Latest props in refs so event handlers & rAF never see stale values.
  const latest = useRef(props);
  latest.current = props;
  const viewRef = useRef(view);
  viewRef.current = view;
  const lassoRef = useRef(lasso);
  lassoRef.current = lasso;

  /* ---------- rendering ---------- */

  const renderNow = useCallback(() => {
    rafRef.current = null;
    const r = rendererRef.current;
    if (!r) return;
    const p = latest.current;
    const live = liveMean.current;
    const inputs = p.surfaces.map((s) => renderInput(s, live && live.id === s.id ? live.stats : s.stats));
    const t0 = performance.now();
    const overlays: OverlayInput[] = [];
    if (p.showMask && !p.compare && p.selectedId && !p.tapMode) overlays.push({ maskId: p.selectedId, color: OVERLAY_COLOR, opacity: 0.35 });
    if (!p.compare && p.overlays) overlays.push(...p.overlays);
    r.render(inputs, overlays, p.lighting);
    // Skip the first frames: they include shader compilation and texture upload.
    if (p.onRenderTime && ++renderCount.current > 2 && t0 - lastRenderReport.current > 300) {
      r.readPixel(0, 0); // forces the GPU to finish so the timing is real
      lastRenderReport.current = t0;
      p.onRenderTime(performance.now() - t0);
    }
  }, []);

  const requestRender = useCallback(() => {
    if (rafRef.current === null) rafRef.current = requestAnimationFrame(renderNow);
  }, [renderNow]);

  // Create the renderer for this image.
  useEffect(() => {
    const canvas = glCanvasRef.current;
    if (!canvas) return;
    let r: RecolorRenderer;
    try {
      r = new RecolorRenderer(canvas);
    } catch {
      latest.current.onWebglError();
      return;
    }
    r.setImage(image.canvas, image.width, image.height);
    for (const s of latest.current.surfaces) {
      const m = doc.displayMask(s.id);
      if (m) r.setMask(s.id, m);
      r.setShading(s.id, doc.shading(s.id));
    }
    rendererRef.current = r;
    renderCount.current = 0;
    requestRender();
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      r.dispose();
      rendererRef.current = null;
    };
  }, [doc, image, requestRender]);

  useEffect(() => {
    requestRender();
  }, [surfaces, selectedId, showMask, compare, props.overlays, props.tapMode, props.lighting, requestRender]);

  // The untouched photo is only needed for the before/after slider: create it
  // on demand and release it afterwards (saves ~12 MB plus GPU memory on phones).
  // With a lighting mode, "before" is the photo under the same light.
  useEffect(() => {
    const orig = origCanvasRef.current;
    const r = rendererRef.current;
    if (!orig) return;
    if (compare) {
      orig.width = image.width;
      orig.height = image.height;
      const ctx = orig.getContext("2d");
      const neutral = !props.lighting || props.lighting.image.every((v) => v === 1);
      if (neutral || !r || !glCanvasRef.current) ctx?.drawImage(image.canvas, 0, 0);
      else {
        r.render([], [], props.lighting);
        ctx?.drawImage(glCanvasRef.current, 0, 0);
        renderNow();
      }
    } else {
      orig.width = 0;
      orig.height = 0;
    }
  }, [compare, image, props.lighting, renderNow]);

  useImperativeHandle(
    props.ref,
    () => ({
      uploadMask: (id, mask, width, height) => {
        rendererRef.current?.setMask(id, mask, width, height);
        // Surface masks (full size) come with their lighting map.
        if (width === undefined) rendererRef.current?.setShading(id, doc.shading(id));
        requestRender();
      },
      removeMask: (id) => {
        rendererRef.current?.removeMask(id);
        requestRender();
      },
      requestRender,
      exportBlob: (type = "image/jpeg", quality = 0.92) =>
        new Promise((resolve) => {
          const r = rendererRef.current;
          const canvas = glCanvasRef.current;
          if (!r || !canvas) return resolve(null);
          // Render without the selection overlay, export, then restore.
          const p = latest.current;
          r.render(p.surfaces.map((s) => renderInput(s)), [], p.lighting);
          canvas.toBlob((b) => {
            resolve(b);
            requestRender();
          }, type, quality);
        }),
      readPixel: (x, y) => rendererRef.current?.readPixel(x, y) ?? [0, 0, 0],
    }),
    [doc, requestRender],
  );

  /* ---------- layout ---------- */

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const cw = el.clientWidth;
      const ch = el.clientHeight;
      const fit = Math.min(cw / image.width, ch / image.height);
      setBox({ cw, ch, dw: image.width * fit, dh: image.height * fit });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [image]);

  const offsetX = (box.cw - box.dw) / 2;
  const offsetY = (box.ch - box.dh) / 2;

  const clampView = useCallback(
    (v: ViewTransform): ViewTransform => {
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale));
      if (scale === 1) return { scale, x: 0, y: 0 };
      // Keep at least 25% of the image on screen.
      const w = box.dw * scale;
      const h = box.dh * scale;
      const minX = -offsetX - w * 0.75;
      const maxX = box.cw - offsetX - w * 0.25;
      const minY = -offsetY - h * 0.75;
      const maxY = box.ch - offsetY - h * 0.25;
      return { scale, x: Math.min(maxX, Math.max(minX, v.x)), y: Math.min(maxY, Math.max(minY, v.y)) };
    },
    [box, offsetX, offsetY],
  );

  const zoomAt = useCallback(
    (factor: number, px: number, py: number, from: ViewTransform = viewRef.current) => {
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, from.scale * factor));
      const qx = (px - offsetX - from.x) / from.scale;
      const qy = (py - offsetY - from.y) / from.scale;
      setView(clampView({ scale, x: px - offsetX - scale * qx, y: py - offsetY - scale * qy }));
    },
    [clampView, offsetX, offsetY],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  /* ---------- coordinate helpers ---------- */

  const toImage = useCallback(
    (clientX: number, clientY: number): Point | null => {
      const c = glCanvasRef.current;
      if (!c) return null;
      const r = c.getBoundingClientRect();
      if (r.width === 0) return null;
      return { x: ((clientX - r.left) / r.width) * image.width, y: ((clientY - r.top) / r.height) * image.height };
    },
    [image],
  );

  /** Image pixels per screen pixel at the current zoom. */
  const imagePerScreen = useCallback(() => {
    const c = glCanvasRef.current;
    const w = c?.getBoundingClientRect().width || 1;
    return image.width / w;
  }, [image]);

  /* ---------- editing ---------- */

  const updateLiveMean = useCallback(
    (id: string, force = false) => {
      const now = performance.now();
      const cur = liveMean.current;
      if (!force && cur && cur.id === id && now - cur.at < 120) return;
      const m = doc.rawMask(id);
      if (!m) return;
      liveMean.current = { id, stats: doc.stats(m), at: now };
    },
    [doc],
  );

  const applySegment = useCallback(
    (g: Extract<Gesture, { kind: "stroke" }>, to: Point) => {
      const mask = doc.rawMask(g.surfaceId);
      if (!mask) return;
      const rect = strokeSegment(mask, doc.width, doc.height, g.last.x, g.last.y, to.x, to.y, g.radius, g.mode, latest.current.hardness);
      g.rect = unionRect(g.rect, rect);
      g.last = to;
      if (rect.w > 0 && rect.h > 0) rendererRef.current?.updateMaskRegion(g.surfaceId, mask, rect.x, rect.y, rect.w, rect.h);
      updateLiveMean(g.surfaceId);
      requestRender();
    },
    [doc, requestRender, updateLiveMean],
  );

  const cancelStroke = useCallback(() => {
    const g = gesture.current;
    if (g.kind !== "stroke") return;
    const mask = doc.rawMask(g.surfaceId);
    if (mask) {
      mask.set(g.before);
      rendererRef.current?.setMask(g.surfaceId, doc.displayMask(g.surfaceId) ?? mask);
    }
    liveMean.current = null;
    gesture.current = { kind: "idle" };
    requestRender();
  }, [doc, requestRender]);

  const finishStroke = useCallback(() => {
    const g = gesture.current;
    gesture.current = { kind: "idle" };
    if (g.kind !== "stroke") return;
    liveMean.current = null;
    latest.current.onEditEnd(g.surfaceId, g.before, g.rect);
  }, []);

  const closeLasso = useCallback(() => {
    const pts = lassoRef.current;
    const id = latest.current.selectedId;
    setLasso([]);
    if (pts.length < 3 || !id) return;
    const mask = doc.rawMask(id);
    if (!mask) return;
    const before = mask.slice();
    const { coverage, rect } = rasterizePolygon(pts, doc.width, doc.height);
    mergeCoverage(mask, coverage, latest.current.lassoMode);
    latest.current.onEditEnd(id, before, rect);
  }, [doc]);

  // Reset lasso when switching tool or surface.
  useEffect(() => {
    setLasso([]);
  }, [tool, selectedId]);

  /* ---------- pointer handling ---------- */

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (compare) return;
    containerRef.current?.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size === 2) {
      cancelStroke();
      const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const rect = containerRef.current!.getBoundingClientRect();
      gesture.current = {
        kind: "pinch",
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        midX: (a.x + b.x) / 2 - rect.left,
        midY: (a.y + b.y) / 2 - rect.top,
        view: viewRef.current,
      };
      return;
    }
    if (pointers.current.size > 2) return;

    const usePan = tool === "pan" || e.button === 1 || (e.pointerType === "mouse" && e.button === 2);
    if (usePan) {
      gesture.current = { kind: "pan", startX: e.clientX, startY: e.clientY, view: viewRef.current };
      return;
    }
    if (e.button !== 0) return;

    if (tool === "lasso" || tool === "smart" || props.tapMode) {
      gesture.current = { kind: "tap", startX: e.clientX, startY: e.clientY };
      return;
    }
    if (!selectedId) return;
    const mask = doc.rawMask(selectedId);
    const p = toImage(e.clientX, e.clientY);
    if (!mask || !p) return;
    const g: Extract<Gesture, { kind: "stroke" }> = {
      kind: "stroke",
      surfaceId: selectedId,
      mode: tool === "eraser" ? "erase" : "add",
      before: mask.slice(),
      last: p,
      rect: emptyRect(),
      radius: Math.max(1, (brushSize / 2) * imagePerScreen()),
    };
    gesture.current = g;
    applySegment(g, p);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (compare) return;
    if (e.pointerType !== "touch") setCursor(toImage(e.clientX, e.clientY));
    if (!pointers.current.has(e.pointerId)) {
      if (tool === "lasso") setCursor(toImage(e.clientX, e.clientY));
      return;
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (g.kind === "stroke") {
      if (e.pointerType === "touch") setCursor(toImage(e.clientX, e.clientY));
      // Use coalesced events for smooth strokes on fast devices.
      const events = typeof e.nativeEvent.getCoalescedEvents === "function" ? e.nativeEvent.getCoalescedEvents() : [];
      const list = events.length ? events : [e.nativeEvent];
      for (const ev of list) {
        const p = toImage(ev.clientX, ev.clientY);
        if (p) applySegment(g, p);
      }
    } else if (g.kind === "pan") {
      setView(clampView({ ...g.view, x: g.view.x + e.clientX - g.startX, y: g.view.y + e.clientY - g.startY }));
    } else if (g.kind === "pinch" && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const rect = containerRef.current!.getBoundingClientRect();
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const midX = (a.x + b.x) / 2 - rect.left;
      const midY = (a.y + b.y) / 2 - rect.top;
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, g.view.scale * (dist / Math.max(1, g.dist))));
      const qx = (g.midX - offsetX - g.view.x) / g.view.scale;
      const qy = (g.midY - offsetY - g.view.y) / g.view.scale;
      setView(clampView({ scale, x: midX - offsetX - scale * qx, y: midY - offsetY - scale * qy }));
    }
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (g.kind === "stroke") finishStroke();
    else if (g.kind === "tap" && e.type === "pointerup") {
      gesture.current = { kind: "idle" };
      if (Math.hypot(e.clientX - g.startX, e.clientY - g.startY) < 8) {
        const p = toImage(e.clientX, e.clientY);
        if (!p) return;
        if (latest.current.tapMode || latest.current.tool === "smart") {
          if (p.x >= 0 && p.y >= 0 && p.x < image.width && p.y < image.height) latest.current.onTap?.(p);
          return;
        }
        const pts = lassoRef.current;
        const first = pts[0];
        const closeDist = 14 * imagePerScreen();
        if (first && pts.length >= 3 && Math.hypot(p.x - first.x, p.y - first.y) < closeDist) closeLasso();
        else setLasso([...pts, p]);
      }
    } else if (pointers.current.size === 0) gesture.current = { kind: "idle" };
    if (e.pointerType === "touch") setCursor(null);
  }

  /* ---------- keyboard (lasso) ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (lassoRef.current.length === 0) return;
      if (e.key === "Escape") setLasso([]);
      else if (e.key === "Enter") closeLasso();
      else if (e.key === "Backspace") setLasso((l) => l.slice(0, -1));
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeLasso]);

  /* ---------- render ---------- */

  const ips = box.dw > 0 ? image.width / (box.dw * view.scale) : 1;
  const brushR = (brushSize / 2) * ips;
  const showBrushCursor = cursor && !compare && !props.tapMode && (tool === "brush" || tool === "eraser");
  const zoomCenter = (f: number) => zoomAt(f, box.cw / 2, box.ch / 2);

  return (
    <div className="relative h-full w-full select-none overflow-hidden checkerboard" data-testid="stage">
      <div
        ref={containerRef}
        role="application"
        aria-label={t("editor.canvasLabel")}
        className="absolute inset-0"
        style={{
          touchAction: "none",
          cursor: compare ? "default" : props.tapMode ? "pointer" : tool === "pan" ? "grab" : tool === "lasso" || tool === "smart" ? "crosshair" : "none",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={(e) => {
          if (e.pointerType !== "touch" && !pointers.current.has(e.pointerId)) setCursor(null);
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div
          className="absolute origin-top-left"
          style={{
            left: offsetX,
            top: offsetY,
            width: box.dw,
            height: box.dh,
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
          }}
        >
          <canvas ref={origCanvasRef} className="absolute inset-0 h-full w-full" style={{ visibility: compare ? "visible" : "hidden" }} aria-hidden />
          <canvas
            ref={glCanvasRef}
            data-testid="render-canvas"
            className="absolute inset-0 h-full w-full"
            style={{ clipPath: compare ? `inset(0 0 0 ${comparePos}%)` : undefined }}
          />
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full"
            viewBox={`0 0 ${image.width} ${image.height}`}
            preserveAspectRatio="none"
            aria-hidden
          >
            {showBrushCursor && (
              <>
                <circle cx={cursor.x} cy={cursor.y} r={brushR} fill="none" stroke="#000" strokeOpacity={0.6} strokeWidth={3} vectorEffect="non-scaling-stroke" />
                <circle cx={cursor.x} cy={cursor.y} r={brushR} fill="none" stroke="#fff" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
              </>
            )}
            {!compare &&
              props.markers?.map((m, i) => (
                <g key={i} transform={`translate(${m.x} ${m.y}) scale(${ips})`}>
                  <circle r={11} fill={m.label === 1 ? "#1f8a70" : "#dc2626"} stroke="#fff" strokeWidth={2.5} />
                  <path d={m.label === 1 ? "M-5 0h10M0 -5v10" : "M-5 0h10"} stroke="#fff" strokeWidth={2.5} strokeLinecap="round" />
                  {props.busy && i === props.markers!.length - 1 && (
                    <circle r={17} fill="none" stroke="#fff" strokeWidth={2.5} strokeDasharray="20 60" className="origin-center animate-spin" />
                  )}
                </g>
              ))}
            {lasso.length > 0 && (
              <>
                <polyline
                  points={[...lasso, ...(cursor ? [cursor] : [])].map((p) => `${p.x},${p.y}`).join(" ")}
                  fill={lassoMode === "add" ? "rgba(31,138,112,0.18)" : "rgba(220,38,38,0.18)"}
                  stroke="#fff"
                  strokeWidth={2}
                  strokeDasharray="6 4"
                  vectorEffect="non-scaling-stroke"
                />
                {lasso.map((p, i) => (
                  <circle key={i} cx={p.x} cy={p.y} r={(i === 0 ? 7 : 4.5) * ips} fill={i === 0 ? "#1f8a70" : "#fff"} stroke="#000" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                ))}
              </>
            )}
          </svg>
        </div>
      </div>

      {compare && (
        <>
          <div className="pointer-events-none absolute inset-y-0" style={{ left: `calc(${offsetX + view.x}px + ${(comparePos / 100) * box.dw * view.scale}px)` }}>
            <div className="absolute left-0 h-full w-0.5 -translate-x-1/2 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.3)]" />
            <div className="absolute left-0 top-1/2 h-10 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-black/50 shadow-lg" />
          </div>
          <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/60 px-3 py-1 text-xs font-semibold text-white">{t("editor.before")}</span>
          <span className="pointer-events-none absolute right-3 top-3 rounded-full bg-black/60 px-3 py-1 text-xs font-semibold text-white">{t("editor.after")}</span>
          <input
            type="range"
            dir="ltr"
            min={0}
            max={100}
            step={0.5}
            value={comparePos}
            onChange={(e) => props.onComparePos(Number(e.target.value))}
            aria-label={t("editor.compareSlider")}
            data-testid="compare-slider"
            className="absolute cursor-ew-resize opacity-0"
            style={{ left: offsetX + view.x, top: offsetY + view.y, width: box.dw * view.scale, height: box.dh * view.scale, margin: 0 }}
          />
        </>
      )}

      {lasso.length > 0 && (
        <div className="absolute inset-x-0 bottom-3 flex justify-center gap-2 px-3">
          <p className="sr-only" role="status">{t("editor.lassoHint")}</p>
          <button type="button" onClick={() => setLasso([])} className="min-h-11 rounded-full bg-white px-4 text-sm font-semibold shadow">
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={closeLasso}
            disabled={lasso.length < 3}
            className="min-h-11 rounded-full bg-brand-600 px-5 text-sm font-semibold text-white shadow disabled:opacity-50"
          >
            {t("common.done")}
          </button>
        </div>
      )}

      {props.topChip && !compare && <div className="pointer-events-none absolute start-3 top-3 max-w-[75%]">{props.topChip}</div>}

      {props.bottomBar && lasso.length === 0 && !compare && (
        <div className="absolute inset-x-0 bottom-3 flex justify-center pe-16 ps-3">{props.bottomBar}</div>
      )}

      <div className="absolute bottom-3 end-3 flex flex-col gap-1.5" style={{ display: lasso.length > 0 ? "none" : undefined }}>
        <ZoomButton label={t("editor.zoomIn")} onClick={() => zoomCenter(1.4)}>
          <PlusIcon />
        </ZoomButton>
        <ZoomButton label={t("editor.zoomOut")} onClick={() => zoomCenter(1 / 1.4)}>
          <MinusIcon />
        </ZoomButton>
        <ZoomButton label={t("editor.zoomReset")} onClick={() => setView({ scale: 1, x: 0, y: 0 })}>
          <FitIcon />
        </ZoomButton>
      </div>
    </div>
  );
}

function ZoomButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex h-11 w-11 items-center justify-center rounded-full bg-white/95 text-ink shadow-md hover:bg-white"
    >
      {children}
    </button>
  );
}
