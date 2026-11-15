"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import { hexToLab } from "@/lib/color/lab";
import { EditorDocument } from "@/lib/editor/document";
import { ImageLoadError, loadImageFile, loadImageUrl, type LoadedImage } from "@/lib/image/load";
import type { BrushMode, Rect } from "@/lib/mask/ops";
import type { Finish } from "@/lib/recolor/model";
import { Stage, type StageHandle } from "./Stage";
import { Toolbar } from "./Toolbar";
import { SurfacesPanel } from "./SurfacesPanel";
import { ColorPanel } from "./ColorPanel";
import { UploadPanel } from "./UploadPanel";
import { DownloadIcon, ImageIcon } from "./icons";
import type { Surface, Tool } from "./types";

const DEFAULT_COLORS = ["#8E9F88", "#D6C7AE", "#7C97AE", "#C97B5A", "#ECE6DA", "#5E7262"];

let idCounter = 0;
const newId = () => `s${Date.now().toString(36)}${(idCounter++).toString(36)}`;

export function Editor() {
  const { t, formatNumber } = useI18n();
  const stageRef = useRef<StageHandle>(null);

  const [image, setImage] = useState<LoadedImage | null>(null);
  const [doc, setDoc] = useState<EditorDocument | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [surfaces, setSurfaces] = useState<Surface[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>("brush");
  const [brushSize, setBrushSize] = useState(48);
  const [hardness, setHardness] = useState(0.8);
  const [lassoMode, setLassoMode] = useState<BrushMode>("add");
  const [showMask, setShowMask] = useState(false);
  const [compare, setCompare] = useState(false);
  const [comparePos, setComparePos] = useState(50);
  const [, setHistoryTick] = useState(0);
  const [renderMs, setRenderMs] = useState<number | null>(null);

  const surfacesRef = useRef(surfaces);
  surfacesRef.current = surfaces;
  const surfaceCount = useRef(0);

  const makeSurface = useCallback(
    (d: EditorDocument): Surface => {
      const n = ++surfaceCount.current;
      const id = newId();
      d.createMask(id);
      const hex = DEFAULT_COLORS[(n - 1) % DEFAULT_COLORS.length] ?? "#8E9F88";
      return {
        id,
        name: t("surfaces.defaultName", { n }),
        hex,
        lab: hexToLab(hex),
        finish: "matte",
        brightness: 1,
        feather: 1,
        visible: true,
        stats: null,
        coverage: 0,
      };
    },
    [t],
  );

  /* ---------- loading ---------- */

  const openImage = useCallback(
    async (load: () => Promise<LoadedImage>) => {
      setBusy(true);
      setError(null);
      try {
        const img = await load();
        const d = new EditorDocument(img.width, img.height, img.pixels);
        surfaceCount.current = 0;
        const first = makeSurface(d);
        setDoc(d);
        setImage(img);
        setSurfaces([first]);
        setSelectedId(first.id);
        setTool("brush");
        setCompare(false);
        setHistoryTick((n) => n + 1);
      } catch (e) {
        const code = e instanceof ImageLoadError ? e.code : "decode";
        setError(t(code === "unsupported" ? "upload.errorUnsupported" : code === "tooSmall" ? "upload.errorTooSmall" : "upload.errorDecode"));
      } finally {
        setBusy(false);
      }
    },
    [makeSurface, t],
  );

  /* ---------- surface updates ---------- */

  const patchSurface = useCallback((id: string, patch: Partial<Surface>) => {
    setSurfaces((list) => list.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }, []);

  const refreshSurface = useCallback(
    (id: string, feather?: number) => {
      if (!doc) return;
      const s = surfacesRef.current.find((x) => x.id === id);
      if (!s) return;
      const f = feather ?? s.feather;
      const { stats, coverage, mask } = doc.refresh(id, f);
      stageRef.current?.uploadMask(id, mask);
      patchSurface(id, { stats, coverage, feather: f });
    },
    [doc, patchSurface],
  );

  const onEditEnd = useCallback(
    (id: string, before: Uint8Array, rect: Rect) => {
      if (!doc) return;
      const after = doc.rawMask(id);
      if (!after) return;
      doc.history.record(id, before, after, doc.width, rect);
      refreshSurface(id);
      setHistoryTick((n) => n + 1);
    },
    [doc, refreshSurface],
  );

  const undo = useCallback(() => {
    const p = doc?.undo();
    if (p) {
      refreshSurface(p.surfaceId);
      setSelectedId(p.surfaceId);
    }
    setHistoryTick((n) => n + 1);
  }, [doc, refreshSurface]);

  const redo = useCallback(() => {
    const p = doc?.redo();
    if (p) {
      refreshSurface(p.surfaceId);
      setSelectedId(p.surfaceId);
    }
    setHistoryTick((n) => n + 1);
  }, [doc, refreshSurface]);

  const addSurface = () => {
    if (!doc) return;
    const s = makeSurface(doc);
    stageRef.current?.uploadMask(s.id, doc.displayMask(s.id)!);
    setSurfaces((l) => [...l, s]);
    setSelectedId(s.id);
    if (tool === "pan") setTool("brush");
  };

  const deleteSurface = (id: string) => {
    if (!doc || surfaces.length <= 1) return;
    doc.deleteMask(id);
    stageRef.current?.removeMask(id);
    const rest = surfaces.filter((s) => s.id !== id);
    setSurfaces(rest);
    if (selectedId === id) setSelectedId(rest[0]?.id ?? null);
    setHistoryTick((n) => n + 1);
  };

  const clearMask = (id: string) => {
    if (!doc) return;
    const m = doc.rawMask(id);
    if (!m) return;
    const before = m.slice();
    m.fill(0);
    onEditEnd(id, before, { x: 0, y: 0, w: doc.width, h: doc.height });
  };

  const download = async () => {
    const blob = await stageRef.current?.exportBlob("image/jpeg", 0.92);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `colorvision-${new Date().toISOString().slice(0, 10)}.jpg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  /* ---------- keyboard shortcuts ---------- */

  useEffect(() => {
    if (!doc) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && k === "y") {
        e.preventDefault();
        redo();
      } else if (!mod && !e.altKey) {
        const map: Record<string, Tool> = { b: "brush", e: "eraser", l: "lasso", h: "pan" };
        const tl = map[k];
        if (tl) setTool(tl);
        else if (k === "[") setBrushSize((s) => Math.max(4, Math.round(s / 1.2)));
        else if (k === "]") setBrushSize((s) => Math.min(160, Math.round(s * 1.2)));
        else if (k === "m") setShowMask((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doc, undo, redo]);

  /* ---------- render ---------- */

  if (!image || !doc) {
    return (
      <UploadPanel
        busy={busy}
        error={error}
        onFile={(f) => openImage(() => loadImageFile(f))}
        onSample={(src) => openImage(() => loadImageUrl(src))}
      />
    );
  }

  const selected = surfaces.find((s) => s.id === selectedId) ?? null;

  return (
    <div className="lg:grid lg:h-[calc(100dvh-3.5rem)] lg:grid-cols-[minmax(0,1fr)_400px]">
      <div className="sticky top-14 z-10 h-[52dvh] bg-canvas sm:h-[60dvh] lg:static lg:h-full">
        <Stage
          ref={stageRef}
          doc={doc}
          image={image}
          surfaces={surfaces}
          selectedId={selectedId}
          tool={tool}
          brushSize={brushSize}
          hardness={hardness}
          lassoMode={lassoMode}
          showMask={showMask}
          compare={compare}
          comparePos={comparePos}
          onComparePos={setComparePos}
          onEditEnd={onEditEnd}
          onRenderTime={setRenderMs}
          onWebglError={() => {
            setImage(null);
            setDoc(null);
            setError(t("upload.errorWebgl"));
          }}
        />
      </div>

      <aside className="flex flex-col gap-6 border-line bg-surface p-4 lg:overflow-y-auto lg:border-s" aria-label={t("editor.title")}>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setImage(null);
              setDoc(null);
              setSurfaces([]);
            }}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-line px-3 text-sm font-medium hover:bg-black/5"
          >
            <ImageIcon width={18} height={18} /> {t("editor.newPhoto")}
          </button>
          <button
            type="button"
            onClick={download}
            data-testid="download"
            className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700"
          >
            <DownloadIcon width={18} height={18} /> {t("editor.download")}
          </button>
          {renderMs !== null && (
            <span className="ms-auto text-xs tabular-nums text-muted" data-testid="render-time">
              {t("editor.renderTime", { ms: formatNumber(renderMs, { maximumFractionDigits: 1 }) })}
            </span>
          )}
        </div>

        <Toolbar
          tool={tool}
          onTool={setTool}
          brushSize={brushSize}
          onBrushSize={setBrushSize}
          hardness={hardness}
          onHardness={setHardness}
          lassoMode={lassoMode}
          onLassoMode={setLassoMode}
          canUndo={doc.history.canUndo}
          canRedo={doc.history.canRedo}
          onUndo={undo}
          onRedo={redo}
          showMask={showMask}
          onShowMask={setShowMask}
          compare={compare}
          onCompare={setCompare}
        />

        {selected && selected.coverage === 0 && (
          <p className="rounded-xl bg-brand-50 p-3 text-sm text-brand-700" role="status">
            {t("editor.emptyMaskHint")}
          </p>
        )}

        <SurfacesPanel
          surfaces={surfaces}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onAdd={addSurface}
          onRename={(id, name) => patchSurface(id, { name })}
          onToggleVisible={(id) => patchSurface(id, { visible: !surfaces.find((s) => s.id === id)?.visible })}
          onDelete={deleteSurface}
        />

        {selected && (
          <ColorPanel
            surface={selected}
            onColor={(hex) => patchSurface(selected.id, { hex, lab: hex ? hexToLab(hex) : null })}
            onFinish={(finish: Finish) => patchSurface(selected.id, { finish })}
            onBrightness={(brightness) => patchSurface(selected.id, { brightness })}
            onFeather={(f) => refreshSurface(selected.id, f)}
            onClearMask={() => clearMask(selected.id)}
          />
        )}
      </aside>
    </div>
  );
}
