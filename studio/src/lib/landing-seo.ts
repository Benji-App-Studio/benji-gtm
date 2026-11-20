// What search engines and link previews are told about the public landing page. Only a copy with a
// public address (PUBLIC_ORIGIN / NEXT_PUBLIC_PUBLIC_ORIGIN, or Vercel's production URL) asks to be
// indexed and advertises a share picture; a self-hosted copy without one stays out of search and never
// points at a localhost image. Plain TypeScript (the page, robots.ts and the Node tests share it).

export const OG_SIZE = { width: 1200, height: 630 } as const;
export const OG_PATH = "/og-image";

export interface LandingSeo {
  index: boolean;
  /** For metadataBase and the canonical link; null without a public address. */
  base: URL | null;
  /** The share picture's absolute address, or null to leave it out. */
  image: string | null;
}

export function landingSeo(publicOrigin: string | null | undefined): LandingSeo {
  let base: URL | null = null;
  try { base = publicOrigin ? new URL(new URL(publicOrigin).origin) : null; } catch { base = null; }
  if (!base || (base.protocol !== "https:" && base.protocol !== "http:")) return { index: false, base: null, image: null };
  return { index: true, base, image: new URL(OG_PATH, base).toString() };
}

/** robots.txt: the public pages for a copy with a public address; nothing at all otherwise. */
export function robotsRules(publicOrigin: string | null | undefined): { userAgent: string; allow?: string; disallow: string | string[] } {
  return landingSeo(publicOrigin).index
    ? { userAgent: "*", allow: "/", disallow: ["/app", "/api/", "/auth/", "/onboarding", "/setup", "/update-password", "/switch-account", "/invite", "/preview"] }
    : { userAgent: "*", disallow: "/" };
}
