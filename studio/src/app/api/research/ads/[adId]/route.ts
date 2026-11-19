import type { NextRequest } from "next/server";
import { daysRunning, PAID_AD_COLUMNS, type PaidAdRow } from "@/lib/research";
import { isResponse, requireUser } from "@/lib/server/auth";
import { listCards, resolveProduct } from "@/lib/server/formats";
import { research } from "@/lib/server/research";
import { dbFailure } from "@/lib/server/errors";

/** An OpenAI scan can take a minute or two. */
export const maxDuration = 150;

/**
 * One paid ad. `decode`: Jev reads it again like an organic post (spends a little Jev credit; new ads
 * are read in the background on their own, see `decode-new`), from what's said when the scan heard it.
 * `scan`: OpenAI reads its image and text for the Recreate tool (one call; the stored scan comes back
 * unless `force`). A video also sends its key frames and length; its audio is transcribed server-side.
 * `send`: hands it to the format library. The formats package owns the cards; until it lands this
 * only marks the ad and keeps its `library_seed` (the FormatSeed contract in engine/adlibrary.ts).
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/research/ads/[adId]">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { adId } = await ctx.params;
  const input = await request.json().catch(() => ({}));
  const action = String(input?.action ?? "");
  if (action === "decode") {
    const result = await research(session, "decode", { adId });
    return Response.json(result.data, { status: result.ok ? 200 : result.status });
  }
  if (action === "scan") {
    // Video ads: key frames the browser took from the stored copy (lib/video-frames.ts) and the video's length.
    const frames = Array.isArray(input?.frames) ? input.frames.slice(0, 10) : undefined;
    const duration = typeof input?.duration === "number" ? input.duration : undefined;
    const result = await research(session, "scan", { adId, force: input?.force === true, frames, duration }, 140_000);
    return Response.json(result.data, { status: result.ok ? 200 : result.status });
  }
  if (action === "send") {
    const { data: ad } = await session.supabase.from("paid_ads").select(`${PAID_AD_COLUMNS.replace(", decode_error", "")}, library_seed`).eq("id", adId).maybeSingle<PaidAdRow & { library_seed: unknown }>();
    if (!ad) return Response.json({ error: "Not found" }, { status: 404 });
    // Without a decode the seed is the ad's own facts; a decode adds the format, hook and structure.
    const seed = ad.library_seed ?? {
      kind: "paid_ad", adId: ad.ad_id, network: ad.network, competitor: ad.competitor ?? ad.page_name,
      format: null, hookType: null, hook: ad.headline || ad.body.split("\n")[0] || null, structure: [],
      mediaType: ad.media_type, daysRunning: daysRunning(ad), variants: ad.variants, placements: ad.placements,
      cta: ad.cta, snapshotUrl: ad.snapshot_url, thumb: ad.thumb,
    };
    const sentAt = new Date().toISOString();
    const { error } = await session.supabase.from("paid_ads").update({ library_seed: seed, sent_to_library_at: sentAt }).eq("id", adId);
    if (error) return dbFailure("research ad send-to-library", error, "Couldn't send the ad to the library. Try again.", 400);
    // The library keeps its cards once built, so rebuild them now or the ad wouldn't appear in Formats.
    const product = await resolveProduct(session, ad.product_id);
    const rebuilt = product ? await listCards(session, product, { rebuild: true }).then(() => true, () => false) : false;
    return Response.json({ sent: true, sentAt, seed, rebuilt });
  }
  return Response.json({ error: "Unknown action." }, { status: 400 });
}

/**
 * Hides an ad from the workspace's Research list. The row stays (its decode, scan and library hand-off
 * are kept) and a later pull or import doesn't bring it back: `hidden` is only ever set here.
 */
export async function DELETE(_request: NextRequest, ctx: RouteContext<"/api/research/ads/[adId]">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { adId } = await ctx.params;
  const { data, error } = await session.supabase.from("paid_ads").update({ hidden: true }).eq("id", adId).select("id");
  if (error) return dbFailure("research ad hide", error, "Couldn't hide the ad. Try again.", 400);
  if (!data?.length) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ hidden: true, deleted: true });
}
