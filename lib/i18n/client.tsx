"use client";

import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import type { Locale } from "./config";
import { dirFor } from "./config";
import type { Messages } from "@/messages/en";
import { translate, type MessageKey, type TranslateParams } from "./translate";

type I18nValue = {
  locale: Locale;
  dir: "rtl" | "ltr";
  t: (key: MessageKey, params?: TranslateParams) => string;
  formatNumber: (n: number, opts?: Intl.NumberFormatOptions) => string;
};

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ locale, messages, children }: { locale: Locale; messages: Messages; children: ReactNode }) {
  const t = useCallback((key: MessageKey, params?: TranslateParams) => translate(messages, key, params), [messages]);
  const value = useMemo<I18nValue>(() => {
    const nf = (n: number, opts?: Intl.NumberFormatOptions) =>
      new Intl.NumberFormat(locale === "ar" ? "ar-u-nu-latn" : locale, opts).format(n);
    return { locale, dir: dirFor(locale), t, formatNumber: nf };
  }, [locale, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside <I18nProvider>");
  return ctx;
}
