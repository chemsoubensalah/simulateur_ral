"use client";

import Link from "next/link";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { useI18n } from "@/lib/i18n/client";
import { BRAND } from "@/lib/brand";

export function SiteHeader() {
  const { t, locale } = useI18n();
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-white/90 backdrop-blur print:hidden">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-4">
        <Link href={`/${locale}`} className="flex items-center gap-2.5 text-ink" aria-label={BRAND.name}>
          <span aria-hidden className="inline-block h-7 w-7 shrink-0 rounded-full bg-[conic-gradient(#e4572e,#f3a712,#29bf12,#1f8a70,#2e86ab,#a23b72,#e4572e)] shadow-inner" />
          <span className="flex flex-col leading-none">
            <span className="text-lg font-extrabold tracking-wide" dir="ltr">
              {BRAND.name}
            </span>
            <span className="text-[11px] font-medium text-muted">{t("common.tagline")}</span>
          </span>
        </Link>
        <LanguageSwitcher />
      </div>
    </header>
  );
}
