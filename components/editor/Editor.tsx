"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import { hexToLab } from "@/lib/color/lab";
import { EditorDocument } from "@/lib/editor/document";
import { ImageLoadError, loadImageFile, loadImageUrl, type LoadedImage } from "@/lib/image/load";
import { diffRect, type BrushMode, type Rect } from "@/lib/mask/ops";
import type { Finish } from "@/lib/recolor/model";
import type { OverlayInput } from "@/lib/recolor/renderer";
import { SegmentationClient, type SegmentationMode, type SegStatus } from "@/lib/segmentation/client";
import type { Point as PromptPoint } from "@/lib/segmentation/postprocess";
import type { CandidatePreview, Hypothesis } from "@/lib/segmentation/protocol";
import { Stage, type StageHandle } from "./Stage";
import { AiStatus } from "./AiStatus";
import { Toolbar } from "./Toolbar";
import { SurfacesPanel } from "./SurfacesPanel";
import { ColorPanel } from "./ColorPanel";
import { UploadPanel } from "./UploadPanel";
import { CheckIcon, DownloadIcon, ImageIcon, MinusIcon, PlusIcon, SparkleIcon, SpinnerIcon } from "./icons";
import type { Surface, Tool } from "./types";

const DEFAULT_COLORS = ["#8E9F88", "#D6C7AE", "#7C97AE", "#C97B5A", "#ECE6DA", "#5E7262"];

/** Distinct tints for detected surfaces (linear 0..1 RGB). */
const PICK_COLORS: [number, number, number][] = [
  [0.9, 0.1, 0.29], [0.24, 0.71, 0.29], [1, 0.88, 0.1], [0, 0.51, 0.78], [0.96, 0.51, 0.19], [0.57, 0.12, 0.71], [0.27, 0.94, 0.94],
  [0.94, 0.2, 0.9], [0.82, 0.96, 0.24], [0.98, 0.75, 0.83], [0, 0.5, 0.5], [0.67, 0.43, 0.16], [0.5, 0, 0], [0, 0, 0.5],
];

let idCounter = 0;
const newId = () => `s${Date.now().toString(36)}${(idCounter++).toString(36)}`;

/** `?sam=server|device` forces a segmentation mode (support / testing). */
function samModeFromUrl(): SegmentationMode {
  if (typeof window === "undefined") return "auto";
  const v = new URLSearchParams(window.location.search).get("sam");
  return v === "server" || v === "device" ? v : "auto";
}

/** A smart-select interaction on one surface: base mask + SAM prompt points. */
type SmartSession = {
  surfaceId: string;
  base: Uint8Array;
  points: PromptPoint[];
  /** "add": the result is added to the base mask; "erase": it is removed from it. */
  polarity: BrushMode;
  hypotheses: Hypothesis[];
  chosen: number | null;
  /** The last result was chosen before surface analysis was available. */
  provisional: boolean;
};

