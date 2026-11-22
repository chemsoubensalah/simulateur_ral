"use client";

import type { ComponentProps } from "react";
import { useI18n } from "@/lib/i18n/client";
import { colorName, getColor } from "@/lib/color/catalog";
import type { Finish } from "@/lib/recolor/model";
import { ColorPicker } from "./ColorPicker";
import { Advanced } from "./Steps";
import type { Surface } from "./types";

type PickerProps = Omit<ComponentProps<typeof ColorPicker>, "surface">;

type Props = PickerProps & {
  surface: Surface;
  onRemoveColor: () => void;
  onFinish: (f: Finish) => void;
  onBrightness: (v: number) => void;
  onCleanup: (on: boolean) => void;
  advanced: boolean;
  onAdvanced: (open: boolean) => void;
};

export function ColorPanel(props: Props) {
  const { surface, onRemoveColor, onFinish, onBrightness, onCleanup, advanced, onAdvanced, ...picker } = props;
  const { t, locale, formatNumber } = useI18n();
  const paint = surface.paintId ? getColor(surface.paintId) : undefined;
  const name = paint ? colorName(paint, locale) : undefined;

  const finishes: Finish[] = ["matte", "satin", "gloss"];

  return (
    <section aria-labelledby="color-title" className="flex flex-col gap-4">
      <h2 id="color-title" className="text-sm font-semibold uppercase tracking-wide text-muted">
        {t("color.title")} — {surface.name}
      </h2>

      <div className="flex items-center gap-3 rounded-xl border border-line bg-white p-3" data-testid="current-paint">
        <span
          className="h-14 w-14 shrink-0 rounded-xl border border-black/10"
          style={{ background: surface.hex ?? "repeating-linear-gradient(45deg,#fff 0 4px,#ddd 4px 8px)" }}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          {surface.hex ? (
            <>
              <p className="truncate text-lg font-bold" dir="ltr" data-testid="current-code">
                {paint?.code ?? surface.hex}
              </p>
              {name && <p className="truncate text-sm text-muted">{name}</p>}
            </>
          ) : (
            <p className="text-sm text-muted">{t("color.noPaint")}</p>
          )}
        </div>
        {surface.hex && (
          <button type="button" onClick={onRemoveColor} className="min-h-10 shrink-0 rounded-lg px-2 text-xs text-muted underline hover:text-ink">
            {t("color.remove")}
          </button>
        )}
      </div>

      <ColorPicker surface={surface} {...picker} />

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

      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-white p-3 text-sm">
        <input
          type="checkbox"
          role="switch"
          checked={surface.cleanup}
          onChange={(e) => onCleanup(e.target.checked)}
          data-testid="cleanup"
          aria-describedby="cleanup-hint"
          className="mt-0.5 h-5 w-5 shrink-0 accent-brand-600"
        />
        <span className="flex flex-col gap-0.5">
          <span className="font-medium">{t("color.cleanup")}</span>
          <span id="cleanup-hint" className="text-xs text-muted">{t("color.cleanupHint")}</span>
        </span>
      </label>

      <Advanced open={advanced} onToggle={onAdvanced} id="color-advanced">
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
      </Advanced>
    </section>
  );
}
