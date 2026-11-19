// The Brand page's tabs (?tab=…). Plain module, so the server page can read the tab too.
export const BRAND_TABS = [
  { key: "brand", label: "Brand" },
  { key: "product", label: "Product" },
  { key: "assets", label: "Assets" },
  { key: "settings", label: "Settings" },
] as const;

export type BrandTab = (typeof BRAND_TABS)[number]["key"];

/** The tab a ?tab= value names; anything else is the Brand tab. */
export const brandTab = (value: unknown): BrandTab => BRAND_TABS.find((t) => t.key === value)?.key ?? "brand";

/** The Brand page on a tab (the Brand tab has no ?tab=). */
export const brandTabHref = (productId: string, tab: BrandTab) => `/app/w/${productId}/brand${tab === "brand" ? "" : `?tab=${tab}`}`;
