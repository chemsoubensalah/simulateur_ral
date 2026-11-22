import Link from "next/link";
import { notFound } from "next/navigation";
import { isLocale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const m = getMessages(locale);
  const features = [
    [m.home.feature1Title, m.home.feature1Text],
    [m.home.feature2Title, m.home.feature2Text],
    [m.home.feature3Title, m.home.feature3Text],
  ] as const;
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:py-16">
      <section className="text-center">
        <h1 className="text-3xl font-bold leading-tight text-ink sm:text-5xl">{m.home.headline}</h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-muted">{m.home.sub}</p>
        <Link
          href={`/${locale}/editor`}
          className="mt-8 inline-flex min-h-12 items-center rounded-full bg-brand-600 px-8 text-lg font-semibold text-white shadow-sm hover:bg-brand-700"
        >
          {m.home.start}
        </Link>
      </section>
      <section aria-labelledby="how-title" className="mt-12">
        <h2 id="how-title" className="text-center text-xl font-bold">{m.home.howTitle}</h2>
        <ol className="mt-5 grid gap-3 sm:grid-cols-3">
          {[m.home.how1, m.home.how2, m.home.how3].map((text, i) => (
            <li key={text} className="flex items-center gap-3 rounded-2xl bg-brand-50 p-4 text-lg font-semibold text-brand-700">
              <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-600 text-lg text-white">
                {new Intl.NumberFormat(locale === "ar" ? "ar-u-nu-latn" : locale).format(i + 1)}
              </span>
              {text}
            </li>
          ))}
        </ol>
      </section>
      <ul className="mt-10 grid gap-4 sm:grid-cols-3">
        {features.map(([title, text]) => (
          <li key={title} className="rounded-2xl border border-line bg-surface p-5">
            <h2 className="font-semibold">{title}</h2>
            <p className="mt-2 text-sm text-muted">{text}</p>
          </li>
        ))}
      </ul>
      <p className="mt-10 text-center">
        <Link href={`/${locale}/qr`} className="text-sm text-muted underline hover:text-ink" data-testid="qr-link">
          {m.qr.forShop}
        </Link>
      </p>
    </div>
  );
}
