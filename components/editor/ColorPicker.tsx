"use client";

import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import {
  closestColors,
  COLOR_FAMILIES,
  colorName,
  getCatalog,
  matchQuality,
  searchColors,
  type CollectionId,
  type ColorFamily,
  type PaintColor,
} from "@/lib/color/catalog";
import { hexToLab, isValidHex, labToRgb, rgbToHex, type Lab } from "@/lib/color/lab";
import { HARMONIES, STYLES, stylePalette, suggestPalette, type Harmony } from "@/lib/color/palettes";
import type { Surface } from "./types";

export type PickerTab = "catalog" | "ideas" | "match";

type Props = {
  surface: Surface;
  surfaceCount: number;
  tab: PickerTab;
  onTab: (t: PickerTab) => void;
  onPick: (p: PaintColor) => void;
  onCustom: (hex: string) => void;
  onApplyPalette: (paints: PaintColor[]) => void;
  /** Colour picked from the photo with the eyedropper (hex). */
  picked: string | null;
  onPicked: (hex: string | null) => void;
  eyedropper: boolean;
  onEyedropper: (on: boolean) => void;
  /** Dominant colours of the photo outside the painted surfaces (computed lazily). */
  photoColors: () => Lab[];
};

type Scope = CollectionId | "all";

const FAMILY_DOT: Record<ColorFamily, string> = {
  white: "#F7F7F2",
  grey: "#9A9C9A",
  black: "#1E1E1E",
  beige: "#D9C7A4",
  brown: "#7A4E2D",
  yellow: "#F2C230",
  orange: "#EB7B21",
  red: "#C42B2B",
  pink: "#E9A0B0",
  violet: "#7B4E9A",
  blue: "#2F67B0",
  turquoise: "#2AA6A6",
  green: "#3E8E41",
};

const PAGE = 64;

