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
        <Link href={`/${locale}`} className="flex min-w-0 items-center gap-2 text-ink sm:gap-2.5" aria-label={BRAND.name}>
          <span aria-hidden className="inline-block h-6 w-6 shrink-0 sm:h-7 sm:w-7 rounded-full bg-[conic-gradient(#e4572e,#f3a712,#29bf12,#1f8a70,#2e86ab,#a23b72,#e4572e)] shadow-inner" />
          <span className="flex min-w-0 flex-col leading-none">
            <span className="whitespace-nowrap text-base font-extrabold tracking-wide sm:text-lg" dir="ltr">
              {BRAND.name}
            </span>
            <span className="hidden whitespace-nowrap text-[11px] font-medium text-muted min-[360px]:block">{t("common.tagline")}</span>
          </span>
        </Link>
        <LanguageSwitcher />
      </div>
    </header>
  );
}
