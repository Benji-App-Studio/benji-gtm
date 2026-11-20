import type { NextRequest } from "next/server";
import type { FormatCard } from "@/lib/formats/types";
import { getTranslator } from "@/lib/i18n/server";
import { isResponse, requireUser } from "@/lib/server/auth";
import { dbFailure } from "@/lib/server/errors";

/**
 * Removes a card from the format library (it's archived, so a rebuild doesn't bring it back). For
 * cards made from ads sent from Research, those ads become "not in the library" again: they stay in
 * Research and can be sent back later.
 */
export async function DELETE(_request: NextRequest, ctx: RouteContext<"/api/w/[productId]/formats/[cardId]">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { productId, cardId } = await ctx.params;
  const { data: row } = await session.supabase.from("format_cards").select("id, card").eq("id", cardId).eq("product_id", productId).maybeSingle<{ id: string; card: FormatCard }>();
  const { t } = await getTranslator();
  if (!row) return Response.json({ error: t("That wasn't found. Reload the page and try again.") }, { status: 404 });
  const { error } = await session.supabase.from("format_cards").update({ archived: true }).eq("id", row.id);
  if (error) return dbFailure("format archive", error, t("Couldn't archive the format. Try again."), 500, {}, t);
  const adIds = row.card.source === "paid" ? row.card.examples.map((e) => e.id).filter((id) => /^[0-9a-f-]{36}$/i.test(id)) : [];
  if (adIds.length) await session.supabase.from("paid_ads").update({ sent_to_library_at: null }).in("id", adIds).eq("product_id", productId);
  return Response.json({ removed: true, adsReturned: adIds.length });
}
