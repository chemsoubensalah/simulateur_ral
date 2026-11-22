"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/client";
import { colorName, getColor } from "@/lib/color/catalog";
import { BRAND, SELLER_WHATSAPP } from "@/lib/brand";
import type { SurfaceQuantity } from "./QuantityPanel";

type Props = {
  rows: SurfaceQuantity[];
  /** The rendered picture (JPEG), for sharing. */
  getImage: () => Promise<Blob | null>;
};

/** Send the choice (colours, quantities, picture) to the shop. */
export function SendPanel({ rows, getImage }: Props) {
  const { t, locale, formatNumber } = useI18n();
  const [copied, setCopied] = useState(false);
  const fmt1 = (n: number) => formatNumber(n, { maximumFractionDigits: 1 });

  const lines = rows.map(({ surface, area, liters, plan }) => {
    const paint = surface.paintId ? getColor(surface.paintId) : undefined;
    const name = paint ? colorName(paint, locale) : undefined;
    const parts = [`${surface.name}: ${paint?.code ?? surface.hex}${name ? ` — ${name}` : ""} (${t(`color.${surface.finish}`)})`];
    if (area > 0) {
      const cans = plan.map((c) => t("qty.can", { n: formatNumber(c.count), s: formatNumber(c.size) })).join(" + ");
      parts.push(`${t("send.area", { a: fmt1(area) })}${locale === "ar" ? "،" : ","} ${t("send.liters", { l: fmt1(liters) })} → ${cans}`);
    }
    return `• ${parts.join(" — ")}`;
  });
  const text = [t("send.greeting", { brand: BRAND.name }), ...lines].join("\n");
  const waUrl = `https://wa.me/${SELLER_WHATSAPP}?text=${encodeURIComponent(text)}`;

  const share = async () => {
    const blob = await getImage();
    if (!blob) return;
    const file = new File([blob], "colors.jpg", { type: "image/jpeg" });
    try {
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], text, title: BRAND.name });
      else await navigator.share({ text, title: BRAND.name });
    } catch {
      /* cancelled */
    }
  };
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  return (
    <section aria-labelledby="send-title" className="flex flex-col gap-3" data-testid="send">
      <h2 id="send-title" className="text-lg font-bold">
        {t("send.title")}
      </h2>
      <pre className="whitespace-pre-wrap rounded-2xl border border-line bg-white p-3 font-sans text-sm" data-testid="send-text">
        {text}
      </pre>
      <a
        href={waUrl}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="send-whatsapp"
        className="inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-[#25D366] px-5 text-lg font-bold text-white shadow-sm hover:brightness-95"
      >
        <svg viewBox="0 0 24 24" width={24} height={24} fill="currentColor" aria-hidden>
          <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3Z" />
        </svg>
        {t("send.whatsapp")}
      </a>
      <div className="grid grid-cols-2 gap-2">
        {canShare && (
          <button type="button" onClick={share} data-testid="send-share" className="min-h-12 rounded-2xl border border-brand-600 bg-white px-3 font-semibold text-brand-700 hover:bg-brand-50">
            {t("send.share")}
          </button>
        )}
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              /* clipboard unavailable */
            }
          }}
          data-testid="send-copy"
          className={`min-h-12 rounded-2xl border border-line bg-white px-3 font-semibold hover:bg-black/5 ${canShare ? "" : "col-span-2"}`}
        >
          {copied ? `✓ ${t("send.copied")}` : t("send.copy")}
        </button>
      </div>
      {canShare && <p className="text-xs text-muted">{t("send.tip")}</p>}
    </section>
  );
}
