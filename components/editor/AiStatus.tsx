"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import type { SegStatus } from "@/lib/segmentation/client";
import { SparkleIcon, SpinnerIcon } from "./icons";

const DEFAULT_ANALYZE_MS = { server: 8000, device: 15000 } as const;
const storageKey = (source: string) => `cv-analyze-ms-${source}`;

function expectedMs(source: "server" | "device"): number {
  try {
    const v = Number(localStorage.getItem(storageKey(source)));
    if (v > 500 && v < 300_000) return v;
  } catch {
    /* storage unavailable */
  }
  return DEFAULT_ANALYZE_MS[source];
}

/**
 * Progress (0..1) and seconds remaining for the current AI phase: bytes for the
 * model download, and for the analysis the time it took last time on this
 * device (learned), so the estimate fits the customer's phone.
 */
function useProgress(status: SegStatus): { pct: number | null; remaining: number | null } {
  const [, setTick] = useState(0);
  const phaseRef = useRef<{ key: string; at: number; firstLoaded: number }>({ key: "", at: 0, firstLoaded: 0 });
  const key = status.phase === "analyzing" ? `analyzing:${status.source}` : status.phase;
  const now = Date.now();
  if (phaseRef.current.key !== key) {
    const prev = phaseRef.current;
    // Learn how long the analysis takes on this device.
    if (prev.key.startsWith("analyzing:") && status.phase === "ready") {
      const took = now - prev.at;
      const source = prev.key.slice("analyzing:".length) as "server" | "device";
      try {
        localStorage.setItem(storageKey(source), String(Math.round(0.5 * took + 0.5 * expectedMs(source))));
      } catch {
        /* storage unavailable */
      }
    }
    phaseRef.current = { key, at: now, firstLoaded: status.phase === "loading" ? status.loaded : 0 };
  }
  const busy = status.phase === "loading" || status.phase === "analyzing";
  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => setTick((n) => n + 1), 500);
    return () => clearInterval(id);
  }, [busy]);

  const elapsed = now - phaseRef.current.at;
  if (status.phase === "loading" && status.total > 0) {
    const pct = Math.min(1, status.loaded / status.total);
    const done = status.loaded - phaseRef.current.firstLoaded;
    const rate = elapsed > 800 && done > 0 ? done / elapsed : 0;
    return { pct, remaining: rate > 0 ? Math.ceil((status.total - status.loaded) / rate / 1000) : null };
  }
  if (status.phase === "analyzing") {
    const exp = expectedMs(status.source);
    return { pct: Math.min(0.95, elapsed / exp), remaining: elapsed < exp ? Math.max(1, Math.ceil((exp - elapsed) / 1000)) : 0 };
  }
  return { pct: null, remaining: null };
}

/** Compact status of the AI wall detection, shown on the photo and in the panel. */
export function AiStatus({ status, compact = false, onRetry }: { status: SegStatus; compact?: boolean; onRetry?: () => void }) {
  const { t, formatNumber } = useI18n();
  const { pct, remaining } = useProgress(status);
  let text = "";
  let note: string | null = null;
  let busy = false;
  switch (status.phase) {
    case "idle":
      return null;
    case "loading":
      busy = true;
      if (status.total > 0) {
        text = t("ai.downloading", { pct: formatNumber(Math.min(100, Math.round((status.loaded / status.total) * 100))) });
        note = t("ai.downloadingNote");
      } else text = t("ai.preparing");
      break;
    case "analyzing":
      busy = true;
      text = status.source === "server" ? t("ai.analyzingServer") : t("ai.analyzing");
      break;
    case "ready":
      text = t("ai.ready");
      note = status.source === "server" ? t("ai.sourceServer") : t("ai.sourceDevice");
      break;
    case "error":
      text = t("ai.error");
      break;
  }
  const eta = remaining === null ? null : remaining > 0 ? t("ai.remaining", { s: formatNumber(remaining) }) : t("ai.almost");

  const bar = pct !== null && (
    <div
      className={`overflow-hidden rounded-full ${compact ? "mt-1 h-1 bg-white/25" : "mt-2 h-2 bg-brand-100"}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct * 100)}
      aria-label={text}
      data-testid={compact ? undefined : "ai-progress"}
    >
      <div className={`h-full transition-[width] duration-500 ${compact ? "bg-white" : "bg-brand-600"}`} style={{ width: `${pct * 100}%` }} />
    </div>
  );

  if (compact) {
    return (
      <div
        role="status"
        data-testid="ai-chip"
        data-phase={status.phase}
        className={`inline-flex flex-col rounded-2xl px-3 py-1.5 text-xs font-semibold shadow ${
          status.phase === "error" ? "bg-amber-100 text-amber-900" : "bg-black/65 text-white"
        }`}
      >
        <span className="inline-flex items-center gap-1.5">
          {busy ? <SpinnerIcon width={14} height={14} /> : <SparkleIcon width={14} height={14} />}
          <span className="truncate">{text}</span>
          {eta && <span className="shrink-0 font-normal opacity-80">· {eta}</span>}
        </span>
        {bar}
      </div>
    );
  }

  return (
    <div
      className={`flex items-start gap-2 rounded-xl p-3 text-sm ${status.phase === "error" ? "bg-amber-50 text-amber-900" : "bg-brand-50 text-brand-700"}`}
      data-testid="ai-status"
      data-phase={status.phase}
    >
      {busy ? <SpinnerIcon className="mt-0.5 shrink-0" width={18} height={18} /> : <SparkleIcon className="mt-0.5 shrink-0" width={18} height={18} />}
      <div className="min-w-0 flex-1">
        <p className="font-medium">{text}</p>
        {note && <p className="mt-0.5 text-xs opacity-80">{note}</p>}
        {bar}
        {eta && <p className="mt-1 text-xs tabular-nums opacity-80">{eta}</p>}
      </div>
      {status.phase === "error" && onRetry && (
        <button type="button" onClick={onRetry} className="min-h-9 shrink-0 rounded-lg bg-white px-3 text-sm font-semibold shadow-sm">
          {t("ai.retry")}
        </button>
      )}
    </div>
  );
}
