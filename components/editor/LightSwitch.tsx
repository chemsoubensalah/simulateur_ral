"use client";

import { useI18n } from "@/lib/i18n/client";
import { LIGHT_MODES, type LightMode } from "@/lib/recolor/lighting";

/** View the room as photographed, in neutral daylight, or under warm evening lamps. */
export function LightSwitch({ value, onChange }: { value: LightMode; onChange: (m: LightMode) => void }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-1">
      <span id="light-title" className="text-sm font-medium">
        {t("light.title")}
      </span>
      <div role="radiogroup" aria-labelledby="light-title" aria-describedby="light-hint" className="grid grid-cols-3 rounded-xl border border-line bg-white p-1">
        {LIGHT_MODES.map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={value === m}
            onClick={() => onChange(m)}
            data-testid={`light-${m}`}
            className={`min-h-10 rounded-lg px-2 text-sm font-medium ${value === m ? "bg-brand-600 text-white" : "hover:bg-brand-50"}`}
          >
            {t(`light.${m}`)}
          </button>
        ))}
      </div>
      <span id="light-hint" className="text-xs text-muted">
        {t("light.hint")}
      </span>
    </div>
  );
}
