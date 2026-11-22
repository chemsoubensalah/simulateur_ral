"use client";

import { useEffect, useRef } from "react";
import { useI18n } from "@/lib/i18n/client";
import { colorName, type PaintColor } from "@/lib/color/catalog";

type Props = {
  items: { paint: PaintColor; url: string }[];
  onChoose: (p: PaintColor) => void;
  onClose: () => void;
};

/** Up to four versions of the photo side by side, one per colour; tap one to choose it. */
export function CompareView({ items, onChoose, onClose }: Props) {
  const { t, locale } = useI18n();
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90 p-3 text-white" role="dialog" aria-modal="true" aria-labelledby="compare-title" data-testid="compare-view">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="compare-title" className="text-lg font-bold">
          {t("color.compareTitle")}
        </h2>
        <button ref={closeRef} type="button" onClick={onClose} className="min-h-11 rounded-full bg-white/15 px-4 text-sm font-semibold hover:bg-white/25">
          {t("common.close")}
        </button>
      </div>
      <ul className={`grid min-h-0 flex-1 gap-3 overflow-y-auto ${items.length > 2 ? "grid-cols-2" : "grid-cols-1 sm:grid-cols-2"}`}>
        {items.map(({ paint, url }) => {
          const name = colorName(paint, locale);
          return (
            <li key={paint.id} className="flex min-h-0 flex-col overflow-hidden rounded-2xl bg-white text-ink" data-testid="compare-item" data-code={paint.code}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={`${paint.code}${name ? ` — ${name}` : ""}`} className="min-h-0 w-full flex-1 object-contain bg-black" />
              <div className="flex flex-col gap-2 p-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="h-8 w-8 shrink-0 rounded-lg border border-black/10" style={{ background: paint.hex }} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold" dir="ltr">
                      {paint.code}
                    </p>
                    {name && <p className="truncate text-xs text-muted">{name}</p>}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onChoose(paint)}
                  className="min-h-11 w-full rounded-xl bg-brand-600 px-3 text-sm font-semibold text-white hover:bg-brand-700"
                  data-testid={`compare-choose-${paint.code}`}
                >
                  {t("color.chooseThis")}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
