"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import { hexToLab, rgbToHex, type Lab } from "@/lib/color/lab";
import { getColor, type PaintColor } from "@/lib/color/catalog";
import { dominantColors } from "@/lib/color/palettes";
import { loadSession, saveSessionImage, saveSessionState, type SavedSession } from "@/lib/editor/autosave";
import { EditorDocument } from "@/lib/editor/document";
import { ImageLoadError, loadImageFile, loadImageUrl, type LoadedImage } from "@/lib/image/load";
import { diffRect, type BrushMode, type Rect } from "@/lib/mask/ops";
import type { Finish } from "@/lib/recolor/model";
import { estimateLighting, lightingGains, type LightingEstimate, type LightMode } from "@/lib/recolor/lighting";
import type { OverlayInput } from "@/lib/recolor/renderer";
import { isMobileDevice, SegmentationClient, wallsServer, type SegmentationMode, type SegStatus } from "@/lib/segmentation/client";
import type { Point as PromptPoint } from "@/lib/segmentation/postprocess";
import type { CandidatePreview, Hypothesis } from "@/lib/segmentation/protocol";
import type { SceneKind } from "@/lib/segmentation/scene";
import { Stage, type StageHandle } from "./Stage";
import { AiStatus } from "./AiStatus";
import { Toolbar } from "./Toolbar";
import { SurfacesPanel } from "./SurfacesPanel";
import { ColorPanel } from "./ColorPanel";
import type { PickerTab } from "./ColorPicker";
import { UploadPanel } from "./UploadPanel";
import { LightSwitch } from "./LightSwitch";
import { Advanced, NextButton, StepNav, useAdvanced, type Step } from "./Steps";
import { SharePanel } from "./SharePanel";
import { CompareView } from "./CompareView";
import { QuantityPanel, surfaceQuantities, type QuantitySettings } from "./QuantityPanel";
import { SendPanel } from "./SendPanel";
import { DEFAULT_COATS, DEFAULT_COVERAGE_M2_PER_L, defaultMeasure, type Measure } from "@/lib/paint/quantity";
import { fullResolution, instanceAt, unionMask } from "@/lib/segmentation/sam3";
import { brandSlug } from "@/lib/brand";
import { CheckIcon, DownloadIcon, ImageIcon, MinusIcon, PlusIcon, SparkleIcon, SpinnerIcon } from "./icons";
import type { Surface, Tool } from "./types";

/** Starting paints for new surfaces (real catalogue colours). */
const DEFAULT_PAINTS = ["RAL 6021", "RAL 1015", "RAL 5024", "RAL 3012", "RAL 7044", "RAL 6011"];

/** Distinct tints for detected surfaces (linear 0..1 RGB). */
const PICK_COLORS: [number, number, number][] = [
  [0.9, 0.1, 0.29],
  [0.24, 0.71, 0.29],
  [1, 0.88, 0.1],
  [0, 0.51, 0.78],
  [0.96, 0.51, 0.19],
  [0.57, 0.12, 0.71],
  [0.27, 0.94, 0.94],
  [0.94, 0.2, 0.9],
  [0.82, 0.96, 0.24],
  [0.98, 0.75, 0.83],
  [0, 0.5, 0.5],
  [0.67, 0.43, 0.16],
  [0.5, 0, 0],
  [0, 0, 0.5],
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
  /** Whether other parts of the same wall may be joined (false after "this part only"). */
  merge: boolean;
  /** Union of the other surfaces' masks: a smart selection does not take walls that already have their own colour. */
  others: Uint8Array | null;
};

