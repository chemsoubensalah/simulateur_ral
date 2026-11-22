"use client";

import type { ReactNode } from "react";
import { useI18n } from "@/lib/i18n/client";
import { colorName, getColor } from "@/lib/color/catalog";
import type { Surface } from "./types";
import { DownloadIcon, ImageIcon } from "./icons";

type Props = {
  surfaces: Surface[];
  onDownload: () => void;
  /** Change the colour of a surface (goes back to the colour step). */
  onEdit: (id: string) => void;
  onNewPhoto: () => void;
  lightSwitch?: ReactNode;
  compareButton?: ReactNode;
  /** Extra sections (quantities, sending to the shop). */
  children?: ReactNode;
};

/** Last step: the chosen colours at a glance, save the picture, send the choice. */
export function SharePanel({ surfaces, onDownload, onEdit, onNewPhoto, lightSwitch, compareButton, children }: Props) {
  const { t, locale } = useI18n();
  const painted = surfaces.filter((s) => s.coverage > 0 && s.hex && s.visible);
  return (
    <section aria-labelledby="share-title" className="flex flex-col gap-5">
      <p className="text-base font-medium">{t("steps.shareHint")}</p>

      <div className="flex flex-col gap-2">
        <h2 id="share-title" className="text-lg font-bold">
          {t("steps.summary")}
        </h2>
        <ul className="flex flex-col gap-2" data-testid="color-summary">
          {painted.map((s) => {
            const paint = s.paintId ? getColor(s.paintId) : undefined;
            return (
              <li key={s.id} className="flex items-center gap-3 rounded-2xl border border-line bg-white p-3">
                <span className="h-14 w-14 shrink-0 rounded-xl border border-black/10" style={{ background: s.hex! }} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-muted">{s.name}</p>
                  <p className="truncate text-lg font-bold" dir="ltr">
                    {paint?.code ?? s.hex}
                  </p>
                  {paint && <p className="truncate text-sm">{colorName(paint, locale)}</p>}
                  <p className="text-xs text-muted">{t(`color.${s.finish}`)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => onEdit(s.id)}
                  className="min-h-11 shrink-0 rounded-xl border border-brand-600 px-3 text-sm font-semibold text-brand-700 hover:bg-brand-50"
                >
                  {t("color.change")}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {children}

      <button
        type="button"
        onClick={onDownload}
        data-testid="download-big"
        className="inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-brand-600 px-5 text-lg font-bold text-white shadow-sm hover:bg-brand-700"
      >
        <DownloadIcon width={22} height={22} /> {t("editor.download")}
      </button>

      {lightSwitch}
      {compareButton}

      <p className="text-xs text-muted">{t("color.approximate")}</p>

      <button
        type="button"
        onClick={onNewPhoto}
        className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-line bg-white px-5 font-semibold hover:bg-black/5"
      >
        <ImageIcon width={20} height={20} /> {t("steps.newPhoto")}
      </button>
    </section>
  );
}