type PickState =
  | { status: "loading" }
  | { status: "ready"; list: CandidatePreview[]; pw: number; ph: number; selected: number[] }
  | { status: "adding"; list: CandidatePreview[]; pw: number; ph: number; selected: number[] };

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

  // AI segmentation
  const segRef = useRef<SegmentationClient | null>(null);
  const [seg, setSeg] = useState<SegStatus>({ phase: "idle" });
  const [segAttempt, setSegAttempt] = useState(0);
  const [smartMode, setSmartMode] = useState<BrushMode>("add");
  const sessionRef = useRef<SmartSession | null>(null);
  const [session, setSession] = useState<{ points: PromptPoint[]; hypotheses: Hypothesis[]; chosen: number | null } | null>(null);
  const [smartBusy, setSmartBusy] = useState(0);
  const pendingDecode = useRef(false);
  const [pick, setPick] = useState<PickState | null>(null);
  const [refining, setRefining] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

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
        feather: 0,
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
        setTool("smart");
        setPick(null);
        sessionRef.current = null;
        setSession(null);
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
      sessionRef.current = null;
      setSession(null);
      const after = doc.rawMask(id);
      if (!after) return;
      doc.history.record(id, before, after, doc.width, rect);
      refreshSurface(id);
      setHistoryTick((n) => n + 1);
    },
    [doc, refreshSurface],
  );

  /* ---------- AI segmentation ---------- */

  useEffect(() => {
    if (!image) return;
    const client = new SegmentationClient(samModeFromUrl());
    segRef.current = client;
    const unsubscribe = client.subscribe(setSeg);
    client.start(image).catch(() => {
      /* status already reflects the error */
    });
    return () => {
      unsubscribe();
      client.dispose();
      if (segRef.current === client) segRef.current = null;
      setSeg({ phase: "idle" });
    };
  }, [image, segAttempt]);

  // Without AI, fall back to the brush.
  useEffect(() => {
    if (seg.phase === "error" && tool === "smart") setTool("brush");
  }, [seg.phase, tool]);

  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 4500);
    return () => clearTimeout(id);
  }, [notice]);

  const endSession = useCallback(() => {
    sessionRef.current = null;
    setSession(null);
    pendingDecode.current = false;
  }, []);

  // A session belongs to one surface and the smart tool.
  useEffect(() => {
    if (sessionRef.current && (sessionRef.current.surfaceId !== selectedId || tool !== "smart")) endSession();
  }, [selectedId, tool, endSession]);

  /** Apply a SAM mask to the session's surface: base ∪ M (add) or base − M (remove). */
  const applySmartMask = useCallback(
    (s: SmartSession, m: Uint8Array) => {
      if (!doc) return;
      const raw = doc.rawMask(s.surfaceId);
      if (!raw) return;
      const before = raw.slice();
      const base = s.base;
      if (s.polarity === "add") for (let i = 0; i < raw.length; i++) raw[i] = Math.max(base[i]!, m[i]!);
      // Removal is generous at the soft edge so no faint outline is left behind.
      else for (let i = 0; i < raw.length; i++) raw[i] = Math.min(base[i]!, Math.max(0, 255 - 2 * m[i]!));
      const rect = diffRect(before, raw, doc.width, doc.height);
      if (rect.w > 0) doc.history.record(s.surfaceId, before, raw, doc.width, rect);
      refreshSurface(s.surfaceId);
      setHistoryTick((n) => n + 1);
    },
    [doc, refreshSurface],
  );

  const runSmartDecode = useCallback(
    async (variant: number | null = null) => {
      const client = segRef.current;
      const s = sessionRef.current;
      if (!client || !s) return;
      if (!client.ready) {
        pendingDecode.current = true;
        setNotice(t("ai.waiting"));
        return;
      }
      pendingDecode.current = false;
      setSmartBusy((n) => n + 1);
      try {
        const res = await client.decode(s.points, variant);
        if (!res || sessionRef.current !== s) return;
        applySmartMask(s, res.mask);
        s.hypotheses = res.hypotheses;
        s.chosen = res.chosen;
        s.provisional = !res.usedSurfaces;
        setSession({ points: [...s.points], hypotheses: res.hypotheses, chosen: res.chosen });
      } catch {
        setNotice(t("ai.tapFailed"));
      } finally {
        setSmartBusy((n) => n - 1);
      }
    },
    [applySmartMask, t],
  );

  // Once surfaces are known, upgrade a selection that was chosen without them
  // (e.g. "whole house" → "the wall you tapped").
  useEffect(() => {
    const client = segRef.current;
    if (!client || seg.phase !== "ready") return;
    return client.onSurfacesReady(() => {
      const s = sessionRef.current;
      if (s && s.provisional && s.points.length === 1) void runSmartDecode();
    });
  }, [seg.phase, runSmartDecode]);

  // Replay a tap made while the AI was still preparing.
  useEffect(() => {
    if (seg.phase === "ready" && pendingDecode.current) void runSmartDecode();
  }, [seg.phase, runSmartDecode]);

  const onSmartTap = useCallback(
    (p: { x: number; y: number }) => {
      if (!doc || !selectedId) return;
      let s = sessionRef.current;
      if (!s || s.surfaceId !== selectedId) {
        const raw = doc.rawMask(selectedId);
        if (!raw) return;
        s = { surfaceId: selectedId, base: raw.slice(), points: [], polarity: smartMode, hypotheses: [], chosen: null, provisional: false };
        sessionRef.current = s;
      }
      s.points.push({ x: p.x, y: p.y, label: smartMode === s.polarity ? 1 : 0 });
      s.chosen = null;
      setSession({ points: [...s.points], hypotheses: s.hypotheses, chosen: null });
      void runSmartDecode();
    },
    [doc, selectedId, smartMode, runSmartDecode],
  );

  const changeVariant = (dir: -1 | 1) => {
    const s = sessionRef.current;
    if (!s || s.chosen === null) return;
    const order = [...s.hypotheses].sort((a, b) => a.area - b.area);
    const pos = order.findIndex((h) => h.index === s.chosen);
    const next = order[pos + dir];
    if (next) void runSmartDecode(next.index);
  };

  /* ---------- automatic surface detection ---------- */

  const clearPickTextures = useCallback((p: PickState | null) => {
    if (p && p.status !== "loading") for (const c of p.list) stageRef.current?.removeMask(`cand:${c.id}`);
  }, []);

  const startDetect = async () => {
    const client = segRef.current;
    if (!client) return;
    endSession();
    setCompare(false);
    setPick({ status: "loading" });
    try {
      const r = await client.candidates();
      for (const c of r.list) stageRef.current?.uploadMask(`cand:${c.id}`, c.preview, r.previewW, r.previewH);
      setPick({ status: "ready", list: r.list, pw: r.previewW, ph: r.previewH, selected: [] });
    } catch {
      setPick(null);
      setNotice(t("ai.tapFailed"));
    }
  };

  const cancelPick = () => {
    clearPickTextures(pick);
    setPick(null);
  };

  const onPickTap = (p: { x: number; y: number }) => {
    if (!pick || pick.status !== "ready" || !image) return;
    const idx = Math.min(pick.ph - 1, Math.floor((p.y / image.height) * pick.ph)) * pick.pw + Math.min(pick.pw - 1, Math.floor((p.x / image.width) * pick.pw));
    const hits = pick.list.filter((c) => (c.preview[idx] ?? 0) > 127);
    if (!hits.length) return;
    const hit = hits.reduce((a, b) => (b.area < a.area ? b : a));
    const selected = pick.selected.includes(hit.id) ? pick.selected.filter((i) => i !== hit.id) : [...pick.selected, hit.id];
    setPick({ ...pick, selected });
  };

  const addDetected = async () => {
    const client = segRef.current;
    if (!client || !doc || !pick || pick.status !== "ready" || pick.selected.length === 0) return;
    setPick({ ...pick, status: "adding" });
    try {
      const masks = await client.materialize(pick.selected);
      const current = surfacesRef.current.find((x) => x.id === selectedId);
      const added: Surface[] = [];
      let firstId: string | null = null;
      masks.forEach((m, i) => {
        const reuse = i === 0 && current && current.coverage === 0 ? current : null;
        const surface = reuse ?? makeSurface(doc);
        const raw = doc.rawMask(surface.id)!;
        const before = raw.slice();
        raw.set(m.mask);
        doc.history.record(surface.id, before, raw, doc.width, { x: 0, y: 0, w: doc.width, h: doc.height });
        const { stats, coverage, mask } = doc.refresh(surface.id, surface.feather);
        stageRef.current?.uploadMask(surface.id, mask);
        if (reuse) patchSurface(reuse.id, { stats, coverage });
        else added.push({ ...surface, stats, coverage });
        firstId ??= surface.id;
      });
      if (added.length) setSurfaces((l) => [...l, ...added]);
      if (firstId) setSelectedId(firstId);
      setHistoryTick((n) => n + 1);
      clearPickTextures(pick);
      setPick(null);
    } catch {
      setPick({ ...pick, status: "ready" });
      setNotice(t("ai.tapFailed"));
    }
  };

  const refineSurface = async (id: string) => {
    const client = segRef.current;
    const raw = doc?.rawMask(id);
    if (!client || !doc || !raw) return;
    endSession();
    setRefining(true);
    try {
      const out = await client.refine(raw);
      const before = raw.slice();
      raw.set(out);
      const rect = diffRect(before, raw, doc.width, doc.height);
      if (rect.w > 0) doc.history.record(id, before, raw, doc.width, rect);
      refreshSurface(id);
      setHistoryTick((n) => n + 1);
    } catch {
      setNotice(t("ai.tapFailed"));
    } finally {
      setRefining(false);
    }
  };

  const undo = useCallback(() => {
    endSession();
    const p = doc?.undo();
    if (p) {
      refreshSurface(p.surfaceId);
      setSelectedId(p.surfaceId);
    }
    setHistoryTick((n) => n + 1);
  }, [doc, refreshSurface, endSession]);

  const redo = useCallback(() => {
    endSession();
    const p = doc?.redo();
    if (p) {
      refreshSurface(p.surfaceId);
      setSelectedId(p.surfaceId);
    }
    setHistoryTick((n) => n + 1);
  }, [doc, refreshSurface, endSession]);

  const addSurface = () => {
    if (!doc) return;
    const s = makeSurface(doc);
    stageRef.current?.uploadMask(s.id, doc.displayMask(s.id)!);
    setSurfaces((l) => [...l, s]);
    setSelectedId(s.id);
    if (tool === "pan") setTool(seg.phase === "error" ? "brush" : "smart");
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
    endSession();
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
        if (k === "escape") {
          endSession();
          return;
        }
        const map: Record<string, Tool> = { s: "smart", b: "brush", e: "eraser", l: "lasso", h: "pan" };
        const tl = map[k];
        if (tl) setTool(tl);
        else if (k === "[") setBrushSize((s) => Math.max(4, Math.round(s / 1.2)));
        else if (k === "]") setBrushSize((s) => Math.min(160, Math.round(s * 1.2)));
        else if (k === "m") setShowMask((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doc, undo, redo, endSession]);

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
  const aiReady = seg.phase === "ready";
  const smartAvailable = seg.phase !== "error";

  const pickOverlays: OverlayInput[] | undefined =
    pick && pick.status !== "loading"
      ? pick.list.map((c, i) => ({
          maskId: `cand:${c.id}`,
          color: PICK_COLORS[i % PICK_COLORS.length]!,
          opacity: pick.selected.includes(c.id) ? 0.62 : 0.22,
        }))
      : undefined;

  const pill = "inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 text-sm font-semibold shadow-md";
  let bottomBar: React.ReactNode = null;
  if (pick?.status === "loading") {
    bottomBar = (
      <div className="flex items-center gap-2">
        <span className={`${pill} bg-black/70 text-white`} role="status">
          <SpinnerIcon width={18} height={18} /> {t("editor.detecting")}
        </span>
        <button type="button" onClick={cancelPick} className={`${pill} bg-white`}>
          {t("common.cancel")}
        </button>
      </div>
    );
  } else if (pick) {
    bottomBar = (
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button type="button" onClick={cancelPick} className={`${pill} bg-white`}>
          {t("common.cancel")}
        </button>
        {pick.list.length === 0 ? (
          <span className={`${pill} bg-black/70 text-white`}>{t("editor.noneDetected")}</span>
        ) : (
          <button
            type="button"
            onClick={addDetected}
            disabled={pick.selected.length === 0 || pick.status === "adding"}
            data-testid="add-detected"
            className={`${pill} bg-brand-600 text-white disabled:opacity-60`}
          >
            {pick.status === "adding" ? <SpinnerIcon width={18} height={18} /> : <CheckIcon width={18} height={18} />}
            {t("editor.addDetected", { n: pick.selected.length })}
          </button>
        )}
      </div>
    );
  } else if (tool === "smart" && session && session.hypotheses.length > 0) {
    const order = [...session.hypotheses].sort((a, b) => a.area - b.area);
    const pos = order.findIndex((h) => h.index === session.chosen);
    bottomBar = (
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => changeVariant(-1)} disabled={pos <= 0 || smartBusy > 0} data-testid="variant-smaller" className={`${pill} bg-white disabled:opacity-50`}>
          <MinusIcon width={18} height={18} /> {t("editor.smaller")}
        </button>
        <button type="button" onClick={() => changeVariant(1)} disabled={pos < 0 || pos >= order.length - 1 || smartBusy > 0} data-testid="variant-larger" className={`${pill} bg-white disabled:opacity-50`}>
          <PlusIcon width={18} height={18} /> {t("editor.larger")}
        </button>
        <button type="button" onClick={endSession} data-testid="smart-done" className={`${pill} bg-brand-600 text-white`}>
          <CheckIcon width={18} height={18} /> {t("editor.finishSelection")}
        </button>
      </div>
    );
  } else if (tool === "smart" && aiReady && !session) {
    bottomBar = (
      <button type="button" onClick={startDetect} data-testid="detect-floating" className={`${pill} bg-white text-brand-700`}>
        <SparkleIcon width={18} height={18} /> {t("editor.detect")}
      </button>
    );
  }

  let topChip: React.ReactNode = null;
  if (notice)
    topChip = (
      <span role="alert" className="inline-flex rounded-full bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-900 shadow">
        {notice}
      </span>
    );
  else if (pick && pick.status !== "loading") topChip = <span className="inline-flex rounded-full bg-black/65 px-3 py-1.5 text-xs font-semibold text-white shadow">{t("editor.detectHint")}</span>;
  else if (seg.phase !== "ready" && seg.phase !== "idle" && smartAvailable) topChip = <AiStatus status={seg} compact />;
  else if (tool === "smart" && aiReady && !session && selected?.coverage === 0) topChip = <AiStatus status={seg} compact />;

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
          overlays={pickOverlays}
          tapMode={!!pick}
          onTap={pick ? onPickTap : onSmartTap}
          markers={tool === "smart" && !pick ? session?.points : undefined}
          busy={smartBusy > 0}
          bottomBar={bottomBar}
          topChip={topChip}
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
          smartMode={smartMode}
          onSmartMode={(m) => {
            setSmartMode(m);
            // Switching mode on an untouched session starts a new one with the new polarity.
            if (sessionRef.current && sessionRef.current.points.length === 0) endSession();
          }}
          smartAvailable={smartAvailable}
        />

        <AiStatus status={seg} onRetry={() => setSegAttempt((n) => n + 1)} />

        {smartAvailable && (
          <button
            type="button"
            onClick={startDetect}
            disabled={!aiReady || !!pick}
            data-testid="detect"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-brand-600 bg-white px-4 text-sm font-semibold text-brand-700 hover:bg-brand-50 disabled:opacity-50"
          >
            {pick?.status === "loading" ? <SpinnerIcon width={18} height={18} /> : <SparkleIcon width={18} height={18} />}
            {pick?.status === "loading" ? t("editor.detecting") : t("editor.detect")}
          </button>
        )}

        {selected && selected.coverage === 0 && tool !== "smart" && (
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
            onRefine={seg.phase === "ready" || seg.phase === "analyzing" ? () => refineSurface(selected.id) : undefined}
            refining={refining}
          />
        )}
      </aside>
    </div>
  );
}
