"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import { isValidHex } from "@/lib/color/lab";
import type { Finish } from "@/lib/recolor/model";
import type { Surface } from "./types";

/** Starter swatches (whites, neutrals, earth tones, greens, blues, accents). Full paint collections arrive with the color database. */
export const QUICK_COLORS = [
  "#F4F1EA", "#ECE6DA", "#E3D9C6", "#D6C7AE", "#C2B39A", "#9C9384",
  "#D8DCD6", "#B9C3B5", "#8E9F88", "#5E7262", "#3F5246", "#2F3B36",
  "#DCE4EA", "#AFC2D0", "#7C97AE", "#4A6A86", "#2C4257", "#1E2733",
  "#F2D7C4", "#E2A98A", "#C97B5A", "#A4583B", "#E9C46A", "#B5838D",
];

type Props = {
  surface: Surface;
  onColor: (hex: string | null) => void;
  onFinish: (f: Finish) => void;
  onBrightness: (v: number) => void;
  onFeather: (v: number) => void;
  onClearMask: () => void;
  /** Edge-aware refinement (needs the AI worker); undefined hides the button. */
  onRefine?: () => void;
  refining?: boolean;
};

export function ColorPanel({ surface, onColor, onFinish, onBrightness, onFeather, onClearMask, onRefine, refining }: Props) {
  const { t, formatNumber } = useI18n();
  const [hexText, setHexText] = useState(surface.hex ?? "");
  useEffect(() => setHexText(surface.hex ?? ""), [surface.hex]);

  const finishes: Finish[] = ["matte", "satin", "gloss"];

  return (
    <section aria-labelledby="color-title" className="flex flex-col gap-4">
      <h2 id="color-title" className="text-sm font-semibold uppercase tracking-wide text-muted">
        {t("color.title")} — {surface.name}
      </h2>

      <fieldset>
        <legend className="mb-2 text-sm font-medium">{t("color.quick")}</legend>
        <div className="grid grid-cols-8 gap-1.5 sm:grid-cols-12 lg:grid-cols-8" data-testid="quick-colors">
          {QUICK_COLORS.map((hex) => (
            <button
              key={hex}
              type="button"
              onClick={() => onColor(hex)}
              aria-label={t("color.swatch", { hex })}
              aria-pressed={surface.hex === hex}
              title={hex}
              data-hex={hex}
              className={`aspect-square rounded-lg border border-black/10 ${surface.hex === hex ? "ring-2 ring-brand-600 ring-offset-2" : ""}`}
              style={{ background: hex }}
            />
          ))}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm font-medium">
          {t("color.custom")}
          <input
            type="color"
            value={surface.hex ?? "#ffffff"}
            onChange={(e) => onColor(e.target.value.toUpperCase())}
            className="h-11 w-16 cursor-pointer rounded-lg border border-line bg-white p-1"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          {t("color.hex")}
          <input
            dir="ltr"
            value={hexText}
            onChange={(e) => {
              const v = e.target.value;
              setHexText(v);
              if (isValidHex(v) && v.replace("#", "").length === 6) onColor(`#${v.replace("#", "").toUpperCase()}`);
            }}
            placeholder="#RRGGBB"
            maxLength={7}
            className="h-11 w-28 rounded-lg border border-line bg-white px-2 font-mono uppercase"
            data-testid="hex-input"
          />
        </label>
        {surface.hex && (
          <button type="button" onClick={() => onColor(null)} className="min-h-11 rounded-lg px-3 text-sm text-muted underline hover:text-ink">
            {t("color.remove")}
          </button>
        )}
      </div>

      <div role="radiogroup" aria-label={t("color.finish")} className="flex flex-col gap-1">
        <span className="text-sm font-medium" aria-hidden>{t("color.finish")}</span>
        <div className="flex w-fit rounded-xl border border-line bg-white p-1">
          {finishes.map((f) => (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={surface.finish === f}
              onClick={() => onFinish(f)}
              data-testid={`finish-${f}`}
              className={`min-h-10 rounded-lg px-4 text-sm font-medium ${surface.finish === f ? "bg-brand-600 text-white" : "hover:bg-brand-50"}`}
            >
              {t(`color.${f}`)}
            </button>
          ))}
        </div>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="flex justify-between font-medium">
          {t("color.brightness")}
          <span className="tabular-nums text-muted" dir="ltr">
            {surface.brightness >= 1 ? "+" : "−"}
            {formatNumber(Math.abs(Math.round((surface.brightness - 1) * 100)))}%
          </span>
        </span>
        <input
          type="range"
          min={50}
          max={150}
          value={Math.round(surface.brightness * 100)}
          onChange={(e) => onBrightness(Number(e.target.value) / 100)}
          aria-describedby="brightness-hint"
        />
        <span id="brightness-hint" className="text-xs text-muted">{t("color.brightnessHint")}</span>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="flex justify-between font-medium">
          {t("editor.edgeSoftness")}
          <span className="tabular-nums text-muted">{formatNumber(surface.feather)} px</span>
        </span>
        <input type="range" min={0} max={3} step={1} value={surface.feather} onChange={(e) => onFeather(Number(e.target.value))} />
      </label>

      <div className="flex flex-wrap gap-2">
        {onRefine && (
          <button
            type="button"
            onClick={onRefine}
            disabled={refining || surface.coverage === 0}
            data-testid="refine"
            className="min-h-11 rounded-lg border border-brand-600 bg-white px-4 text-sm font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-50"
          >
            {refining ? t("editor.refining") : t("editor.refine")}
          </button>
        )}
        <button type="button" onClick={onClearMask} className="min-h-11 rounded-lg border border-line bg-white px-4 text-sm hover:bg-red-50 hover:text-red-700">
          {t("editor.clearMask")}
        </button>
      </div>
    </section>
  );
}
