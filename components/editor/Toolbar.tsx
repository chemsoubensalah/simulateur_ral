"use client";

import type { ReactNode } from "react";
import { useI18n } from "@/lib/i18n/client";
import type { BrushMode } from "@/lib/mask/ops";
import type { Tool } from "./types";
import { BrushIcon, CompareIcon, EraserIcon, LassoIcon, MaskIcon, MinusIcon, PanIcon, PlusIcon, RedoIcon, UndoIcon } from "./icons";

type Props = {
  tool: Tool;
  onTool: (t: Tool) => void;
  brushSize: number;
  onBrushSize: (n: number) => void;
  hardness: number;
  onHardness: (n: number) => void;
  lassoMode: BrushMode;
  onLassoMode: (m: BrushMode) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  showMask: boolean;
  onShowMask: (v: boolean) => void;
  compare: boolean;
  onCompare: (v: boolean) => void;
};

export function Toolbar(p: Props) {
  const { t } = useI18n();
  const tools: { id: Tool; label: string; icon: ReactNode; key: string }[] = [
    { id: "brush", label: t("editor.brush"), icon: <BrushIcon />, key: "B" },
    { id: "eraser", label: t("editor.eraser"), icon: <EraserIcon />, key: "E" },
    { id: "lasso", label: t("editor.lasso"), icon: <LassoIcon />, key: "L" },
    { id: "pan", label: t("editor.pan"), icon: <PanIcon />, key: "H" },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label={t("editor.tools")} className="flex rounded-xl border border-line bg-white p-1">
          {tools.map((tool) => (
            <button
              key={tool.id}
              type="button"
              role="radio"
              aria-checked={p.tool === tool.id}
              aria-label={tool.label}
              title={`${tool.label} (${tool.key})`}
              data-testid={`tool-${tool.id}`}
              disabled={p.compare}
              onClick={() => p.onTool(tool.id)}
              className={`flex min-h-11 min-w-11 flex-col items-center justify-center rounded-lg px-2 text-[11px] font-medium disabled:opacity-40 ${
                p.tool === tool.id ? "bg-brand-600 text-white" : "text-ink hover:bg-brand-50"
              }`}
            >
              {tool.icon}
              <span className="hidden sm:block">{tool.label}</span>
            </button>
          ))}
        </div>

        <div className="flex rounded-xl border border-line bg-white p-1">
          <IconButton label={t("editor.undo")} onClick={p.onUndo} disabled={!p.canUndo} testId="undo">
            <UndoIcon className="rtl:-scale-x-100" />
          </IconButton>
          <IconButton label={t("editor.redo")} onClick={p.onRedo} disabled={!p.canRedo} testId="redo">
            <RedoIcon className="rtl:-scale-x-100" />
          </IconButton>
          <span className="mx-1 w-px self-stretch bg-line" aria-hidden />
          <IconButton label={t("editor.showMask")} onClick={() => p.onShowMask(!p.showMask)} pressed={p.showMask} testId="toggle-mask">
            <MaskIcon />
          </IconButton>
          <IconButton label={t("editor.compare")} onClick={() => p.onCompare(!p.compare)} pressed={p.compare} testId="toggle-compare">
            <CompareIcon />
          </IconButton>
        </div>
      </div>

      {(p.tool === "brush" || p.tool === "eraser") && !p.compare && (
        <div className="grid gap-y-1">
          <label className="flex items-center gap-3 text-sm">
            <span className="w-28 shrink-0">{t("editor.brushSize")}</span>
            <input type="range" min={4} max={160} value={p.brushSize} onChange={(e) => p.onBrushSize(Number(e.target.value))} className="w-full" />
            <span className="w-10 shrink-0 text-end tabular-nums text-muted" aria-hidden>{p.brushSize}</span>
          </label>
          <label className="flex items-center gap-3 text-sm">
            <span className="w-28 shrink-0">{t("editor.hardness")}</span>
            <input type="range" min={0} max={100} value={Math.round(p.hardness * 100)} onChange={(e) => p.onHardness(Number(e.target.value) / 100)} className="w-full" />
            <span className="w-10 shrink-0 text-end tabular-nums text-muted" aria-hidden>{Math.round(p.hardness * 100)}</span>
          </label>
        </div>
      )}

      {p.tool === "lasso" && !p.compare && (
        <div className="flex flex-col gap-2">
          <div role="radiogroup" aria-label={t("editor.lasso")} className="flex w-fit rounded-xl border border-line bg-white p-1">
            {(["add", "erase"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={p.lassoMode === m}
                onClick={() => p.onLassoMode(m)}
                className={`flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-medium ${
                  p.lassoMode === m ? "bg-brand-600 text-white" : "hover:bg-brand-50"
                }`}
              >
                {m === "add" ? <PlusIcon width={18} height={18} /> : <MinusIcon width={18} height={18} />}
                {m === "add" ? t("editor.lassoAdd") : t("editor.lassoSubtract")}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted">{t("editor.lassoHint")}</p>
        </div>
      )}
    </div>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  pressed,
  testId,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      data-testid={testId}
      className={`flex min-h-11 min-w-11 items-center justify-center rounded-lg disabled:opacity-35 ${
        pressed ? "bg-brand-100 text-brand-700" : "hover:bg-brand-50"
      }`}
    >
      {children}
    </button>
  );
}
