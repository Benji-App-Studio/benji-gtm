import type { NextRequest } from "next/server";
import { isResponse, requireUser } from "@/lib/server/auth";
import { caughtFailure } from "@/lib/server/errors";
import { loadLaunchedAds } from "@/lib/server/launched-ads";
import { loadWorkspace } from "@/lib/server/workspaces";
import { getTranslator } from "@/lib/i18n/server";

const UUID = /^[0-9a-f-]{36}$/;
/** Only a missing table of Launch's or Measure's (Postgres 42P01, PostgREST PGRST205) reads as "not set up yet". */
const TABLES = String.raw`(?:public\.)?(?:launch_settings|launch_drafts|meta_ads|meta_daily|appstack_daily|measure_settings|measure_sync)`;
const MISSING_TABLES = new RegExp(String.raw`relation "${TABLES}" does not exist|Could not find the table '${TABLES}' in the schema cache`, "i");

/**
 * Every ad Launch sent, with its lineage and numbers for the last ?days= days (7, 14, 28 or 90, as in
 * Measure). Reads only. Pausing and promoting stay on /actions, each confirmed on the page first.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/launch/[productId]/ads">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { productId } = await ctx.params;
  const { t } = await getTranslator();
  if (!UUID.test(productId)) return Response.json({ error: t("Which workspace?") }, { status: 400 });
  const workspace = await loadWorkspace(productId);
  if (isResponse(workspace)) return workspace;
  try {
    return Response.json(await loadLaunchedAds(session, productId, Number(request.nextUrl.searchParams.get("days")) || 28));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (MISSING_TABLES.test(message)) return Response.json({ error: t("Launch's tables aren't in the database yet. Open /setup and press Apply the update.") }, { status: 503 });
    return caughtFailure("launched ads load", error, t("Couldn't load the ads. Try again."), 500, {}, t);
  }
}
