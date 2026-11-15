"use client";

import { useI18n } from "@/lib/i18n/client";
import type { SegStatus } from "@/lib/segmentation/client";
import { SparkleIcon, SpinnerIcon } from "./icons";

/** Compact status of the AI wall detection, shown on the photo and in the panel. */
export function AiStatus({ status, compact = false, onRetry }: { status: SegStatus; compact?: boolean; onRetry?: () => void }) {
  const { t, formatNumber } = useI18n();
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

  if (compact) {
    return (
      <div
        role="status"
        data-testid="ai-chip"
        data-phase={status.phase}
        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold shadow ${
          status.phase === "error" ? "bg-amber-100 text-amber-900" : "bg-black/65 text-white"
        }`}
      >
        {busy ? <SpinnerIcon width={14} height={14} /> : <SparkleIcon width={14} height={14} />}
        <span className="truncate">{text}</span>
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
        {status.phase === "loading" && status.total > 0 && (
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-brand-100" aria-hidden>
            <div className="h-full bg-brand-600 transition-[width]" style={{ width: `${(status.loaded / status.total) * 100}%` }} />
          </div>
        )}
      </div>
      {status.phase === "error" && onRetry && (
        <button type="button" onClick={onRetry} className="min-h-9 shrink-0 rounded-lg bg-white px-3 text-sm font-semibold shadow-sm">
          {t("ai.retry")}
        </button>
      )}
    </div>
  );
}
