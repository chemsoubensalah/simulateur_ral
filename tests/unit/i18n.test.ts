import { describe, expect, it } from "vitest";
import en from "@/messages/en";
import ar from "@/messages/ar";
import de from "@/messages/de";
import { translate } from "@/lib/i18n/translate";
import { dirFor, isLocale } from "@/lib/i18n/config";

function keys(obj: object, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) => (typeof v === "string" ? [`${prefix}${k}`] : keys(v as object, `${prefix}${k}.`)));
}

function placeholders(obj: object): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const walk = (o: object, p: string) =>
    Object.entries(o).forEach(([k, v]) =>
      typeof v === "string" ? (out[`${p}${k}`] = (v.match(/\{\w+\}/g) ?? []).sort()) : walk(v as object, `${p}${k}.`),
    );
  walk(obj, "");
  return out;
}

describe("i18n", () => {
  it("all locales have the same keys and non-empty strings", () => {
    const base = keys(en).sort();
    for (const m of [ar, de]) {
      expect(keys(m).sort()).toEqual(base);
      for (const k of keys(m)) expect(translate(m, k as never).trim().length).toBeGreaterThan(0);
    }
  });

  it("all locales use the same placeholders", () => {
    const base = placeholders(en);
    expect(placeholders(ar)).toEqual(base);
    expect(placeholders(de)).toEqual(base);
  });

  it("interpolates parameters", () => {
    expect(translate(en, "surfaces.defaultName", { n: 3 })).toBe("Surface 3");
    expect(translate(ar, "surfaces.defaultName", { n: 3 })).toBe("سطح 3");
  });

  it("Arabic is RTL, others LTR", () => {
    expect(dirFor("ar")).toBe("rtl");
    expect(dirFor("de")).toBe("ltr");
    expect(isLocale("fr")).toBe(false);
  });
});
