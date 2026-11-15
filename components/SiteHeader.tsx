"use client";

import Link from "next/link";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { useI18n } from "@/lib/i18n/client";

export function SiteHeader() {
  const { t, locale } = useI18n();
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-4">
        <Link href={`/${locale}`} className="flex items-center gap-2 text-lg font-bold text-ink">
          <span aria-hidden className="inline-block h-6 w-6 rounded-full bg-[conic-gradient(#e4572e,#f3a712,#29bf12,#1f8a70,#2e86ab,#a23b72,#e4572e)]" />
          {t("common.appName")}
        </Link>
        <LanguageSwitcher />
      </div>
    </header>
  );
}
