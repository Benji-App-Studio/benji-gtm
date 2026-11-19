// The insight function's pure parts (no network): which links are safe to open, reading a page's
// text, title, links and colours out of its HTML, picking the subpages worth reading, App Store and
// Google Play links, and the shape OpenAI answers in. Tested in core_test.ts.

// MARK: Links

/** Hosts and addresses never fetched: this machine, private networks, cloud metadata. */
export function isPublicUrl(raw: string): boolean {
  let url: URL;
  try { url = new URL(raw); } catch { return false; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  if (url.username || url.password) return false;
  if (url.port && url.port !== "80" && url.port !== "443") return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host.includes(".") || host === "localhost" || /\.(localhost|local|internal|lan|home|corp)$/.test(host)) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b] = host.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224) return false;
  }
  if (host.includes(":")) return false; // IPv6 literals: none of ours need them.
  return true;
}

/** "volt.drinks", "www.x.com/about " → a full https link; null when it isn't a link. */
export function normalizeUrl(raw: string): string | null {
  const text = raw.trim().replace(/[),.;]+$/, "");
  if (!text || /\s/.test(text)) return null;
  const withScheme = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  try {
    const url = new URL(withScheme);
    url.hash = "";
    return isPublicUrl(url.toString()) ? url.toString() : null;
  } catch {
    return null;
  }
}

/** The links to read: the website, the extra links, and the brand kit's App Store link, deduplicated. */
export function linksOf(p: { website: string | null; links: string[] | null; brand_kit: Record<string, unknown> | null }, max = 8): string[] {
  const raw = [p.website ?? "", ...(p.links ?? []), typeof p.brand_kit?.appStoreUrl === "string" ? p.brand_kit.appStoreUrl : ""];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const url = normalizeUrl(item);
    const key = url?.replace(/\/$/, "").toLowerCase();
    if (!url || !key || seen.has(key)) continue;
    seen.add(key);
    out.push(url);
  }
  return out.slice(0, max);
}

export type LinkKind = "app_store" | "google_play" | "website";

export function linkKind(url: string): LinkKind {
  const host = new URL(url).hostname.toLowerCase();
  if (host === "apps.apple.com" || host === "itunes.apple.com") return "app_store";
  if (host === "play.google.com") return "google_play";
  return "website";
}