export function ColorPicker(p: Props) {
  const { t } = useI18n();
  const tabs: { id: PickerTab; label: string }[] = [
    { id: "catalog", label: t("color.tabCatalog") },
    { id: "ideas", label: t("color.tabIdeas") },
    { id: "match", label: t("color.tabMatch") },
  ];
  return (
    <div className="flex flex-col gap-3">
      <div role="tablist" aria-label={t("color.tabs")} className="grid grid-cols-3 rounded-xl border border-line bg-white p-1">
        {tabs.map((tb) => (
          <button
            key={tb.id}
            type="button"
            role="tab"
            id={`tab-${tb.id}`}
            aria-selected={p.tab === tb.id}
            aria-controls={`panel-${tb.id}`}
            data-testid={`tab-${tb.id}`}
            onClick={() => p.onTab(tb.id)}
            className={`min-h-10 rounded-lg px-2 text-sm font-medium ${p.tab === tb.id ? "bg-brand-600 text-white" : "hover:bg-brand-50"}`}
          >
            {tb.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${p.tab}`} aria-labelledby={`tab-${p.tab}`}>
        {p.tab === "catalog" && <CatalogTab {...p} />}
        {p.tab === "ideas" && <IdeasTab {...p} />}
        {p.tab === "match" && <MatchTab {...p} />}
      </div>
    </div>
  );
}

/* ---------------- shared bits ---------------- */

function ScopeSwitch({ scope, onScope, withAll = true }: { scope: Scope; onScope: (s: Scope) => void; withAll?: boolean }) {
  const { t } = useI18n();
  const options: { id: Scope; label: string }[] = [
    { id: "ral-classic", label: "RAL Classic" },
    { id: "ncs", label: "NCS" },
    ...(withAll ? [{ id: "all" as const, label: t("color.all") }] : []),
  ];
  return (
    <div role="radiogroup" aria-label={t("color.collection")} className="flex w-fit rounded-xl border border-line bg-white p-1">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={scope === o.id}
          data-testid={`scope-${o.id}`}
          onClick={() => onScope(o.id)}
          className={`min-h-9 rounded-lg px-3 text-sm font-medium ${scope === o.id ? "bg-ink text-white" : "hover:bg-black/5"}`}
          dir="ltr"
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Swatch({ color, selected, onClick, size = "md", showCode = false }: { color: PaintColor; selected?: boolean; onClick: () => void; size?: "md" | "lg"; showCode?: boolean }) {
  const { locale } = useI18n();
  const name = colorName(color, locale);
  const label = name ? `${color.code} — ${name}` : color.code;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={selected}
      title={label}
      data-code={color.code}
      data-hex={color.hex}
      className="group flex min-w-0 flex-col items-stretch gap-1 text-start"
    >
      <span
        className={`block rounded-lg border border-black/10 ${size === "lg" ? "h-14" : "aspect-square"} ${selected ? "ring-2 ring-brand-600 ring-offset-2" : "group-hover:ring-2 group-hover:ring-black/20"}`}
        style={{ background: color.hex }}
      />
      {showCode && (
        <span className="truncate text-[11px] leading-tight text-muted" dir="ltr">
          {color.code.replace(/^RAL /, "").replace(/^S /, "")}
        </span>
      )}
    </button>
  );
}

function useScope(): [Scope, (s: Scope) => void] {
  // Remember the preferred collection across tabs and visits.
  const [scope, setScope] = useState<Scope>("ral-classic");
  useEffect(() => {
    try {
      const v = localStorage.getItem("cv-scope");
      if (v === "ral-classic" || v === "ncs" || v === "all") setScope(v);
    } catch {
      /* storage unavailable */
    }
  }, []);
  const update = (s: Scope) => {
    setScope(s);
    try {
      localStorage.setItem("cv-scope", s);
    } catch {
      /* storage unavailable */
    }
  };
  return [scope, update];
}

/* ---------------- catalogue ---------------- */

function CatalogTab({ surface, onPick }: Props) {
  const { t, formatNumber } = useI18n();
  const [scope, setScope] = useScope();
  const [query, setQuery] = useState("");
  const [family, setFamily] = useState<ColorFamily | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const results = useMemo(() => searchColors(query, { collection: scope, family, includeSpecial: true }), [query, scope, family]);
  useEffect(() => setLimit(PAGE), [query, scope, family]);

  return (
    <div className="flex flex-col gap-3">
      <ScopeSwitch scope={scope} onScope={setScope} />
      <label className="flex flex-col gap-1 text-sm font-medium">
        {t("color.search")}
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("color.searchPlaceholder")}
          className="h-11 rounded-lg border border-line bg-white px-3 text-base"
          data-testid="color-search"
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <div role="radiogroup" aria-label={t("color.family")} className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        <FamilyChip active={family === null} onClick={() => setFamily(null)} label={t("color.allFamilies")} />
        {COLOR_FAMILIES.map((f) => (
          <FamilyChip key={f} active={family === f} onClick={() => setFamily(family === f ? null : f)} label={t(`families.${f}`)} dot={FAMILY_DOT[f]} testId={`family-${f}`} />
        ))}
      </div>
      <p className="text-xs text-muted" aria-live="polite">
        {results.length ? t("color.results", { n: formatNumber(results.length) }) : t("color.noResults")}
      </p>
      <div
        className={`grid gap-1.5 ${scope === "ral-classic" ? "grid-cols-7 sm:grid-cols-10 lg:grid-cols-7" : "grid-cols-5 sm:grid-cols-8 lg:grid-cols-5"}`}
        data-testid="catalog-grid"
      >
        {results.slice(0, limit).map((c) => (
          <Swatch key={c.id} color={c} selected={surface.paintId === c.id} onClick={() => onPick(c)} showCode />
        ))}
      </div>
      {results.length > limit && (
        <button type="button" onClick={() => setLimit((l) => l + PAGE * 2)} className="min-h-10 rounded-lg border border-line bg-white text-sm font-medium hover:bg-black/5">
          {t("color.showMore")}
        </button>
      )}
      <p className="text-xs text-muted">
        {t("color.approximate")} {scope !== "ral-classic" && t("color.ncsCalculated")}
      </p>
    </div>
  );
}

function FamilyChip({ active, onClick, label, dot, testId }: { active: boolean; onClick: () => void; label: string; dot?: string; testId?: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      data-testid={testId}
      className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium ${
        active ? "border-ink bg-ink text-white" : "border-line bg-white hover:bg-black/5"
      }`}
    >
      {dot && <span className="h-3 w-3 rounded-full border border-black/15" style={{ background: dot }} aria-hidden />}
      {label}
    </button>
  );
}

/* ---------------- ideas ---------------- */

function IdeasTab({ surface, surfaceCount, onPick, onApplyPalette, photoColors }: Props) {
  const { t } = useI18n();
  const [scope, setScope] = useScope();
  const [harmony, setHarmony] = useState<Harmony>("complementary");
  // Photo colours and the "current colour" base are captured when the tab opens
  // (or the surface changes), so trying palette colours doesn't regenerate the palette.
  const [photo] = useState(() => photoColors());
  const [current, setCurrent] = useState(() => (surface.lab && surface.hex ? { lab: surface.lab, hex: surface.hex } : null));
  useEffect(() => {
    setCurrent(surface.lab && surface.hex ? { lab: surface.lab, hex: surface.hex } : null);
    // Only when switching to another surface.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surface.id]);
  const bases = useMemo(() => {
    const list: { key: string; lab: Lab; hex: string; label: string }[] = [];
    if (current) list.push({ key: "current", lab: current.lab, hex: current.hex, label: t("color.currentColor") });
    photo.forEach((lab, i) => list.push({ key: `photo-${i}`, lab, hex: rgbToHex(labToRgb(lab)), label: t("color.photoColors") }));
    return list;
  }, [current, photo, t]);
  const [baseKey, setBaseKey] = useState<string>("current");
  const base = bases.find((b) => b.key === baseKey) ?? bases[0];
  const palette = useMemo(() => (base ? suggestPalette(base.lab, harmony, scope === "all" ? "all" : scope) : []), [base, harmony, scope]);

  return (
    <div className="flex flex-col gap-4">
      <ScopeSwitch scope={scope} onScope={setScope} />

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">{t("color.basedOn")}</legend>
        <div className="flex flex-wrap gap-2" data-testid="idea-bases">
          {bases.map((b) => (
            <button
              key={b.key}
              type="button"
              aria-pressed={b.key === base?.key}
              onClick={() => setBaseKey(b.key)}
              title={b.label}
              aria-label={`${b.label} ${b.hex}`}
              data-testid={`base-${b.key}`}
              className={`h-10 w-10 rounded-full border-2 ${b.key === base?.key ? "border-brand-600 ring-2 ring-brand-600/30" : "border-white shadow"}`}
              style={{ background: b.hex }}
            />
          ))}
        </div>
        <p className="text-xs text-muted">{photo.length ? t("color.photoColors") : t("color.noPhotoColors")}</p>
      </fieldset>

      <div role="radiogroup" aria-label={t("color.harmony")} className="flex flex-wrap gap-1.5">
        {HARMONIES.map((h) => (
          <button
            key={h}
            type="button"
            role="radio"
            aria-checked={harmony === h}
            onClick={() => setHarmony(h)}
            data-testid={`harmony-${h}`}
            className={`min-h-9 rounded-full border px-3 text-xs font-medium ${harmony === h ? "border-ink bg-ink text-white" : "border-line bg-white hover:bg-black/5"}`}
          >
            {t(`color.${h}`)}
          </button>
        ))}
      </div>

      <PaletteRow paints={palette} surfaceCount={surfaceCount} selectedId={surface.paintId} onPick={onPick} onApply={onApplyPalette} testId="harmony-palette" />

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-medium">{t("color.styles")}</h3>
        {STYLES.map((s) => (
          <div key={s} className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-muted">{t(`color.${s}`)}</span>
            <PaletteRow
              paints={stylePalette(s, scope === "all" ? "ral-classic" : scope)}
              surfaceCount={surfaceCount}
              selectedId={surface.paintId}
              onPick={onPick}
              onApply={onApplyPalette}
              testId={`style-${s}`}
              compact
            />
          </div>
        ))}
      </section>
    </div>
  );
}

function PaletteRow({
  paints,
  surfaceCount,
  selectedId,
  onPick,
  onApply,
  testId,
  compact = false,
}: {
  paints: PaintColor[];
  surfaceCount: number;
  selectedId: string | null;
  onPick: (p: PaintColor) => void;
  onApply: (p: PaintColor[]) => void;
  testId: string;
  compact?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-2" data-testid={testId}>
      <div className="grid grid-cols-5 gap-1.5">
        {paints.map((c) => (
          <Swatch key={c.id} color={c} selected={selectedId === c.id} onClick={() => onPick(c)} size={compact ? "md" : "lg"} showCode />
        ))}
      </div>
      {surfaceCount > 1 && !compact && (
        <button type="button" onClick={() => onApply(paints)} data-testid={`${testId}-apply`} className="min-h-10 w-fit rounded-lg border border-brand-600 bg-white px-3 text-sm font-medium text-brand-700 hover:bg-brand-50">
          {t("color.applyPalette")}
        </button>
      )}
    </div>
  );
}

/* ---------------- match ---------------- */

function MatchTab({ surface, onPick, onCustom, picked, onPicked, eyedropper, onEyedropper }: Props) {
  const { t, locale, formatNumber } = useI18n();
  const [scope, setScope] = useScope();
  const target = picked ?? surface.hex ?? "#FFFFFF";
  const [hexText, setHexText] = useState(target);
  useEffect(() => setHexText(target), [target]);
  const matches = useMemo(() => {
    getCatalog();
    return closestColors(hexToLab(target), { collection: scope, limit: 6 });
  }, [target, scope]);
  const qualityLabel = (d: number) => {
    const q = matchQuality(d);
    return t(q === "exact" ? "color.exact" : q === "veryClose" ? "color.veryClose" : q === "close" ? "color.close" : "color.approximateMatch");
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm font-medium">
          {t("color.custom")}
          <input
            type="color"
            value={target}
            onChange={(e) => onPicked(e.target.value.toUpperCase())}
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
              if (isValidHex(v) && v.replace("#", "").length === 6) onPicked(`#${v.replace("#", "").toUpperCase()}`);
            }}
            placeholder="#RRGGBB"
            maxLength={7}
            className="h-11 w-28 rounded-lg border border-line bg-white px-2 font-mono uppercase"
            data-testid="hex-input"
          />
        </label>
        <button
          type="button"
          onClick={() => onEyedropper(!eyedropper)}
          aria-pressed={eyedropper}
          data-testid="eyedropper"
          className={`min-h-11 rounded-lg border px-3 text-sm font-medium ${eyedropper ? "border-brand-600 bg-brand-600 text-white" : "border-brand-600 bg-white text-brand-700 hover:bg-brand-50"}`}
        >
          {t("color.eyedropper")}
        </button>
      </div>
      {eyedropper && <p className="text-xs text-brand-700">{t("color.eyedropperHint")}</p>}

      <div className="flex items-center gap-3 rounded-xl border border-line bg-white p-2">
        <span className="h-10 w-10 shrink-0 rounded-lg border border-black/10" style={{ background: target }} aria-hidden />
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-medium">{t("color.picked")}</p>
          <p className="font-mono text-xs text-muted" dir="ltr" data-testid="picked-hex">
            {target}
          </p>
        </div>
        {picked && (
          <button type="button" onClick={() => onCustom(picked)} className="min-h-9 shrink-0 rounded-lg border border-line px-3 text-xs font-medium hover:bg-black/5">
            {t("color.use")}
          </button>
        )}
      </div>

      <ScopeSwitch scope={scope} onScope={setScope} />
      <h3 className="text-sm font-medium">{t("color.closest")}</h3>
      <ul className="flex flex-col gap-1.5" data-testid="closest-list">
        {matches.map((m) => {
          const name = colorName(m.color, locale);
          return (
            <li key={m.color.id} className="flex items-center gap-3 rounded-xl border border-line bg-white p-2">
              <span className="h-10 w-10 shrink-0 rounded-lg border border-black/10" style={{ background: m.color.hex }} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  <span dir="ltr">{m.color.code}</span>
                  {name && <span className="text-muted"> · {name}</span>}
                </p>
                <p className="text-xs text-muted">
                  {qualityLabel(m.deltaE)} · <span dir="ltr">ΔE₀₀ {formatNumber(m.deltaE, { maximumFractionDigits: 1 })}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => onPick(m.color)}
                data-testid={`use-${m.color.code}`}
                className="min-h-9 shrink-0 rounded-lg bg-brand-600 px-3 text-xs font-semibold text-white hover:bg-brand-700"
              >
                {t("color.use")}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
