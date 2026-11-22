import { headers } from "next/headers";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { isLocale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";
import { BRAND, SELLER_WHATSAPP } from "@/lib/brand";
import { PrintButton } from "@/components/PrintButton";

export const dynamic = "force-dynamic";

/** Where the QR code points: NEXT_PUBLIC_SITE_URL, else this deployment's own address. */
async function siteUrl(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "");
  if (configured) return configured;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/** Printable poster for the shop counter: scan → try the colours on your own wall. */
export default async function QrPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const m = getMessages(locale);
  const url = `${await siteUrl()}/${locale}/editor`;
  const svg = await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#0f2f27", light: "#ffffff" } });
  const steps = [m.home.how1, m.home.how2, m.home.how3];
  const num = new Intl.NumberFormat(locale === "ar" ? "ar-u-nu-latn" : locale);

  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-6 px-4 py-8 text-center print:max-w-none print:py-0">
      <p className="text-4xl font-extrabold tracking-wide text-brand-700" dir="ltr">
        {BRAND.name}
      </p>
      <h1 className="text-3xl font-bold leading-tight">{m.qr.title}</h1>
      <div
        className="w-72 max-w-full rounded-3xl border-4 border-brand-600 bg-white p-4 print:w-[85mm]"
        data-testid="qr-code"
        data-url={url}
        role="img"
        aria-label={url}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <p className="text-xl font-semibold">📱 {m.qr.scan}</p>
      <ol className="flex w-full flex-col gap-2 text-start">
        {steps.map((s, i) => (
          <li key={s} className="flex items-center gap-3 rounded-2xl bg-brand-50 p-3 text-lg font-semibold text-brand-700">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white">{num.format(i + 1)}</span>
            {s}
          </li>
        ))}
      </ol>
      <p className="text-lg">{m.qr.free}</p>
      {SELLER_WHATSAPP && (
        <p className="text-lg font-semibold" dir="auto">
          {m.qr.whatsapp.replace("{n}", `+${SELLER_WHATSAPP}`)}
        </p>
      )}
      <p className="break-all text-sm text-muted" dir="ltr">
        {url}
      </p>
      <PrintButton label={m.qr.print} />
    </div>
  );
}
