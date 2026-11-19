import "server-only";
// Stored copies of competitors' creative files (`paid_ad_media`), read as the signed-in user (RLS).
import { urlKey } from "../ad-media";
import type { Session } from "./auth";

const PAGE = 1000;

/**
 * A page load asks for the ads in several slices at once, and each slice needs the same map: one lookup per
 * workspace serves them all for a minute (requests in flight share one promise). The caller has already checked
 * the user can open the workspace (loadWorkspace), and new files only add links, so a minute-old map just shows
 * a few originals instead of stored copies.
 */
const MEDIA_TTL_MS = 60_000;
const mediaCache = new Map<string, { at: number; map: Promise<Map<string, string>> }>();

/** Every stored file of the workspace, by `urlKey` of its source link. Empty before the migration. */
export function storedMedia(session: Session, productId: string): Promise<Map<string, string>> {
  const hit = mediaCache.get(productId);
  if (hit && Date.now() - hit.at < MEDIA_TTL_MS) return hit.map;
  const map = loadStoredMedia(session, productId).catch((error) => { mediaCache.delete(productId); throw error; });
  mediaCache.set(productId, { at: Date.now(), map });
  return map;
}

async function loadStoredMedia(session: Session, productId: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const page = (from: number) => session.supabase.from("paid_ad_media").select("url_key, public_url")
    .eq("product_id", productId).eq("status", "done").order("id").range(from, from + PAGE - 1)
    .returns<{ url_key: string; public_url: string | null }[]>();
  // How many there are first, then every page at once (one after another took a round trip each).
  const { count } = await session.supabase.from("paid_ad_media").select("id", { count: "exact", head: true }).eq("product_id", productId).eq("status", "done");
  const pages = Math.min(100, Math.ceil((count ?? 0) / PAGE));
  const results = await Promise.all(Array.from({ length: pages }, (_, i) => page(i * PAGE)));
  for (const { data } of results) for (const row of data ?? []) if (row.public_url) map.set(row.url_key, row.public_url);
  return map;
}

/** Stored copies of a few links (the format library's thumbs). */
export async function storedMediaFor(session: Session, productId: string, urls: (string | null | undefined)[]): Promise<Map<string, string>> {
  const keys = [...new Set(urls.map(urlKey).filter((k): k is string => Boolean(k)))];
  const map = new Map<string, string>();
  for (let i = 0; i < keys.length; i += 50) {
    const { data, error } = await session.supabase.from("paid_ad_media").select("url_key, public_url")
      .eq("product_id", productId).eq("status", "done").in("url_key", keys.slice(i, i + 50))
      .returns<{ url_key: string; public_url: string | null }[]>();
    if (error) break;
    for (const row of data ?? []) if (row.public_url) map.set(row.url_key, row.public_url);
  }
  return map;
}
