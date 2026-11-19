import type { NextRequest } from "next/server";
import { withStoredMedia } from "@/lib/ad-media";
import { AD_VERSION_COLUMNS, type AdVersion } from "@/lib/research";
import { storedMediaFor } from "@/lib/server/ad-media";
import { isResponse, requireUser } from "@/lib/server/auth";
import { dbFailure } from "@/lib/server/errors";

/**
 * An edited ad's earlier versions (`paid_ad_versions`), newest first: the copy, link and media it had
 * before each change. The Ad Library's media links expire, so each is swapped for its stored copy
 * (`paid_ad_media`) where one was saved, the original kept as `source_url`.
 */
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/research/[productId]/ads/[adId]/versions">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { productId, adId } = await ctx.params;
  const { data, error } = await session.supabase.from("paid_ad_versions").select(AD_VERSION_COLUMNS)
    .eq("product_id", productId).eq("paid_ad_id", adId).order("replaced_at", { ascending: false }).limit(50).returns<AdVersion[]>();
  if (error) {
    const missing = /paid_ad_versions|relation/.test(error.message);
    if (missing) return Response.json({ error: "Ad versions aren't set up in the database yet. Open /setup and press Apply the update." }, { status: 503 });
    return dbFailure("research ad versions", error, "Couldn't load the ad's earlier versions. Try again.", 400);
  }
  const rows = data ?? [];
  const stored = await storedMediaFor(session, productId, rows.flatMap((v) => [v.thumb, ...(v.media ?? []).flatMap((m) => [m.url, m.thumb])]));
  const versions: AdVersion[] = rows.map((v) => {
    const swapped = withStoredMedia({ ...v, media: v.media ?? [], creative: null }, stored);
    return { ...v, media: swapped.media, thumb: swapped.thumb };
  });
  return Response.json({ versions });
}