type PickState =
  | { status: "loading" }
  | {
      status: "ready";
      list: CandidatePreview[];
      pw: number;
      ph: number;
      selected: number[];
    }
  | {
      status: "adding";
      list: CandidatePreview[];
      pw: number;
      ph: number;
      selected: number[];
    };

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
  const [historyTick, setHistoryTick] = useState(0);
  const [renderMs, setRenderMs] = useState<number | null>(null);
  const [step, setStep] = useState<Step>("walls");
  const [advanced, setAdvanced] = useAdvanced();
  /** Where to show the "tap the wall" hint (image coordinates); null once the user has tapped. */
  const [hint, setHint] = useState<{ x: number; y: number } | null>(null);
  const hintDone = useRef(false);
  const [measures, setMeasures] = useState<Record<string, Measure>>({});
  const [qtySettings, setQtySettings] = useState<QuantitySettings>({ coats: DEFAULT_COATS, coverage: DEFAULT_COVERAGE_M2_PER_L });
  const [compareList, setCompareList] = useState<PaintColor[]>([]);
  const [compareView, setCompareView] = useState<{ paint: PaintColor; url: string }[] | null>(null);
  const [comparing, setComparing] = useState(false);
  const [lightEst, setLightEst] = useState<LightingEstimate | null>(null);
  const [lightMode, setLightMode] = useState<LightMode>("photo");
  const lighting = useMemo(() => (lightEst ? lightingGains(lightEst, lightMode) : undefined), [lightEst, lightMode]);

  // AI segmentation
  const segRef = useRef<SegmentationClient | null>(null);
  const [seg, setSeg] = useState<SegStatus>({ phase: "idle" });
  const [segAttempt, setSegAttempt] = useState(0);
  const [smartMode, setSmartMode] = useState<BrushMode>("add");
  const sessionRef = useRef<SmartSession | null>(null);
  const [session, setSession] = useState<{
    points: PromptPoint[];
    hypotheses: Hypothesis[];
    chosen: number | null;
    merged?: number;
  } | null>(null);
  const [smartBusy, setSmartBusy] = useState(0);
  const pendingDecode = useRef(false);
  const [pick, setPick] = useState<PickState | null>(null);
  const [refining, setRefining] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Colour picker
  const [pickerTab, setPickerTab] = useState<PickerTab>("catalog");
  const [picked, setPicked] = useState<string | null>(null);
  const [eyedropper, setEyedropper] = useState(false);

  const surfacesRef = useRef(surfaces);
  surfacesRef.current = surfaces;
  const surfaceCount = useRef(0);

  const makeSurface = useCallback(
    (d: EditorDocument): Surface => {
      const n = ++surfaceCount.current;
      const id = newId();
      d.createMask(id);
      const paint = getColor(`ral-classic:${DEFAULT_PAINTS[(n - 1) % DEFAULT_PAINTS.length]}`)!;
      return {
        id,
        name: t("surfaces.defaultName", { n }),
        hex: paint.hex,
        paintId: paint.id,
        lab: paint.lab,
        finish: "matte",
        brightness: 1,
        feather: 0,
        visible: true,
        cleanup: true,
        stats: null,
        coverage: 0,
      };
    },
    [t],
  );

  /* ---------- loading ---------- */

  /** Resolves once the current photo is stored for autosave (state is written after it). */
  const imageSaved = useRef<Promise<void>>(Promise.resolve());

  const openImage = useCallback(
    async (load: () => Promise<LoadedImage>, restore: SavedSession | null = null) => {
      setBusy(true);
      setError(null);
      try {
        const img = await load();
        const d = new EditorDocument(img.width, img.height, img.pixels, isMobileDevice() ? 20 * 1024 * 1024 : 48 * 1024 * 1024);
        surfaceCount.current = 0;
        let list: Surface[];
        let selected: string;
        if (restore && restore.width === img.width && restore.height === img.height && restore.surfaces.length) {
          // Continue a saved session: surfaces, colours and masks.
          list = restore.surfaces.map((s) => {
            d.createMask(s.id).set(s.mask);
            const { stats, coverage } = d.refresh(s.id, s.feather);
            const paint = s.paintId ? getColor(s.paintId) : undefined;
            return {
              id: s.id,
              name: s.name,
              hex: s.hex,
              paintId: s.paintId,
              lab: paint?.lab ?? (s.hex ? hexToLab(s.hex) : null),
              finish: s.finish,
              brightness: s.brightness,
              feather: s.feather,
              visible: s.visible,
              cleanup: s.cleanup ?? true,
              stats,
              coverage,
            };
          });
          surfaceCount.current = list.length;
          selected = list.some((s) => s.id === restore.selectedId) ? restore.selectedId! : list[0]!.id;
          imageSaved.current = Promise.resolve();
        } else {
          const first = makeSurface(d);
          list = [first];
          selected = first.id;
          // Keep the photo on the device so the work survives a reload.
          imageSaved.current = new Promise<Blob | null>((r) => img.canvas.toBlob(r, "image/jpeg", 0.9))
            .then((b) => (b ? saveSessionImage(b) : undefined))
            .catch(() => undefined);
        }
        setMeasures(restore ? Object.fromEntries(restore.surfaces.filter((x) => x.measure).map((x) => [x.id, x.measure!])) : {});
        setQtySettings({ coats: restore?.coats ?? DEFAULT_COATS, coverage: restore?.coverage ?? DEFAULT_COVERAGE_M2_PER_L });
        setLightEst(estimateLighting(img.pixels, img.width, img.height));
        setLightMode(restore?.light ?? "photo");
        setDoc(d);
        setImage(img);
        setSurfaces(list);
        setSelectedId(selected);
        // "Back" (button or edge swipe) returns to the upload screen instead of leaving the editor.
        if (!window.history.state?.cvPhoto) window.history.pushState({ ...window.history.state, cvPhoto: true }, "");
        setTool("smart");
        // A continued session with painted walls opens on the colour step.
        setStep(list.some((x) => x.coverage > 0) ? "colors" : "walls");
        setHint(null);
        hintDone.current = false;
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

  /* ---------- autosave & navigation ---------- */

  const closePhoto = useCallback(() => {
    setImage(null);
    setDoc(null);
    setSurfaces([]);
    setPick(null);
    setEyedropper(false);
  }, []);

  useEffect(() => {
    const onPop = () => {
      if (!window.history.state?.cvPhoto) closePhoto();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [closePhoto]);

  // Save the session shortly after every change.
  useEffect(() => {
    if (!doc || !image) return;
    const timer = setTimeout(() => {
      const state: SavedSession = {
        savedAt: Date.now(),
        width: doc.width,
        height: doc.height,
        selectedId,
        light: lightMode,
        coats: qtySettings.coats,
        coverage: qtySettings.coverage,
        surfaces: surfacesRef.current
          .map((s) => ({ s, mask: doc.rawMask(s.id) }))
          .filter((x): x is { s: Surface; mask: Uint8Array } => !!x.mask)
          .map(({ s, mask }) => ({
            id: s.id,
            name: s.name,
            hex: s.hex,
            paintId: s.paintId,
            finish: s.finish,
            brightness: s.brightness,
            feather: s.feather,
            visible: s.visible,
            cleanup: s.cleanup,
            measure: measures[s.id],
            mask,
          })),
      };
      void imageSaved.current.then(() => saveSessionState(state)).catch(() => undefined);
    }, 1200);
    return () => clearTimeout(timer);
  }, [doc, image, surfaces, selectedId, historyTick, lightMode, measures, qtySettings]);

  // Offer to continue the last session on the upload screen.
  const [resume, setResume] = useState<{
    url: string;
    savedAt: number;
    image: Blob;
    state: SavedSession | null;
  } | null>(null);
  useEffect(() => {
    if (image) return;
    let url: string | null = null;
    let cancelled = false;
    void loadSession().then((s) => {
      if (cancelled || !s) return;
      url = URL.createObjectURL(s.image);
      setResume({ url, savedAt: s.savedAt, image: s.image, state: s.state });
    });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
      setResume(null);
    };
  }, [image]);

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

  /* ---------- colours ---------- */

  const pickPaint = (paint: PaintColor) => {
    if (!selectedId) return;
    patchSurface(selectedId, {
      hex: paint.hex,
      lab: paint.lab,
      paintId: paint.id,
    });
  };

  const pickCustom = (hex: string) => {
    if (!selectedId) return;
    patchSurface(selectedId, { hex, lab: hexToLab(hex), paintId: null });
  };

  /** Assign palette colours to the surfaces in order (painted surfaces first). */
  const applyPalette = (paints: PaintColor[]) => {
    if (!paints.length) return;
    const order = [...surfacesRef.current].sort((a, b) => Number(b.coverage > 0) - Number(a.coverage > 0));
    const byId = new Map(order.map((s, i) => [s.id, paints[i % paints.length]!]));
    setSurfaces((list) =>
      list.map((s) => {
        const p = byId.get(s.id);
        return p ? { ...s, hex: p.hex, lab: p.lab, paintId: p.id } : s;
      }),
    );
  };

  /** Average colour of the original photo around a point (5×5). */
  const sampleColor = (x: number, y: number): string | null => {
    if (!image) return null;
    let r = 0,
      g = 0,
      b = 0,
      n = 0;
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const px = Math.round(x) + dx;
        const py = Math.round(y) + dy;
        if (px < 0 || py < 0 || px >= image.width || py >= image.height) continue;
        const i = (py * image.width + px) * 4;
        r += image.pixels[i]!;
        g += image.pixels[i + 1]!;
        b += image.pixels[i + 2]!;
        n++;
      }
    return n ? rgbToHex({ r: r / n, g: g / n, b: b / n }) : null;
  };

  const onEyedrop = (p: { x: number; y: number }) => {
    const hex = sampleColor(p.x, p.y);
    setEyedropper(false);
    if (!hex) return;
    setPicked(hex);
    setPickerTab("match");
  };

  /** Dominant colours of the photo outside the surfaces being painted (furniture, floor…). */
  const photoColors = useCallback((): Lab[] => {
    if (!image || !doc) return [];
    const masks = surfacesRef.current.map((s) => doc.rawMask(s.id)).filter((m): m is Uint8Array => !!m && m.some((v) => v > 0));
    return dominantColors(image.pixels, image.width, image.height, 5, (i) => masks.some((m) => m[i]! > 127)).map((c) => c.lab);
    // Recompute when surfaces (and thus masks) change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image, doc, surfaces]);

  /* ---------- AI segmentation ---------- */

  // Wake the walls server early (a free server sleeps when unused) while the customer picks a photo.
  useEffect(() => {
    void wallsServer();
  }, []);

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
      const others = s.others;
      if (s.polarity === "add" && others) for (let i = 0; i < raw.length; i++) raw[i] = Math.max(base[i]!, Math.min(m[i]!, 255 - others[i]!));
      else if (s.polarity === "add") for (let i = 0; i < raw.length; i++) raw[i] = Math.max(base[i]!, m[i]!);
      // Removal is generous at the soft edge so no faint outline is left behind.
      else for (let i = 0; i < raw.length; i++) raw[i] = Math.min(base[i]!, Math.max(0, 255 - 2 * m[i]!));
      const rect = diffRect(before, raw, doc.width, doc.height);
      if (rect.w > 0) doc.history.record(s.surfaceId, before, raw, doc.width, rect);
      refreshSurface(s.surfaceId);
      setHistoryTick((n) => n + 1);
    },
    [doc, refreshSurface],
  );

  /** Give a surface a meaningful name ("Wall", "Ceiling"…) if it still has its default name. */
  const nameSurface = (id: string, kind: SceneKind) => {
    if (kind === "other") return;
    setSurfaces((list) => {
      const target = list.find((x) => x.id === id);
      if (!target || !/\d+$/.test(target.name) || !isDefaultName(target.name)) return list;
      const base = t(`kinds.${kind}`);
      const taken = new Set(list.filter((x) => x.id !== id).map((x) => x.name));
      let name = base;
      for (let n = 2; taken.has(name); n++) name = `${base} ${n}`;
      return list.map((x) => (x.id === id ? { ...x, name } : x));
    });
  };

  const isDefaultName = (name: string) => {
    const m = /(\d+)$/.exec(name);
    return !!m && name === t("surfaces.defaultName", { n: Number(m[1]) });
  };

  const [autoBusy, setAutoBusy] = useState(false);

  /** "Paint all walls": one surface for all walls (and one for the ceiling). */
  const paintAllWalls = async () => {
    const client = segRef.current;
    if (!client || !doc) return;
    endSession();
    setCompare(false);
    hintDone.current = true;
    setHint(null);
    setAutoBusy(true);
    try {
      let found: { kind: "wall" | "ceiling"; mask: Uint8Array }[] = [];
      // Most precise: SAM 3 on the server ("wall" / "ceiling"), when available.
      const sam = await client.sam3Surfaces();
      if (sam && image && sam.some((m) => m.kind === "wall")) {
        for (const kind of ["wall", "ceiling"] as const) {
          const u = unionMask(sam.filter((m) => m.kind === kind));
          if (u) found.push({ kind, mask: fullResolution(u, image.pixels, image.width, image.height) });
        }
      } else {
        await client.waitForUnderstanding(20_000);
        // The scene server may have been starting up: ask once more before giving up.
        if (!client.sceneReady) await client.retryScene(45_000);
        found = await client.autoSurfaces();
      }
      if (!found.length) {
        setNotice(t("ai.noWallsFound"));
        return;
      }
      const empties = surfacesRef.current.filter((x) => x.coverage === 0);
      const added: Surface[] = [];
      let firstId: string | null = null;
      for (const f of found) {
        const reuse = empties.shift();
        const surface = reuse ?? makeSurface(doc);
        const raw = doc.rawMask(surface.id)!;
        const before = raw.slice();
        raw.set(f.mask);
        doc.history.record(surface.id, before, raw, doc.width, {
          x: 0,
          y: 0,
          w: doc.width,
          h: doc.height,
        });
        const { stats, coverage, mask } = doc.refresh(surface.id, surface.feather);
        stageRef.current?.uploadMask(surface.id, mask);
        const name = t(f.kind === "wall" ? "kinds.walls" : "kinds.ceiling");
        const paint = f.kind === "ceiling" ? getColor("ral-classic:RAL 9010") : undefined;
        const patch: Partial<Surface> = {
          stats,
          coverage,
          name,
          ...(paint ? { hex: paint.hex, lab: paint.lab, paintId: paint.id } : {}),
        };
        if (reuse) patchSurface(reuse.id, patch);
        else added.push({ ...surface, ...patch });
        if (f.kind === "wall") firstId ??= surface.id;
      }
      if (added.length) setSurfaces((l) => [...l, ...added]);
      if (firstId) setSelectedId(firstId);
      setHistoryTick((n) => n + 1);
    } catch {
      setNotice(t("ai.tapFailed"));
    } finally {
      setAutoBusy(false);
    }
  };

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
        // A first tap right after the photo is analysed waits (spinner) for the
        // surface analysis, so it selects the whole wall instead of a fragment.
        if (variant === null && s.points.length === 1) await client.waitForUnderstanding(15_000);
        if (sessionRef.current !== s) return;
        const res = await client.decode(s.points, variant, s.merge);
        if (!res || sessionRef.current !== s) return;
        applySmartMask(s, res.mask);
        s.hypotheses = res.hypotheses;
        s.chosen = res.chosen;
        s.provisional = !res.usedSurfaces;
        setSession({
          points: [...s.points],
          hypotheses: res.hypotheses,
          chosen: res.chosen,
          merged: res.merged,
        });
        if (res.kind && s.points.length === 1 && s.polarity === "add") {
          nameSurface(s.surfaceId, res.kind);
          if (res.kind === "furniture" || res.kind === "window" || res.kind === "outdoor" || res.kind === "floor")
            setNotice(t("ai.notWall", { what: t(`kinds.${res.kind}`) }));
        }
      } catch {
        setNotice(t("ai.tapFailed"));
      } finally {
        setSmartBusy((n) => n - 1);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [applySmartMask, t],
  );

  /** Only the tapped part, without joining other parts of the same wall. */
  const onlyThisPart = () => {
    const s = sessionRef.current;
    if (!s) return;
    s.merge = false;
    void runSmartDecode();
  };

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

  /** The visible surface under a point (topmost), if any. */
  const surfaceAt = useCallback(
    (p: { x: number; y: number }): string | null => {
      if (!doc) return null;
      const x = Math.min(doc.width - 1, Math.max(0, Math.floor(p.x)));
      const y = Math.min(doc.height - 1, Math.max(0, Math.floor(p.y)));
      const list = surfacesRef.current;
      for (let i = list.length - 1; i >= 0; i--) {
        const s = list[i]!;
        if (!s.visible || s.coverage === 0) continue;
        if ((doc.displayMask(s.id)?.[y * doc.width + x] ?? 0) > 127) return s.id;
      }
      return null;
    },
    [doc],
  );

  const onSmartTap = useCallback(
    (p: { x: number; y: number }) => {
      if (!doc || !selectedId) return;
      hintDone.current = true;
      setHint(null);
      let s = sessionRef.current;
      let surfaceId = selectedId;
      if (!s && smartMode === "add") {
        // Easy mode: tapping a wall that is already painted selects it; tapping a
        // new wall makes a new surface, so every wall can get its own colour.
        const hit = surfaceAt(p);
        if (hit) {
          setSelectedId(hit);
          return;
        }
        const current = surfacesRef.current.find((x) => x.id === selectedId);
        if (current && current.coverage > 0) {
          const fresh = makeSurface(doc);
          stageRef.current?.uploadMask(fresh.id, doc.displayMask(fresh.id)!);
          setSurfaces((l) => [...l, fresh]);
          setSelectedId(fresh.id);
          surfaceId = fresh.id;
        }
      }
      // SAM 3 knows this wall precisely: use its outline directly (and start it on the first tap).
      segRef.current?.ensureSam3();
      const sam = segRef.current?.sam3Ready;
      const inst = !s && smartMode === "add" && sam && image ? instanceAt(sam, p.x, p.y, image.width, image.height) : null;
      if (inst && image) {
        const raw = doc.rawMask(surfaceId);
        if (!raw) return;
        const before = raw.slice();
        const full = fullResolution(inst, image.pixels, image.width, image.height);
        // Never take a wall that already has its own colour.
        const others = surfacesRef.current.filter((o) => o.id !== surfaceId && o.coverage > 0).map((o) => doc.rawMask(o.id)).filter((m): m is Uint8Array => !!m);
        for (let i = 0; i < raw.length; i++) {
          let v = full[i]!;
          for (const o of others) if (o[i]! > 127) v = Math.min(v, 255 - o[i]!);
          if (v > raw[i]!) raw[i] = v;
        }
        doc.history.record(surfaceId, before, raw, doc.width, { x: 0, y: 0, w: doc.width, h: doc.height });
        // The surface may have been created just now (not yet in state): refresh it directly.
        const { stats, coverage, mask } = doc.refresh(surfaceId, surfacesRef.current.find((o) => o.id === surfaceId)?.feather ?? 0);
        stageRef.current?.uploadMask(surfaceId, mask);
        patchSurface(surfaceId, { stats, coverage });
        nameSurface(surfaceId, inst.kind);
        setHistoryTick((n) => n + 1);
        return;
      }
      if (!s || s.surfaceId !== surfaceId) {
        const raw = doc.rawMask(surfaceId);
        if (!raw) return;
        let others: Uint8Array | null = null;
        for (const o of surfacesRef.current) {
          const om = o.id !== surfaceId && o.coverage > 0 ? doc.rawMask(o.id) : undefined;
          if (!om) continue;
          others ??= new Uint8Array(raw.length);
          for (let i = 0; i < om.length; i++) if (om[i]! > others[i]!) others[i] = om[i]!;
        }
        s = {
          surfaceId,
          base: raw.slice(),
          points: [],
          polarity: smartMode,
          hypotheses: [],
          chosen: null,
          provisional: false,
          merge: true,
          others,
        };
        sessionRef.current = s;
      }
      s.points.push({
        x: p.x,
        y: p.y,
        label: smartMode === s.polarity ? 1 : 0,
      });
      s.chosen = null;
      setSession({
        points: [...s.points],
        hypotheses: s.hypotheses,
        chosen: null,
      });
      void runSmartDecode();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nameSurface only reads the latest list via setSurfaces
    [doc, image, selectedId, smartMode, runSmartDecode, surfaceAt, makeSurface, patchSurface],
  );

  /** In the colour and share steps a tap chooses the wall to colour. */
  const onSurfaceTap = (p: { x: number; y: number }) => {
    const hit = surfaceAt(p);
    if (hit) setSelectedId(hit);
    else setNotice(t("steps.noSurfaceHere"));
  };

  // Show where to tap once the AI knows where the walls are.
  useEffect(() => {
    const client = segRef.current;
    if (seg.phase !== "ready" || !client || !image) return;
    let cancelled = false;
    void client.wallHint(10_000).then((h) => {
      if (cancelled || hintDone.current) return;
      setHint(h ? { x: h.fx * image.width, y: h.fy * image.height } : { x: image.width / 2, y: image.height / 2 });
    });
    return () => {
      cancelled = true;
    };
  }, [seg.phase, image]);

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
      setPick({
        status: "ready",
        list: r.list,
        pw: r.previewW,
        ph: r.previewH,
        selected: [],
      });
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
        doc.history.record(surface.id, before, raw, doc.width, {
          x: 0,
          y: 0,
          w: doc.width,
          h: doc.height,
        });
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
    a.download = `${brandSlug()}-${new Date().toISOString().slice(0, 10)}.jpg`;
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
        const map: Record<string, Tool> = {
          s: "smart",
          b: "brush",
          e: "eraser",
          l: "lasso",
          h: "pan",
        };
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

  const openCompare = () => {
    const stage = stageRef.current;
    if (!stage || !selectedId || compareList.length < 2) return;
    setComparing(true);
    // Let the button show its busy state before the (synchronous) renders.
    requestAnimationFrame(() => {
      const urls = stage.renderVariants(
        selectedId,
        compareList.map((c) => c.lab),
      );
      setCompareView(compareList.map((paint, i) => ({ paint, url: urls[i] ?? "" })));
      setComparing(false);
    });
  };

  const goStep = (next: Step) => {
    endSession();
    if (pick) cancelPick();
    setEyedropper(false);
    setStep(next);
  };

  /* ---------- render ---------- */

  if (!image || !doc) {
    return (
      <UploadPanel
        busy={busy}
        error={error}
        resume={
          resume
            ? {
                thumbUrl: resume.url,
                savedAt: resume.savedAt,
                onResume: () => {
                  const r = resume;
                  void openImage(() => loadImageFile(r.image), r.state);
                },
              }
            : null
        }
        onFile={(f) => openImage(() => loadImageFile(f))}
        onSample={(src) => openImage(() => loadImageUrl(src))}
      />
    );
  }

  const selected = surfaces.find((s) => s.id === selectedId) ?? null;
  const aiReady = seg.phase === "ready";
  const smartAvailable = seg.phase !== "error";
  const anyPainted = surfaces.some((s) => s.coverage > 0);
  // Every painted surface has a measure; the default kind follows its name (all walls → room, ceiling → ceiling).
  const measuresFor: Record<string, Measure> = Object.fromEntries(
    surfaces.map((s) => [s.id, measures[s.id] ?? defaultMeasure(s.name === t("kinds.walls") ? "room" : s.name === t("kinds.ceiling") ? "ceiling" : "wall")]),
  );
  const showHint = !!hint && step === "walls" && tool === "smart" && aiReady && !session && !pick && !autoBusy && !anyPainted;

  const toolbarProps = {
    tool,
    onTool: setTool,
    brushSize,
    onBrushSize: setBrushSize,
    hardness,
    onHardness: setHardness,
    lassoMode,
    onLassoMode: setLassoMode,
    canUndo: doc.history.canUndo,
    canRedo: doc.history.canRedo,
    onUndo: undo,
    onRedo: redo,
    showMask,
    onShowMask: setShowMask,
    compare,
    onCompare: setCompare,
    smartMode,
    onSmartMode: (m: BrushMode) => {
      setSmartMode(m);
      // Switching mode on an untouched session starts a new one with the new polarity.
      if (sessionRef.current && sessionRef.current.points.length === 0) endSession();
    },
    smartAvailable,
  };

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
  } else if (tool === "smart" && session && session.hypotheses.length > 0 && (session.merged ?? 0) > 0) {
    bottomBar = (
      <div className="flex flex-wrap items-center justify-center gap-2">
        <span className={`${pill} bg-black/70 text-white`}>{t("ai.joined", { n: session.merged ?? 0 })}</span>
        <button type="button" onClick={onlyThisPart} data-testid="only-this-part" className={`${pill} bg-white`}>
          {t("ai.onlyThisPart")}
        </button>
        <button type="button" onClick={endSession} data-testid="smart-done" className={`${pill} bg-brand-600 text-white`}>
          <CheckIcon width={18} height={18} /> {t("editor.finishSelection")}
        </button>
      </div>
    );
  } else if (tool === "smart" && session && session.hypotheses.length > 0) {
    const order = [...session.hypotheses].sort((a, b) => a.area - b.area);
    const pos = order.findIndex((h) => h.index === session.chosen);
    bottomBar = (
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => changeVariant(-1)}
          disabled={pos <= 0 || smartBusy > 0}
          data-testid="variant-smaller"
          className={`${pill} bg-white disabled:opacity-50`}
        >
          <MinusIcon width={18} height={18} /> {t("editor.smaller")}
        </button>
        <button
          type="button"
          onClick={() => changeVariant(1)}
          disabled={pos < 0 || pos >= order.length - 1 || smartBusy > 0}
          data-testid="variant-larger"
          className={`${pill} bg-white disabled:opacity-50`}
        >
          <PlusIcon width={18} height={18} /> {t("editor.larger")}
        </button>
        <button type="button" onClick={endSession} data-testid="smart-done" className={`${pill} bg-brand-600 text-white`}>
          <CheckIcon width={18} height={18} /> {t("editor.finishSelection")}
        </button>
      </div>
    );
  } else if (step === "walls" && tool === "smart" && aiReady && !session && !autoBusy && anyPainted) {
    bottomBar = (
      <button type="button" onClick={() => goStep("colors")} data-testid="next-colors-floating" className={`${pill} bg-brand-600 text-white`}>
        {t("steps.nextColors")}
        <span aria-hidden className="rtl:-scale-x-100">
          →
        </span>
      </button>
    );
  } else if (step === "walls" && tool === "smart" && aiReady && !session && !autoBusy) {
    bottomBar = (
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button type="button" onClick={paintAllWalls} data-testid="paint-all-walls-floating" className={`${pill} bg-brand-600 text-white`}>
          <SparkleIcon width={18} height={18} /> {t("ai.paintAllWalls")}
        </button>
        <button type="button" onClick={startDetect} data-testid="detect-floating" className={`${pill} bg-white text-brand-700`}>
          {t("editor.detect")}
        </button>
      </div>
    );
  } else if (autoBusy) {
    bottomBar = (
      <span className={`${pill} bg-black/70 text-white`} role="status">
        <SpinnerIcon width={18} height={18} /> {t("ai.findingWalls")}
      </span>
    );
  }

  let topChip: React.ReactNode = null;
  if (eyedropper)
    topChip = <span className="inline-flex rounded-full bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white shadow">{t("color.eyedropperHint")}</span>;
  else if (notice)
    topChip = (
      <span role="alert" className="inline-flex rounded-full bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-900 shadow">
        {notice}
      </span>
    );
  else if (pick && pick.status !== "loading")
    topChip = <span className="inline-flex rounded-full bg-black/65 px-3 py-1.5 text-xs font-semibold text-white shadow">{t("editor.detectHint")}</span>;
  else if (seg.phase !== "ready" && seg.phase !== "idle" && smartAvailable) topChip = <AiStatus status={seg} compact />;
  else if (step === "walls" && tool === "smart" && aiReady && !session && selected?.coverage === 0 && !showHint) topChip = <AiStatus status={seg} compact />;

  return (
    <div className="lg:grid lg:h-[calc(100dvh-3.5rem)] lg:grid-cols-[minmax(0,1fr)_400px] land:grid land:h-[calc(100dvh-3.5rem)] land:grid-cols-[minmax(0,1fr)_minmax(280px,42%)]">
      <div className="sticky top-14 z-10 h-[52dvh] bg-canvas sm:h-[60dvh] lg:static lg:h-full land:static land:h-full">
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
          lighting={lighting}
          overlays={pickOverlays}
          tapMode={!!pick || eyedropper || step !== "walls"}
          onTap={eyedropper ? onEyedrop : pick ? onPickTap : step !== "walls" ? onSurfaceTap : onSmartTap}
          markers={tool === "smart" && !pick && step === "walls" ? session?.points : undefined}
          hint={showHint && hint ? { ...hint, label: t("steps.tapHint") } : null}
          busy={smartBusy > 0}
          bottomBar={bottomBar}
          topChip={topChip}
        />
      </div>

      <aside className="flex flex-col gap-5 border-line bg-surface p-4 text-base lg:overflow-y-auto lg:border-s land:overflow-y-auto land:border-s" aria-label={t("editor.title")}>
        <StepNav step={step} onStep={goStep} done={{ walls: anyPainted, colors: anyPainted && step === "share" }} />

        {step === "walls" && (
          <>
            <p className="text-base font-medium">{t("steps.wallsHint")}</p>
            <AiStatus status={seg} onRetry={() => setSegAttempt((n) => n + 1)} />
            {smartAvailable && (
              <button
                type="button"
                onClick={paintAllWalls}
                disabled={!aiReady || autoBusy || !!pick}
                data-testid="paint-all-walls"
                className="inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-brand-600 px-4 text-lg font-bold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50"
              >
                {autoBusy ? <SpinnerIcon width={22} height={22} /> : <SparkleIcon width={22} height={22} />}
                {autoBusy ? t("ai.findingWalls") : t("ai.paintAllWalls")}
              </button>
            )}
            <Toolbar part="smart" {...toolbarProps} />
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
              onToggleVisible={(id) =>
                patchSurface(id, {
                  visible: !surfaces.find((s) => s.id === id)?.visible,
                })
              }
              onDelete={deleteSurface}
            />
            <Toolbar part="actions" {...toolbarProps} />
            <Advanced open={advanced} onToggle={setAdvanced} id="walls-advanced">
              <Toolbar part="tools" {...toolbarProps} />
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
              {selected && (
                <>
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="flex justify-between font-medium">
                      {t("editor.edgeSoftness")}
                      <span className="tabular-nums text-muted">{formatNumber(selected.feather)} px</span>
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={3}
                      step={1}
                      value={selected.feather}
                      onChange={(e) => refreshSurface(selected.id, Number(e.target.value))}
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {(seg.phase === "ready" || seg.phase === "analyzing") && (
                      <button
                        type="button"
                        onClick={() => refineSurface(selected.id)}
                        disabled={refining || selected.coverage === 0}
                        data-testid="refine"
                        className="min-h-11 rounded-lg border border-brand-600 bg-white px-4 text-sm font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-50"
                      >
                        {refining ? t("editor.refining") : t("editor.refine")}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => clearMask(selected.id)}
                      className="min-h-11 rounded-lg border border-line bg-white px-4 text-sm hover:bg-red-50 hover:text-red-700"
                    >
                      {t("editor.clearMask")}
                    </button>
                  </div>
                </>
              )}
              {renderMs !== null && (
                <span className="text-xs tabular-nums text-muted" data-testid="render-time">
                  {t("editor.renderTime", {
                    ms: formatNumber(renderMs, { maximumFractionDigits: 1 }),
                  })}
                </span>
              )}
            </Advanced>
            <NextButton onClick={() => goStep("colors")} emphasis={anyPainted} testId="next-colors">
              {t("steps.nextColors")}
            </NextButton>
          </>
        )}

        {step === "colors" && selected && (
          <>
            <p className="text-base font-medium">{t("steps.colorsHint")}</p>
            <SurfacesPanel
              surfaces={surfaces}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onRename={(id, name) => patchSurface(id, { name })}
              onToggleVisible={(id) =>
                patchSurface(id, {
                  visible: !surfaces.find((s) => s.id === id)?.visible,
                })
              }
              title={t("steps.whichWall")}
            />
            <ColorPanel
              surface={selected}
              surfaceCount={surfaces.length}
              tab={pickerTab}
              onTab={setPickerTab}
              onPick={pickPaint}
              onCustom={pickCustom}
              onApplyPalette={applyPalette}
              picked={picked}
              onPicked={setPicked}
              eyedropper={eyedropper}
              onEyedropper={(on) => {
                setEyedropper(on);
                if (on) {
                  endSession();
                  setCompare(false);
                }
              }}
              photoColors={photoColors}
              onRemoveColor={() =>
                patchSurface(selected.id, {
                  hex: null,
                  lab: null,
                  paintId: null,
                })
              }
              onFinish={(finish: Finish) => patchSurface(selected.id, { finish })}
              onBrightness={(brightness) => patchSurface(selected.id, { brightness })}
              onCleanup={(cleanup) => patchSurface(selected.id, { cleanup })}
              advanced={advanced}
              onAdvanced={setAdvanced}
              compareList={compareList}
              onCompareAdd={(c) => setCompareList((l) => (l.some((x) => x.id === c.id) ? l : [...l, c].slice(-4)))}
              onCompareRemove={(id) => setCompareList((l) => l.filter((x) => x.id !== id))}
              onCompareOpen={openCompare}
              comparing={comparing}
            />
            <LightSwitch value={lightMode} onChange={setLightMode} />
            <Toolbar part="actions" {...toolbarProps} />
            <NextButton onClick={() => goStep("share")} emphasis={anyPainted} testId="next-share">
              {t("steps.nextShare")}
            </NextButton>
          </>
        )}

        {step === "share" && (
          <SharePanel
            surfaces={surfaces}
            onDownload={download}
            onEdit={(id) => {
              setSelectedId(id);
              goStep("colors");
            }}
            onNewPhoto={() => {
              if (window.history.state?.cvPhoto) window.history.back();
              else closePhoto();
            }}
            lightSwitch={<LightSwitch value={lightMode} onChange={setLightMode} />}
            compareButton={<Toolbar part="actions" {...toolbarProps} />}
          >
            <QuantityPanel surfaces={surfaces} measures={measuresFor} onMeasure={(id, m) => setMeasures((x) => ({ ...x, [id]: m }))} settings={qtySettings} onSettings={setQtySettings} />
            <SendPanel rows={surfaceQuantities(surfaces, measuresFor, qtySettings)} getImage={() => stageRef.current?.exportBlob("image/jpeg", 0.88) ?? Promise.resolve(null)} />
          </SharePanel>
        )}

        {step !== "share" && (
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
            <button
              type="button"
              onClick={() => {
                if (window.history.state?.cvPhoto) window.history.back();
                else closePhoto();
              }}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line px-4 text-sm font-medium hover:bg-black/5"
            >
              <ImageIcon width={18} height={18} /> {t("editor.newPhoto")}
            </button>
            <button
              type="button"
              onClick={download}
              data-testid="download"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700"
            >
              <DownloadIcon width={18} height={18} /> {t("editor.download")}
            </button>
          </div>
        )}
      </aside>
      {compareView && (
        <CompareView
          items={compareView}
          onClose={() => setCompareView(null)}
          onChoose={(paint) => {
            pickPaint(paint);
            setCompareView(null);
          }}
        />
      )}
    </div>
  );
}
