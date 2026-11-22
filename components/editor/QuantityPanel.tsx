"use client";

import { useI18n } from "@/lib/i18n/client";
import { getColor } from "@/lib/color/catalog";
import { canCombination, litersNeeded, paintableArea, type CanPlan, type Measure, type MeasureMode } from "@/lib/paint/quantity";
import type { Surface } from "./types";

export type QuantitySettings = { coats: number; coverage: number };

type Props = {
  surfaces: Surface[];
  measures: Record<string, Measure>;
  onMeasure: (id: string, m: Measure) => void;
  settings: QuantitySettings;
  onSettings: (s: QuantitySettings) => void;
};

/** Parse "2,7", "2.7" or Arabic-Indic digits "٢٫٧". */
export function parseNumber(v: string): number {
  const western = v
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٫,]/g, ".")
    .trim();
  const n = Number(western);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export type SurfaceQuantity = { surface: Surface; area: number; liters: number; plan: CanPlan };

/** Quantities per painted surface (area 0 when not measured yet). */
export function surfaceQuantities(surfaces: Surface[], measures: Record<string, Measure>, settings: QuantitySettings): SurfaceQuantity[] {
  return surfaces
    .filter((s) => s.coverage > 0 && s.hex && s.visible)
    .map((surface) => {
      const m = measures[surface.id];
      const area = m ? paintableArea(m) : 0;
      const liters = litersNeeded(area, settings.coats, settings.coverage);
      return { surface, area, liters, plan: canCombination(liters) };
    });
}

export function NumberField({ label, value, onChange, testId }: { label: string; value: number; onChange: (n: number) => void; testId?: string }) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-sm font-medium">
      {label}
      <input
        type="text"
        inputMode="decimal"
        dir="ltr"
        defaultValue={value > 0 ? String(value) : ""}
        onChange={(e) => onChange(parseNumber(e.target.value))}
        placeholder="0"
        data-testid={testId}
        className="h-12 w-full rounded-xl border border-line bg-white px-3 text-center text-lg font-semibold"
      />
    </label>
  );
}

function Stepper({ label, value, onChange, testId }: { label: string; value: number; onChange: (n: number) => void; testId: string }) {
  const { t, formatNumber } = useI18n();
  return (
    <div className="flex flex-col gap-1 text-sm font-medium">
      <span>{label}</span>
      <div className="flex h-12 items-center justify-between rounded-xl border border-line bg-white">
        <button type="button" onClick={() => onChange(Math.max(0, value - 1))} aria-label={t("qty.less", { what: label })} className="h-full w-11 text-xl">
          −
        </button>
        <span className="text-lg font-semibold tabular-nums" data-testid={testId} aria-live="polite">
          {formatNumber(value)}
        </span>
        <button type="button" onClick={() => onChange(Math.min(20, value + 1))} aria-label={t("qty.more", { what: label })} className="h-full w-11 text-xl">
          +
        </button>
      </div>
    </div>
  );
}

export function PlanText({ plan }: { plan: CanPlan }) {
  const { t, formatNumber } = useI18n();
  return <>{plan.map((c) => t("qty.can", { n: formatNumber(c.count), s: formatNumber(c.size) })).join(" + ")}</>;
}

/** Paint quantity per wall: size → litres → cans (no prices). */
export function QuantityPanel({ surfaces, measures, onMeasure, settings, onSettings }: Props) {
  const { t, formatNumber } = useI18n();
  const rows = surfaceQuantities(surfaces, measures, settings);
  const modes: MeasureMode[] = ["wall", "room", "ceiling"];
  const fmt1 = (n: number) => formatNumber(n, { maximumFractionDigits: 1 });

  return (
    <section aria-labelledby="qty-title" className="flex flex-col gap-3" data-testid="quantity">
      <h2 id="qty-title" className="text-lg font-bold">
        {t("qty.title")}
      </h2>
      {rows.map(({ surface, area, liters, plan }) => {
        const m = measures[surface.id]!;
        const paint = surface.paintId ? getColor(surface.paintId) : undefined;
        const set = (patch: Partial<Measure>) => onMeasure(surface.id, { ...m, ...patch });
        return (
          <div key={surface.id} className="flex flex-col gap-3 rounded-2xl border border-line bg-white p-3" data-testid={`qty-${surface.id}`}>
            <div className="flex items-center gap-2">
              <span className="h-8 w-8 shrink-0 rounded-lg border border-black/10" style={{ background: surface.hex! }} aria-hidden />
              <p className="min-w-0 flex-1 truncate font-semibold">
                {surface.name} · <span dir="ltr">{paint?.code ?? surface.hex}</span>
              </p>
            </div>
            <div role="radiogroup" aria-label={t("qty.title")} className="grid grid-cols-3 rounded-xl border border-line p-1">
              {modes.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={m.mode === mode}
                  onClick={() => set({ mode })}
                  data-testid={`qty-mode-${mode}`}
                  className={`min-h-10 rounded-lg px-1 text-sm font-medium ${m.mode === mode ? "bg-brand-600 text-white" : "hover:bg-brand-50"}`}
                >
                  {t(`qty.${mode}`)}
                </button>
              ))}
            </div>
            <div className={`grid gap-2 ${m.mode === "room" ? "grid-cols-3" : "grid-cols-2"}`} key={m.mode}>
              <NumberField label={t(m.mode === "wall" ? "qty.width" : "qty.length")} value={m.a} onChange={(a) => set({ a })} testId="qty-a" />
              {m.mode !== "wall" && <NumberField label={t("qty.roomWidth")} value={m.b} onChange={(b) => set({ b })} testId="qty-b" />}
              {m.mode !== "ceiling" && <NumberField label={t("qty.height")} value={m.height} onChange={(height) => set({ height })} testId="qty-height" />}
            </div>
            {m.mode !== "ceiling" && (
              <div className="grid grid-cols-2 gap-2">
                <Stepper label={t("qty.doors")} value={m.doors} onChange={(doors) => set({ doors })} testId="qty-doors" />
                <Stepper label={t("qty.windows")} value={m.windows} onChange={(windows) => set({ windows })} testId="qty-windows" />
              </div>
            )}
            {area > 0 ? (
              <div className="rounded-xl bg-brand-50 p-3 text-brand-700" data-testid="qty-result">
                <p className="font-semibold">{t("qty.result", { l: fmt1(liters), a: fmt1(area) })}</p>
                <p className="mt-1 text-lg font-bold">
                  {t("qty.buy")}: <PlanText plan={plan} />
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted">{t("qty.enter")}</p>
            )}
          </div>
        );
      })}

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1 text-sm font-medium">
          <span id="coats-label">{t("qty.coats")}</span>
          <div role="radiogroup" aria-labelledby="coats-label" className="grid h-12 grid-cols-3 rounded-xl border border-line bg-white p-1">
            {[1, 2, 3].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={settings.coats === n}
                onClick={() => onSettings({ ...settings, coats: n })}
                className={`rounded-lg text-base font-semibold ${settings.coats === n ? "bg-brand-600 text-white" : "hover:bg-brand-50"}`}
              >
                {formatNumber(n)}
              </button>
            ))}
          </div>
        </div>
        <NumberField label={t("qty.coverage")} value={settings.coverage} onChange={(coverage) => coverage > 0 && onSettings({ ...settings, coverage })} />
      </div>
      <p className="text-xs text-muted">{t("qty.note")}</p>
    </section>
  );
}
