/**
 * Shop branding. Set NEXT_PUBLIC_BRAND_NAME (and optionally
 * NEXT_PUBLIC_SELLER_WHATSAPP) on Vercel to rebrand without code changes.
 */
export const BRAND = {
  name: process.env.NEXT_PUBLIC_BRAND_NAME || "ALSY PAINTS",
};

/** File-name friendly brand, e.g. "alsy-paints". */
export const brandSlug = () => BRAND.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "colors";

/** Seller's WhatsApp number in international format, digits only (e.g. 213550123456); empty = choose a contact. */
export const SELLER_WHATSAPP = (process.env.NEXT_PUBLIC_SELLER_WHATSAPP ?? "").replace(/\D/g, "");
