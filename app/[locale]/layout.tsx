import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import "../globals.css";
import { dirFor, isLocale, locales } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import { I18nProvider } from "@/lib/i18n/client";
import { SiteHeader } from "@/components/SiteHeader";
import { BRAND } from "@/lib/brand";

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const m = getMessages(locale);
  return {
    title: m.meta.title.replace("{brand}", BRAND.name),
    applicationName: BRAND.name,
    description: m.meta.description,
    alternates: { languages: Object.fromEntries(locales.map((l) => [l, `/${l}`])) },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#187259",
};

export default async function LocaleLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const messages = getMessages(locale);
  return (
    <html lang={locale} dir={dirFor(locale)}>
      <body className="antialiased">
        <I18nProvider locale={locale} messages={messages}>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:fixed focus:start-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2"
          >
            {messages.common.skipToContent}
          </a>
          <SiteHeader />
          <main id="main">{children}</main>
        </I18nProvider>
      </body>
    </html>
  );
}
