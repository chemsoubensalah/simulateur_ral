/**
 * Shop branding. Set NEXT_PUBLIC_BRAND_NAME (and optionally
 * NEXT_PUBLIC_SELLER_WHATSAPP) on Vercel to rebrand without code changes.
 */
export const BRAND = {
  name: process.env.NEXT_PUBLIC_BRAND_NAME || "ALSY PAINTS",
};

/** File-name friendly brand, e.g. "alsy-paints". */
export const brandSlug = () => BRAND.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "colors";
