"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useI18n } from "@/lib/i18n/client";

export type Step = "walls" | "colors" | "share";
export const STEPS: Step[] = ["walls", "colors", "share"];

/** The three big steps: walls → colour → save & send. Any step can be opened directly. */
export function StepNav({ step, onStep, done }: { step: Step; onStep: (s: Step) => void; done: Partial<Record<Step, boolean>> }) {
  const { t, formatNumber } = useI18n();
  return (
    <nav aria-label={t("steps.label")}>
      <ol className="grid grid-cols-3 gap-1.5">
        {STEPS.map((s, i) => {
          const current = s === step;
          return (
            <li key={s}>
              <button
                type="button"
                onClick={() => onStep(s)}
                aria-current={current ? "step" : undefined}
                data-testid={`step-${s}`}
                className={`flex min-h-14 w-full flex-col items-center justify-center gap-0.5 rounded-2xl border-2 px-1 text-sm font-semibold transition-colors ${
                  current ? "border-brand-600 bg-brand-600 text-white" : done[s] ? "border-brand-500 bg-brand-50 text-brand-700" : "border-line bg-white text-ink hover:bg-brand-50"
                }`}
              >
                <span
                  aria-hidden
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${current ? "bg-white text-brand-700" : done[s] ? "bg-brand-600 text-white" : "bg-black/10"}`}
                >
                  {done[s] && !current ? "✓" : formatNumber(i + 1)}
                </span>
                <span className="leading-tight">{t(`steps.${s}`)}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

const ADVANCED_KEY = "cv-advanced";

/** Whether "More tools" is open; remembered on the device (shop staff keep it open). */
export function useAdvanced(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      setOpen(localStorage.getItem(ADVANCED_KEY) === "1");
    } catch {
      /* storage unavailable */
    }
  }, []);
  const set = (v: boolean) => {
    setOpen(v);
    try {
      localStorage.setItem(ADVANCED_KEY, v ? "1" : "0");
    } catch {
      /* storage unavailable */
    }
  };
  return [open, set];
}

/** Collapsible "More tools" section for brushes, edges and other expert controls. */
export function Advanced({ open, onToggle, children, id }: { open: boolean; onToggle: (v: boolean) => void; children: ReactNode; id: string }) {
  const { t } = useI18n();
  return (
    <section className="rounded-2xl border border-line bg-white">
      <button
        type="button"
        onClick={() => onToggle(!open)}
        aria-expanded={open}
        aria-controls={id}
        data-testid="advanced-toggle"
        className="flex min-h-12 w-full items-center justify-between gap-2 rounded-2xl px-4 text-start font-semibold"
      >
        {t("steps.advanced")}
        <span aria-hidden className={`text-muted transition-transform ${open ? "rotate-180" : ""}`}>
          ▾
        </span>
      </button>
      {open && (
        <div id={id} className="flex flex-col gap-4 border-t border-line p-4">
          {children}
        </div>
      )}
    </section>
  );
}

/** Large "next step" button; `emphasis` makes it pulse once there is something to continue with. */
export function NextButton({ onClick, children, emphasis, testId }: { onClick: () => void; children: ReactNode; emphasis?: boolean; testId: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={`inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl px-5 text-lg font-bold shadow-sm ${
        emphasis ? "bg-brand-600 text-white hover:bg-brand-700" : "border-2 border-brand-600 bg-white text-brand-700 hover:bg-brand-50"
      }`}
    >
      {children}
      <span aria-hidden className="rtl:-scale-x-100">
        →
      </span>
    </button>
  );
}
