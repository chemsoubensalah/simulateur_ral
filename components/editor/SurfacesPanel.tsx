"use client";

import { useI18n } from "@/lib/i18n/client";
import { getColor } from "@/lib/color/catalog";
import type { Surface } from "./types";
import { EyeIcon, EyeOffIcon, PlusIcon, TrashIcon } from "./icons";

type Props = {
  surfaces: Surface[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRename: (id: string, name: string) => void;
  onToggleVisible: (id: string) => void;
  onDelete: (id: string) => void;
};

export function SurfacesPanel({ surfaces, selectedId, onSelect, onAdd, onRename, onToggleVisible, onDelete }: Props) {
  const { t, formatNumber } = useI18n();
  return (
    <section aria-labelledby="surfaces-title" className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 id="surfaces-title" className="text-sm font-semibold uppercase tracking-wide text-muted">
          {t("surfaces.title")}
        </h2>
        <button
          type="button"
          onClick={onAdd}
          data-testid="add-surface"
          className="inline-flex min-h-10 items-center gap-1 rounded-full border border-brand-600 px-3 text-sm font-semibold text-brand-700 hover:bg-brand-50"
        >
          <PlusIcon width={18} height={18} /> {t("surfaces.add")}
        </button>
      </div>
      <ul className="flex flex-col gap-1.5" data-testid="surface-list">
        {surfaces.map((s) => {
          const selected = s.id === selectedId;
          return (
            <li
              key={s.id}
              className={`flex items-center gap-2 rounded-xl border p-1.5 ${selected ? "border-brand-500 bg-brand-50" : "border-line bg-white"}`}
            >
              <button
                type="button"
                onClick={() => onSelect(s.id)}
                aria-pressed={selected}
                aria-label={t("surfaces.select", { name: s.name })}
                className="h-9 w-9 shrink-0 rounded-lg border border-black/10"
                style={{ background: s.hex ?? "repeating-linear-gradient(45deg,#fff 0 4px,#ddd 4px 8px)" }}
              />
              <div className="min-w-0 flex-1">
                <input
                  value={s.name}
                  onChange={(e) => onRename(s.id, e.target.value)}
                  onFocus={() => onSelect(s.id)}
                  aria-label={t("surfaces.rename")}
                  maxLength={40}
                  className="w-full rounded-md bg-transparent px-1 text-sm font-medium focus:bg-white"
                />
                <p className="px-1 text-xs text-muted">
                  <span dir="ltr">{(s.paintId && getColor(s.paintId)?.code) ?? s.hex ?? t("surfaces.noColor")}</span> · {t("surfaces.coverage", { pct: formatNumber(s.coverage * 100, { maximumFractionDigits: 1 }) })}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onToggleVisible(s.id)}
                aria-label={s.visible ? t("surfaces.hide") : t("surfaces.show")}
                title={s.visible ? t("surfaces.hide") : t("surfaces.show")}
                className="flex h-10 w-10 items-center justify-center rounded-lg text-muted hover:bg-black/5"
              >
                {s.visible ? <EyeIcon /> : <EyeOffIcon />}
              </button>
              <button
                type="button"
                onClick={() => onDelete(s.id)}
                aria-label={t("surfaces.remove")}
                title={t("surfaces.remove")}
                disabled={surfaces.length <= 1}
                className="flex h-10 w-10 items-center justify-center rounded-lg text-muted hover:bg-red-50 hover:text-red-700 disabled:opacity-30"
              >
                <TrashIcon />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
