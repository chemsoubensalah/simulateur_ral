"use client";

import type { ComponentProps } from "react";
import { useI18n } from "@/lib/i18n/client";
import { colorName, getColor, type PaintColor } from "@/lib/color/catalog";
import { useFavorites } from "./useFavorites";
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
  /** Colours waiting to be compared side by side (max 4). */
  compareList: PaintColor[];
  onCompareAdd: (p: PaintColor) => void;
  onCompareRemove: (id: string) => void;
  onCompareOpen: () => void;
  comparing: boolean;
};

export function ColorPanel(props: Props) {
  const { surface, onRemoveColor, onFinish, onBrightness, onCleanup, advanced, onAdvanced, compareList, onCompareAdd, onCompareRemove, onCompareOpen, comparing, ...picker } =
    props;
  const { isFavorite, toggle } = useFavorites();
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
        {paint && (
          <div className="flex shrink-0 flex-col gap-1">
            <button
              type="button"
              onClick={() => toggle(paint.id)}
              aria-pressed={isFavorite(paint.id)}
              aria-label={isFavorite(paint.id) ? t("color.unfavorite") : t("color.favorite")}
              title={isFavorite(paint.id) ? t("color.unfavorite") : t("color.favorite")}
              data-testid="favorite"
              className={`flex h-10 w-10 items-center justify-center rounded-xl border text-xl ${isFavorite(paint.id) ? "border-red-200 bg-red-50 text-red-600" : "border-line text-muted hover:bg-black/5"}`}
            >
              {isFavorite(paint.id) ? "♥" : "♡"}
            </button>
          </div>
        )}
        {paint && (
          <button
            type="button"
            onClick={() => onCompareAdd(paint)}
            disabled={compareList.some((c) => c.id === paint.id)}
            data-testid="compare-add"
            className="min-h-10 shrink-0 rounded-xl border border-brand-600 px-3 text-sm font-semibold text-brand-700 hover:bg-brand-50 disabled:opacity-40"
          >
            + {t("color.compareAdd")}
          </button>
        )}
      </div>
      {surface.hex && (
        <button type="button" onClick={onRemoveColor} className="-mt-2 self-end text-xs text-muted underline hover:text-ink">
          {t("color.remove")}
        </button>
      )}

      {compareList.length > 0 && (
        <div className="flex flex-col gap-2 rounded-2xl border border-brand-100 bg-brand-50 p-3" data-testid="compare-tray">
          <p className="text-sm font-semibold">{t("color.compareTray", { n: formatNumber(compareList.length) })}</p>
          <ul className="flex gap-2">
            {compareList.map((c) => (
              <li key={c.id} className="relative">
                <span className="block h-11 w-11 rounded-lg border border-black/10" style={{ background: c.hex }} title={c.code} />
                <button
                  type="button"
                  onClick={() => onCompareRemove(c.id)}
                  aria-label={t("color.compareRemove", { code: c.code })}
                  className="absolute -end-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-white text-xs shadow"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
          {compareList.length < 2 ? (
            <p className="text-xs text-muted">{t("color.compareHint")}</p>
          ) : (
            <button
              type="button"
              onClick={onCompareOpen}
              disabled={comparing || surface.coverage === 0}
              data-testid="compare-open"
              className="min-h-12 rounded-xl bg-brand-600 px-4 font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {comparing ? t("color.comparing") : t("color.compareOpen")}
            </button>
          )}
        </div>
      )}

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