/** The App Store id in a listing link (…/id1234567890). */
export const appStoreId = (url: string) => url.match(/\/id(\d{5,15})(?:[/?#]|$)/)?.[1] ?? null;
/** The store country in a listing link (apps.apple.com/gb/app/…), default us. */
export const appStoreCountry = (url: string) => new URL(url).pathname.match(/^\/([a-z]{2})\//)?.[1] ?? "us";
/** The package in a Google Play link (?id=com.example.app). */
export const playPackage = (url: string) => new URL(url).searchParams.get("id")?.match(/^[A-Za-z0-9._]{3,150}$/)?.[0] ?? null;

/** Subpages worth reading, best first; legal pages, logins, carts and files are skipped. */
const GOOD = /\b(about|story|mission|company|team|pricing|plans?|features?|product|how[-_]?it[-_]?works|solutions?|use[-_]?cases?|customers?|testimonials?|reviews?|faq|help|why|benefits?|compare|vs|science|research|security|download|app)\b/i;
const SKIP = /\b(login|log-in|signin|sign-in|signup|sign-up|register|account|cart|checkout|privacy|terms|cookie|legal|gdpr|careers?|jobs|press-kit|wp-admin|feed|rss|cdn-cgi|unsubscribe)\b|\.(pdf|zip|png|jpe?g|gif|webp|svg|mp4|mov|xml|json|css|js)(\?|$)/i;

export function rankSubpages(base: string, links: string[], limit: number): string[] {
  const origin = new URL(base).origin;
  const root = new URL(base).toString().replace(/\/$/, "");
  const seen = new Set<string>([root]);
  const scored: { url: string; score: number }[] = [];
  for (const href of links) {
    let url: URL;
    try { url = new URL(href, base); } catch { continue; }
    if (url.origin !== origin) continue;
    url.hash = "";
    url.search = "";
    const clean = url.toString().replace(/\/$/, "");
    if (seen.has(clean) || SKIP.test(url.pathname)) continue;
    seen.add(clean);
    const depth = url.pathname.split("/").filter(Boolean).length;
    if (depth > 3) continue;
    const blog = /\b(blog|news|articles?|posts?)\b/i.test(url.pathname);
    const score = (GOOD.test(url.pathname) ? 10 : 0) - depth * 2 - (blog ? 6 : 0) - (/\/[a-z]{2}(-[a-z]{2})?\//i.test(`${url.pathname}/`) && depth > 1 ? 4 : 0);
    scored.push({ url: clean, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((s) => s.url);
}

/** Page links listed in a sitemap.xml (for sites whose pages are built in the browser). */
export function sitemapLinks(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => decodeEntities(m[1])).slice(0, 500);
}

// MARK: Reading a page

export interface PageRead {
  url: string;
  title: string;
  description: string;
  headings: string[];
  text: string;
  links: string[];
  ogImage: string | null;
  themeColor: string | null;
  /** Structured data (JSON-LD) the page declares, trimmed. */
  structured: string[];
  socials: string[];
  stylesheets: string[];
  /** Inline <style> blocks and style="" attributes, for colours. */
  inlineCss: string;
  /** Pictures on the page (originals), biggest first by the size the page declares, with their alt text. */
  images: { url: string; alt: string; size: number | null }[];
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", mdash: "—", ndash: "–", hellip: "…" };
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : all;
    }
    return ENTITIES[code.toLowerCase()] ?? all;
  });
}

const squash = (s: string) => decodeEntities(s).replace(/\s+/g, " ").trim();
const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"))?.slice(2).find((v) => v != null) ?? null;

function meta(html: string, key: string): string | null {
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const name = (attr(tag, "name") ?? attr(tag, "property") ?? "").toLowerCase();
    if (name === key) return squash(attr(tag, "content") ?? "") || null;
  }
  return null;
}

const SOCIAL_HOSTS = /^(?:www\.)?(instagram\.com|tiktok\.com|youtube\.com|x\.com|twitter\.com|linkedin\.com|facebook\.com|threads\.net|pinterest\.com)$/i;

export function readPage(url: string, rawHtml: string): PageRead {
  const html = rawHtml.slice(0, 900_000);
  const head = html.slice(0, html.search(/<body\b/i) > 0 ? html.search(/<body\b/i) : 60_000);
  const title = squash(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "") || meta(head, "og:title") || "";
  const description = meta(head, "description") ?? meta(head, "og:description") ?? "";
  const ogRaw = meta(head, "og:image") ?? meta(head, "twitter:image");
  const resolve = (href: string | null) => {
    if (!href) return null;
    try { return new URL(decodeEntities(href), url).toString(); } catch { return null; }
  };
  const structured = [...html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
    .map((m) => m[1].replace(/\s+/g, " ").trim().slice(0, 1500)).filter(Boolean).slice(0, 4);
  const stylesheets = [...head.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]).filter((tag) => /rel\s*=\s*["']?[^"'>]*stylesheet/i.test(tag))
    .map((tag) => resolve(attr(tag, "href"))).filter((u): u is string => Boolean(u)).slice(0, 6);
  const inlineCss = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n").slice(0, 200_000)
    + "\n" + [...html.matchAll(/\bstyle\s*=\s*"([^"]{0,400})"/gi)].map((m) => m[1]).join(";\n").slice(0, 60_000);

  const body = html
    .replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const headings = [...body.matchAll(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi)].map((m) => squash(m[2].replace(/<[^>]+>/g, " "))).filter((h) => h.length > 1 && h.length < 200).slice(0, 40);
  const hrefs = [...body.matchAll(/<a\b[^>]*\bhref\s*=\s*("([^"]*)"|'([^']*)')/gi)].map((m) => m[2] ?? m[3]).filter((h): h is string => Boolean(h) && !/^(mailto|tel|javascript|#)/i.test(h));
  const links = hrefs.map((h) => resolve(h)).filter((u): u is string => Boolean(u));
  // Links in the page, plus social profile URLs anywhere in the HTML: JSON-LD sameAs, footers built
  // by scripts, embedded page data.
  const inHtml = [...html.matchAll(/https?:\\?\/\\?\/(?:www\.|m\.)?(?:instagram\.com|tiktok\.com|youtube\.com|x\.com|twitter\.com|linkedin\.com|facebook\.com|threads\.net|pinterest\.com)\\?\/[^"'\s<>\\)]+/gi)]
    .map((m) => decodeEntities(m[0].replace(/\\\//g, "/")));
  const socials = [...new Set([...links, ...inHtml].filter((l) => { try { return SOCIAL_HOSTS.test(new URL(l).hostname); } catch { return false; } }))].slice(0, 24);
  const text = squash(body
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/section|\/tr)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .slice(0, 40_000);

  return { url, title, description, headings, text, links, ogImage: resolve(ogRaw), themeColor: hexOf(meta(head, "theme-color") ?? meta(head, "msapplication-tilecolor") ?? ""), structured, socials, stylesheets, inlineCss, images: pageImages(body, resolve) };
}

// MARK: Pictures

/** The largest candidate in a srcset ("a.jpg 400w, b.jpg 1200w" → b.jpg). */
export function largestFromSrcset(srcset: string): string | null {
  let best: { url: string; size: number } | null = null;
  for (const part of srcset.split(/,\s+(?=\S)/)) {
    const [url, descriptor = ""] = part.trim().split(/\s+/);
    if (!url) continue;
    const size = Number(descriptor.replace(/[wx]$/, "")) * (descriptor.endsWith("x") ? 1000 : 1) || 1;
    if (!best || size > best.size) best = { url, size };
  }
  return best?.url ?? null;
}

/** Image URLs that are never product pictures: icons, sprites, tracking pixels, flags, badges. */
const NOT_A_PICTURE = /(favicon|sprite|pixel|spacer|placeholder|blank|loader|spinner|arrow|chevron|caret|flag|badge|rating|stars?[-_.]|avatar[-_]?default|icon[-_.]|[-_/]icons?[-_/.]|logo[-_.]|[-_/]logos?[-_/.]|app-?store|google-?play|download-on|get-it-on|qr[-_.]|tracking|1x1|emoji)/i;

/** Size and quality settings image CDNs take in the query; without them the original comes back. */
const SIZE_PARAMS = new Set(["w", "h", "width", "height", "q", "quality", "fit", "auto", "rect", "blur", "dpr", "crop", "fm", "format", "ixlib", "s", "sz", "resize", "max-w", "max-h"]);

/**
 * The original behind an image link: image optimizers (Next.js /_next/image, Vercel /_vercel/image,
 * Cloudflare /cdn-cgi/image/…) are unwrapped to the image they serve, and resizing settings are dropped
 * (Sanity, imgix, Shopify, Contentful…), so the full-size picture is fetched and two sizes of one
 * picture count as one. Null when it isn't an http(s) link.
 */
export function originalImage(raw: string, base: string): string | null {
  let url: URL;
  try { url = new URL(raw, base); } catch { return null; }
  for (let i = 0; i < 3; i++) {
    const wrapped = /\/(_next|_vercel)\/image\/?$/.test(url.pathname) ? url.searchParams.get("url") : null;
    const cloudflare = url.pathname.match(/^\/cdn-cgi\/image\/[^/]+\/(.+)$/)?.[1];
    const inner = wrapped ?? (cloudflare ? (/^https?:/i.test(cloudflare) ? cloudflare : `/${cloudflare.replace(/^\/+/, "")}`) : null);
    if (!inner) break;
    try { url = new URL(inner, url.origin); } catch { return null; }
  }
  if (!/^https?:$/.test(url.protocol)) return null;
  for (const key of [...url.searchParams.keys()]) if (SIZE_PARAMS.has(key.toLowerCase())) url.searchParams.delete(key);
  url.hash = "";
  return url.toString();
}

/** Pictures in a page body: <img> (src, data-src, srcset), <picture><source>, inline background images. */
export function pageImages(body: string, resolve: (href: string | null) => string | null): { url: string; alt: string; size: number | null }[] {
  const out: { url: string; alt: string; size: number | null }[] = [];
  const seen = new Set<string>();
  const add = (raw: string | null, alt = "", size: number | null = null) => {
    // Shown smaller than this (icons, avatars, list bullets), it isn't a picture worth keeping.
    if (size != null && size < 160) return;
    if (!raw || /^data:/i.test(raw)) return;
    const resolved = resolve(raw);
    const url = resolved ? originalImage(resolved, resolved) : null;
    if (!url || /\.(svg|gif)(\?|$)/i.test(url)) return;
    const path = new URL(url).pathname;
    if (seen.has(url) || NOT_A_PICTURE.test(path)) return;
    seen.add(url);
    out.push({ url, alt: squash(alt).slice(0, 160), size });
  };
  // The width the page shows it at (its width attribute); srcset widths are only what can be requested.
  const declared = (tag: string) => {
    const width = Number(attr(tag, "width"));
    return Number.isFinite(width) && width > 0 ? width : null;
  };
  for (const m of body.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const srcset = attr(tag, "srcset") ?? attr(tag, "data-srcset");
    add((srcset && largestFromSrcset(decodeEntities(srcset))) || attr(tag, "data-src") || attr(tag, "src"), attr(tag, "alt") ?? "", declared(tag));
  }
  for (const m of body.matchAll(/<source\b[^>]*>/gi)) {
    const srcset = attr(m[0], "srcset");
    if (srcset) add(largestFromSrcset(decodeEntities(srcset)));
  }
  for (const m of body.matchAll(/background(?:-image)?\s*:\s*url\((['"]?)([^'")]+)\1\)/gi)) add(m[2]);
  // Biggest first (pictures with no declared size count as mid-sized), then page order.
  return out.map((o, i) => ({ o, i })).sort((a, b) => (b.o.size ?? 500) - (a.o.size ?? 500) || a.i - b.i).map(({ o }) => o).slice(0, 80);
}

/** Width and height of a PNG, JPEG or WebP from its first bytes; null for anything else. */
export function imageSize(bytes: Uint8Array): { width: number; height: number; mime: string } | null {
  const b = bytes;
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return { width: (b[16] << 24 | b[17] << 16 | b[18] << 8 | b[19]) >>> 0, height: (b[20] << 24 | b[21] << 16 | b[22] << 8 | b[23]) >>> 0, mime: "image/png" };
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      const length = b[i + 2] << 8 | b[i + 3];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: b[i + 5] << 8 | b[i + 6], width: b[i + 7] << 8 | b[i + 8], mime: "image/jpeg" };
      }
      i += 2 + length;
    }
    return null;
  }
  if (b.length > 30 && String.fromCharCode(...b.subarray(0, 4)) === "RIFF" && String.fromCharCode(...b.subarray(8, 12)) === "WEBP") {
    const chunk = String.fromCharCode(...b.subarray(12, 16));
    if (chunk === "VP8 ") return { width: (b[26] | b[27] << 8) & 0x3fff, height: (b[28] | b[29] << 8) & 0x3fff, mime: "image/webp" };
    if (chunk === "VP8L") {
      const bits = b[21] | b[22] << 8 | b[23] << 16 | b[24] << 24;
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1, mime: "image/webp" };
    }
    if (chunk === "VP8X") return { width: 1 + (b[24] | b[25] << 8 | b[26] << 16), height: 1 + (b[27] | b[28] << 8 | b[29] << 16), mime: "image/webp" };
  }
  return null;
}

// MARK: Colours

/** "#abc", "#AABBCC", "rgb(1, 2, 3)" → "#RRGGBB"; null otherwise (alpha dropped). */
export function hexOf(value: string): string | null {
  const v = value.trim();
  const short = v.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toUpperCase();
  const long = v.match(/^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i);
  if (long) return `#${long[1]}`.toUpperCase();
  const rgb = v.match(/^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/i);
  if (rgb) {
    const parts = rgb.slice(1, 4).map(Number);
    if (parts.some((n) => n > 255)) return null;
    return `#${parts.map((n) => n.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
  }
  return null;
}

/** True for whites, blacks and greys (no hue to speak of). */
export function isNeutral(hex: string): boolean {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return Math.max(r, g, b) - Math.min(r, g, b) < 18;
}

export interface ColorCandidate { hex: string; count: number; brandVariable: boolean; neutral: boolean }

/**
 * Colours used in a site's CSS, most used first, with the ones named like brand colours
 * (--primary, --brand, --accent…) marked. Neutrals are kept but marked: a brand can be black and white.
 */
export function cssColors(css: string, themeColor: string | null = null): ColorCandidate[] {
  const counts = new Map<string, { count: number; brandVariable: boolean }>();
  const add = (hex: string | null, weight: number, brandVariable = false) => {
    if (!hex) return;
    const entry = counts.get(hex) ?? { count: 0, brandVariable: false };
    entry.count += weight;
    entry.brandVariable ||= brandVariable;
    counts.set(hex, entry);
  };
  const text = css.slice(0, 1_500_000);
  for (const m of text.matchAll(/--([\w-]{1,60})\s*:\s*(#[0-9a-f]{3,8}\b|rgba?\([^)]{5,40}\))/gi)) {
    const brand = /primary|brand|accent|secondary|main|highlight|cta|button/i.test(m[1]);
    add(hexOf(m[2]), brand ? 6 : 1, brand);
  }
  for (const m of text.matchAll(/(?:color|background(?:-color)?|fill|stroke|border(?:-color)?)\s*:\s*[^;}]*?(#[0-9a-f]{3,8}\b|rgba?\([^)]{5,40}\))/gi)) add(hexOf(m[1]), 1);
  add(themeColor, 8, true);
  return [...counts.entries()].map(([hex, v]) => ({ hex, count: v.count, brandVariable: v.brandVariable, neutral: isNeutral(hex) }))
    .sort((a, b) => Number(b.brandVariable) - Number(a.brandVariable) || Number(a.neutral) - Number(b.neutral) || b.count - a.count)
    .slice(0, 16);
}

// MARK: Social handles

export const SOCIAL_KEYS = ["instagram", "tiktok", "youtube", "x", "linkedin", "facebook"] as const;
export type SocialKey = (typeof SOCIAL_KEYS)[number];

/** Path words that are a network's own pages (share, intent, posts…), never someone's handle. */
const RESERVED_PATHS = /^(share|sharer|intent|home|p|reel|reels|watch|hashtag|explore|channel|c|user|profile|people|pages|groups|search|login|tr|plugins|dialog|embed|shorts|status|i|privacy|legal|about)(\.php)?$/i;

/** Accounts of the platforms, stores and site builders themselves (linked from badges and embeds), never the product's. */
const PLATFORM_ACCOUNTS = /^(app-?store|apple|itunes|google|google-?play|googleplay|android|meta|facebook|instagram|threads|whatsapp|messenger|x|twitter|youtube|tiktok|tiktokforbusiness|linkedin|pinterest|wix|shopify|squarespace|webflow|wordpress|framer|hubspot|intercom|zendesk|stripe|paypal|klarna|trustpilot|yelp|producthunt)$/i;

/** "https://instagram.com/volt/" → ["instagram", "volt"]; null for share links, posts, intents and the like. */
export function socialHandle(url: string): [SocialKey, string] | null {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  const host = parsed.hostname.replace(/^(www|m)\./, "").toLowerCase();
  const parts = parsed.pathname.split("/").filter(Boolean).map((p) => decodeURIComponent(p));
  if (host === "linkedin.com") return (parts[0] === "company" || parts[0] === "school" || parts[0] === "showcase") && parts[1] ? ["linkedin", parts[1]] : null;
  const map: Record<string, SocialKey> = { "instagram.com": "instagram", "tiktok.com": "tiktok", "youtube.com": "youtube", "x.com": "x", "twitter.com": "x", "facebook.com": "facebook" };
  const key = map[host];
  if (!key || !parts[0]) return null;
  // youtube.com/c/Name and /user/Name are channels too.
  if (key === "youtube" && (parts[0] === "c" || parts[0] === "user") && parts[1]) return ["youtube", parts[1]];
  const first = parts[0].replace(/^@/, "");
  if (parts.length > 1) return null;
  if (RESERVED_PATHS.test(first) || PLATFORM_ACCOUNTS.test(first)) return null;
  if (!/^[A-Za-z0-9._-]{2,60}$/.test(first)) return null;
  return [key, first];
}

/** Handles from social links: the first one per network, in the order found (header/footer before body text). */
export function socialsFromLinks(links: string[]): Partial<Record<SocialKey, string>> {
  const out: Partial<Record<SocialKey, string>> = {};
  for (const link of links) {
    const found = socialHandle(link);
    if (found && !out[found[0]]) out[found[0]] = found[1];
  }
  return out;
}

/** A handle as the model wrote it ("@volt", "instagram.com/volt", "volt") → "volt"; "" when it isn't one. */
export function cleanHandle(value: unknown, key: SocialKey): string {
  if (typeof value !== "string") return "";
  const v = value.trim();
  if (!v) return "";
  if (/^(https?:\/\/|www\.|[a-z]+\.(com|net)\/)/i.test(v)) {
    const found = socialHandle(/^https?:/i.test(v) ? v : `https://${v}`);
    return found && found[0] === key ? found[1] : "";
  }
  const handle = v.replace(/^@/, "");
  return /^[A-Za-z0-9._-]{2,60}$/.test(handle) && !RESERVED_PATHS.test(handle) && !PLATFORM_ACCOUNTS.test(handle) ? handle : "";
}

// MARK: The product form's fields (twin of studio/src/lib/product-questions.ts and db.ts)

export const PRODUCT_KINDS = ["saas", "mobile_app", "physical_product", "clothing", "food_beverage", "restaurant", "local_service", "creator_education", "other"] as const;
export const STAGES = ["idea", "pre_launch", "launched", "established"] as const;
/** The form's kind-specific questions: free text, or one of these values. */
export const PRODUCT_ANSWERS: Record<string, readonly string[] | null> = {
  buyerRole: null, useCase: null, pricingModel: ["free_trial", "freemium", "subscription", "contract"],
  appPlatforms: ["ios", "android", "both"], monetization: ["subscription", "freemium", "paid", "ads"],
  productType: null, style: null, dropModel: ["drops", "always_on", "both"], availability: ["online", "stores", "both"],
  cuisine: null, city: null, locations: ["1", "2-5", "6+", "planned"], serviceType: null, serviceArea: null,
  topic: null, format: ["course", "coaching", "community", "newsletter"], differentiator: null,
};

// MARK: OpenAI's answer

export const SALES_CHANNELS = ["online_store", "retail", "app_store", "sales_team", "physical_location", "marketplace", "unknown"] as const;
export const PRICE_TIERS = ["budget", "mid", "premium", "unknown"] as const;
const COLOR_ROLES = ["primary", "secondary", "accent", "background", "text"] as const;

const str = { type: "string" };
const strs = { type: "array", items: str };
const obj = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });

/** Strict JSON schema: every key required, nothing extra. */
const nullable = (values?: readonly string[]) => (values ? { anyOf: [{ type: "string", enum: [...values] }, { type: "null" }] } : { type: ["string", "null"] });

/** The product table's onboarding fields, filled from the sources (null where they say nothing). */
const PRODUCT_SCHEMA = obj({
  kind: { type: "string", enum: [...PRODUCT_KINDS] },
  stage: nullable(STAGES),
  audience: nullable(),
  price_tier: nullable(["budget", "mid", "premium"]),
  sales_channel: nullable(["online_store", "retail", "app_store", "sales_team", "physical_location", "marketplace"]),
  region: nullable(),
  answers: obj(Object.fromEntries(Object.entries(PRODUCT_ANSWERS).map(([k, values]) => [k, nullable(values ?? undefined)]))),
  socials: obj(Object.fromEntries(SOCIAL_KEYS.map((k) => [k, nullable()]))),
});

export const INSIGHT_SCHEMA = obj({
  product: PRODUCT_SCHEMA,
  summary: str,
  tagline: str,
  category: str,
  aim: str,
  problem: str,
  solution: str,
  audience: obj({
    primary: str,
    segments: { type: "array", items: obj({ name: str, description: str, pains: strs, motivations: strs }) },
  }),
  value_props: strs,
  features: { type: "array", items: obj({ name: str, benefit: str }) },
  differentiators: strs,
  pricing: obj({ model: str, details: str, price_tier: { type: "string", enum: [...PRICE_TIERS] } }),
  sales_channel: { type: "string", enum: [...SALES_CHANNELS] },
  region: str,
  proof: strs,
  brand: obj({
    colors: { type: "array", items: obj({ hex: str, name: str, role: { type: "string", enum: [...COLOR_ROLES] }, evidence: str }) },
    tone: str,
    voice: strs,
    visual_style: str,
    typography: str,
  }),
  messaging: obj({ hooks: strs, phrases: strs, ctas: strs }),
  keywords: strs,
  competitors: strs,
  claims_to_avoid: strs,
  gaps: strs,
});

export const INSIGHT_SYSTEM = `You are a brand strategist writing a product profile for a growth team that makes ads for this product.
You get what the owner typed while onboarding, the text of their website pages, their App Store / Google Play listing, colour candidates from the site's CSS, and a few images (app icon, social preview, screenshots).

Rules:
- Use only what the sources say or clearly show. Never invent numbers, ratings, user counts, prices, awards or features. If something isn't in the sources, leave it out and name it in "gaps".
- The website and listings are the main reference; the owner's notes fill in what the sources don't cover. When they disagree, follow the sources and say so in "gaps".
- Write plainly, like a sharp strategist briefing a designer: specific, no buzzwords, no hype.
- summary: 2–4 sentences: what it is, who it's for, the outcome it gives them.
- tagline: at most 60 characters, the product's own line if it has one.
- category: a short label, e.g. "Schengen 90/180 day-counter app".
- aim: what the company is trying to achieve (its mission), one or two sentences.
- problem / solution: the customer's problem in their terms, then how this product solves it.
- audience.primary: one line. segments: 2–4 distinct customer groups with their pains and motivations.
- value_props: 3–6 outcomes the customer gets. features: the real features named in the sources, each with its benefit.
- pricing.price_tier: budget, mid or premium against its market; "unknown" when no price is shown.
- sales_channel: where people buy or get it; "unknown" when unclear.
- proof: ratings, review counts, user numbers, press, quotes, exactly as stated, with where they come from.
- brand.colors: 2–6 colours, most important first, as "#RRGGBB". Prefer colours you can see in the images or that the CSS marks as brand/primary/accent; say in "evidence" where each was seen. Don't list plain white or black unless the brand is built on them.
- brand.tone: one sentence on how they sound. voice: 3–5 adjectives. visual_style: how their visuals look (photography, illustration, layout, mood). typography: what their type looks like, or "" if unknown.
- messaging.hooks: their strongest attention lines as written; phrases: words and phrases they repeat; ctas: their calls to action.
- keywords: 5–12 search terms for the niche.
- competitors: products or brands named or clearly compared against in the sources.
- claims_to_avoid: claims an ad for this product must not make (medical, financial, legal, guarantees, or anything the sources don't back), one per line.
- gaps: what a marketer would want to know that the sources don't say.
- product: the owner's onboarding form, filled from the sources so it can replace what they typed. null wherever the sources don't say; never guess.
  - kind: the closest of saas, mobile_app, physical_product, clothing, food_beverage, restaurant, local_service, creator_education, other. stage: idea, pre_launch (waitlist / coming soon / in review), launched (people can buy or download it), established (clearly mature: years running, large user base).
  - audience: who it's for, one short line. price_tier, sales_channel, region: as above (region like "Worldwide", "US", "UK and EU").
  - answers: only the questions that fit the kind. saas: buyerRole, useCase, pricingModel. mobile_app: appPlatforms, useCase, monetization. physical_product: productType. clothing: style, dropModel. food_beverage: productType, availability. restaurant: cuisine, city, locations. local_service: serviceType, serviceArea. creator_education: topic, format. other: productType. Every kind: differentiator (one line). Free-text answers are short, like a person typing into a form. Others null.
  - socials: the product's OWN handles, without @ or URL, from SOCIAL LINKS ON THE SITE, the pages' footers and structured data, or the store listing. Never a handle that belongs to someone else (a partner, a press outlet, a platform's own account), and never invented.`;

export interface ProductFields {
  kind: (typeof PRODUCT_KINDS)[number];
  stage: (typeof STAGES)[number] | null;
  audience: string | null;
  price_tier: "budget" | "mid" | "premium" | null;
  sales_channel: string | null;
  region: string | null;
  answers: Record<string, string>;
  socials: Partial<Record<SocialKey, string>>;
}

export interface InsightAnswer {
  product: ProductFields;
  summary: string;
  tagline: string;
  category: string;
  aim: string;
  problem: string;
  solution: string;
  audience: { primary: string; segments: { name: string; description: string; pains: string[]; motivations: string[] }[] };
  value_props: string[];
  features: { name: string; benefit: string }[];
  differentiators: string[];
  pricing: { model: string; details: string; price_tier: (typeof PRICE_TIERS)[number] };
  sales_channel: (typeof SALES_CHANNELS)[number];
  region: string;
  proof: string[];
  brand: { colors: { hex: string; name: string; role: (typeof COLOR_ROLES)[number]; evidence: string }[]; tone: string; voice: string[]; visual_style: string; typography: string };
  messaging: { hooks: string[]; phrases: string[]; ctas: string[] };
  keywords: string[];
  competitors: string[];
  claims_to_avoid: string[];
  gaps: string[];
}

const clip = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const list = (v: unknown, max: number, each: number) => [...new Set((Array.isArray(v) ? v : []).map((x) => clip(x, each)).filter(Boolean))].slice(0, max);

/** OpenAI's answer, trimmed to sane lengths and with colours checked. */
export function cleanInsight(raw: Record<string, any>): InsightAnswer {
  const enumOf = <T extends string>(v: unknown, values: readonly T[], fallback: T): T => (values.includes(v as T) ? v as T : fallback);
  const colors = (Array.isArray(raw?.brand?.colors) ? raw.brand.colors : [])
    .map((c: any) => ({ hex: hexOf(String(c?.hex ?? "")) ?? "", name: clip(c?.name, 40), role: enumOf(c?.role, COLOR_ROLES, "accent"), evidence: clip(c?.evidence, 160) }))
    .filter((c: { hex: string }, i: number, all: { hex: string }[]) => c.hex && all.findIndex((x) => x.hex === c.hex) === i)
    .slice(0, 6);
  const p = raw?.product ?? {};
  const answers: Record<string, string> = {};
  for (const [key, values] of Object.entries(PRODUCT_ANSWERS)) {
    const v = p?.answers?.[key];
    if (typeof v !== "string" || !v.trim()) continue;
    if (values ? values.includes(v) : true) answers[key] = values ? v : clip(v, key === "differentiator" ? 300 : 160);
  }
  const socials: Partial<Record<SocialKey, string>> = {};
  for (const key of SOCIAL_KEYS) {
    const handle = cleanHandle(p?.socials?.[key], key);
    if (handle) socials[key] = handle;
  }
  const product: ProductFields = {
    kind: enumOf(p?.kind, PRODUCT_KINDS, "other"),
    stage: STAGES.includes(p?.stage) ? p.stage : null,
    audience: clip(p?.audience, 200) || null,
    price_tier: ["budget", "mid", "premium"].includes(p?.price_tier) ? p.price_tier : null,
    sales_channel: SALES_CHANNELS.includes(p?.sales_channel) && p.sales_channel !== "unknown" ? p.sales_channel : null,
    region: clip(p?.region, 80) || null,
    answers,
    socials,
  };
  return {
    product,
    summary: clip(raw?.summary, 900),
    tagline: clip(raw?.tagline, 80),
    category: clip(raw?.category, 80),
    aim: clip(raw?.aim, 400),
    problem: clip(raw?.problem, 600),
    solution: clip(raw?.solution, 600),
    audience: {
      primary: clip(raw?.audience?.primary, 200),
      segments: (Array.isArray(raw?.audience?.segments) ? raw.audience.segments : []).slice(0, 5).map((s: any) => ({
        name: clip(s?.name, 60), description: clip(s?.description, 300), pains: list(s?.pains, 5, 160), motivations: list(s?.motivations, 5, 160),
      })).filter((s: { name: string }) => s.name),
    },
    value_props: list(raw?.value_props, 8, 200),
    features: (Array.isArray(raw?.features) ? raw.features : []).slice(0, 12).map((f: any) => ({ name: clip(f?.name, 60), benefit: clip(f?.benefit, 200) })).filter((f: { name: string }) => f.name),
    differentiators: list(raw?.differentiators, 6, 200),
    pricing: { model: clip(raw?.pricing?.model, 80), details: clip(raw?.pricing?.details, 300), price_tier: enumOf(raw?.pricing?.price_tier, PRICE_TIERS, "unknown") },
    sales_channel: enumOf(raw?.sales_channel, SALES_CHANNELS, "unknown"),
    region: clip(raw?.region, 80),
    proof: list(raw?.proof, 8, 200),
    brand: { colors, tone: clip(raw?.brand?.tone, 300), voice: list(raw?.brand?.voice, 6, 30), visual_style: clip(raw?.brand?.visual_style, 400), typography: clip(raw?.brand?.typography, 200) },
    messaging: { hooks: list(raw?.messaging?.hooks, 6, 160), phrases: list(raw?.messaging?.phrases, 10, 80), ctas: list(raw?.messaging?.ctas, 5, 40) },
    keywords: list(raw?.keywords, 12, 60),
    // Names only: no links, no notes like "Acme — named in the owner's notes".
    competitors: list((Array.isArray(raw?.competitors) ? raw.competitors : []).map((c: unknown) => typeof c === "string" ? c.split(/\s+[—–-]\s+|\s*\(/)[0].trim() : "").filter((c: string) => c && !/^(https?:\/\/|www\.)/i.test(c)), 12, 80),
    claims_to_avoid: list(raw?.claims_to_avoid, 12, 160),
    gaps: list(raw?.gaps, 8, 200),
  };
}

// MARK: Sorting product images

export const ASSET_KINDS = ["app_screen", "product", "packaging", "lifestyle", "person", "logo", "other"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export const SORT_SCHEMA = obj({
  items: {
    type: "array",
    items: obj({
      id: str,
      keep: { type: "boolean" },
      kind: { type: "string", enum: [...ASSET_KINDS] },
      label: str,
      description: str,
      group_name: { type: ["string", "null"] },
      good_for: strs,
    }),
  },
});

export const SORT_SYSTEM = `You sort a product's images for a team that makes ads for it. You get the product's profile and its images, each with an id (and, for collected ones, where it came from and its alt text).
For every image:
- keep: false only for images that are useless in an ad for THIS product: decorative shapes, generic stock icons, other companies' logos or badges, press logos, tiny UI chrome, cookie banners. Keep anything that shows the product, the app, its packaging, its brand, its results or its customers.
- kind: app_screen (a screen or mockup of the app), product (the physical product or a single item), packaging (box, bottle, pack shot, delivery), lifestyle (the product in use or a scene), person (people, testimonials, before/after faces), logo (the product's own logo or wordmark), other.
- label: 2–5 words naming it, e.g. "Scan results screen", "Tretalone tube".
- description: one sentence on what it shows.
- group_name: the product line, feature or set it belongs to ("Tretalone", "Onboarding flow", "Before/after"), or null.
- good_for: 1–4 short tags for where it works in an ad: "hero product shot", "app demo", "before/after", "testimonial", "feature close-up", "brand moment", "unboxing", "background".
Use only what you can see and what the profile says. Never invent product names.`;

// MARK: App Store reviews

/**
 * A customer review from the App Store, verbatim (`products.insight.appStore.reviews`): the text,
 * title and author exactly as Apple shows them, so an ad can quote one word for word with its author.
 */
export interface AppStoreReview { id: string; author: string; rating: number; title: string; body: string; date: string; url?: string; /** The app version the review was written on, when the feed names it. */ version?: string }

/** Reviews kept per product (the most recent first). */
export const MAX_REVIEWS = 50;

/** Apple's customer reviews feed (RSS as JSON), most recent first. */
export const reviewsFeedUrl = (id: string, country = "us") => `https://itunes.apple.com/${country}/rss/customerreviews/id=${id}/sortBy=mostRecent/json`;

const label = (v: unknown): string => {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (v && typeof v === "object" && "label" in v) return label((v as { label: unknown }).label);
  return "";
};
const httpsOrNone = (v: unknown) => (typeof v === "string" && /^https:\/\/[^\s]+$/.test(v) ? v : undefined);

/** One review made safe: text kept exactly (only trimmed), rating 1–5, an id; null when it isn't one. */
function cleanReview(r: { id: unknown; author: unknown; rating: unknown; title: unknown; body: unknown; date: unknown; url?: unknown; version?: unknown }): AppStoreReview | null {
  const body = typeof r.body === "string" ? r.body.trim() : "";
  const rating = Math.round(Number(r.rating));
  const id = String(r.id ?? "").trim().slice(0, 64);
  if (!body || !id || !(rating >= 1 && rating <= 5)) return null;
  const date = typeof r.date === "string" && !Number.isNaN(Date.parse(r.date)) ? new Date(r.date).toISOString() : "";
  const url = httpsOrNone(r.url);
  const version = typeof r.version === "string" && /^[\w.\- ]{1,40}$/.test(r.version.trim()) ? r.version.trim() : "";
  return {
    id, rating, body: body.slice(0, 4000),
    author: typeof r.author === "string" ? r.author.trim().slice(0, 120) : "",
    title: typeof r.title === "string" ? r.title.trim().slice(0, 300) : "",
    date, ...(url ? { url } : {}), ...(version ? { version } : {}),
  };
}

function finish(list: (AppStoreReview | null)[]): AppStoreReview[] {
  const seen = new Set<string>();
  return list.filter((r): r is AppStoreReview => {
    if (!r || seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  }).sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0)).slice(0, MAX_REVIEWS);
}

/** Apple's RSS JSON feed (feed.entry): every entry with a rating and text. The app's own entry (older feeds list it first) has neither. */
export function parseReviewFeed(json: unknown): AppStoreReview[] {
  const feed = (json as { feed?: { entry?: unknown } } | null)?.feed;
  const entries = Array.isArray(feed?.entry) ? feed!.entry : feed?.entry ? [feed.entry] : [];
  return finish((entries as Record<string, any>[]).map((e) => {
    if (!e || typeof e !== "object" || !e["im:rating"]) return null;
    const links = Array.isArray(e.link) ? e.link : e.link ? [e.link] : [];
    return cleanReview({
      id: label(e.id), author: label(e.author?.name), rating: label(e["im:rating"]), title: label(e.title),
      body: label(e.content), date: label(e.updated), url: links.map((l: any) => l?.attributes?.href).find((h: unknown) => httpsOrNone(h)),
      version: label(e["im:version"]),
    });
  }));
}

const TEXT_KEYS = ["review", "contents", "body", "content", "text"];
const AUTHOR_KEYS = ["userName", "reviewerName", "nickname", "author", "name"];
const DATE_KEYS = ["date", "updated", "lastModified", "submitted"];

/** Objects anywhere in the page's data that look like a review: text, a 1–5 rating, an author or a title. */
function walk(node: unknown, out: AppStoreReview[], depth = 0) {
  if (depth > 40 || out.length >= MAX_REVIEWS * 2) return;
  if (typeof node === "string") {
    // Apple's older pages keep each API answer as a JSON string inside the JSON.
    if (node.length > 40 && /^\s*[[{]/.test(node) && /review|rating/i.test(node)) {
      try { walk(JSON.parse(node), out, depth + 1); } catch { /* not JSON */ }
    }
    return;
  }
  if (Array.isArray(node)) { for (const item of node) walk(item, out, depth + 1); return; }
  if (!node || typeof node !== "object") return;
  const o = node as Record<string, unknown>;
  const fields = (o.attributes && typeof o.attributes === "object" ? { ...o, ...(o.attributes as Record<string, unknown>) } : o);
  const text = TEXT_KEYS.map((k) => fields[k]).find((v) => typeof v === "string" && v.trim().length > 0);
  const rating = Number(fields.rating ?? fields.stars);
  const author = AUTHOR_KEYS.map((k) => fields[k]).find((v) => typeof v === "string");
  if (typeof text === "string" && rating >= 1 && rating <= 5 && (author || typeof fields.title === "string")) {
    const review = cleanReview({
      id: fields.id ?? fields.reviewId ?? `${author ?? ""}:${fields.date ?? ""}:${text.slice(0, 40)}`,
      author, rating, title: fields.title, body: text, date: DATE_KEYS.map((k) => fields[k]).find((v) => typeof v === "string"),
    });
    if (review) out.push(review);
    return;
  }
  for (const value of Object.values(o)) walk(value, out, depth + 1);
}

/** The App Store web page's embedded data (its JSON <script> blocks): the reviews it shows, verbatim. */
export function parseAppStorePageReviews(html: string): AppStoreReview[] {
  const out: AppStoreReview[] = [];
  for (const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    const tag = m[0].slice(0, m[0].indexOf(">") + 1);
    const type = (attr(tag, "type") ?? "").toLowerCase();
    if (!/json|shoebox/.test(type)) continue;
    const raw = m[1].trim();
    if (!/review|rating/i.test(raw)) continue;
    try { walk(JSON.parse(raw), out); } catch { /* not JSON */ }
  }
  return finish(out);
}
