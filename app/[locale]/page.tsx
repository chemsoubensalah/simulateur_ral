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
      <ul className="mt-14 grid gap-4 sm:grid-cols-3">
        {features.map(([title, text]) => (
          <li key={title} className="rounded-2xl border border-line bg-surface p-5">
            <h2 className="font-semibold">{title}</h2>
            <p className="mt-2 text-sm text-muted">{text}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
