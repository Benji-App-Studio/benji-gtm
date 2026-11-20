import { isResponse, requireUser } from "@/lib/server/auth";
import { caughtFailure } from "@/lib/server/errors";
import { loadBusinessSummary } from "@/lib/server/measure";
import { WorkspaceNotFoundError } from "@/lib/workspace";
import { getTranslator } from "@/lib/i18n/server";

const UUID = /^[0-9a-f-]{36}$/;
const MISSING_TABLES = /does not exist|schema cache|relation/i;

/** The app Home's "Business" card: the last 28 days of every connected source in one summary. */
export async function GET(_request: Request, ctx: RouteContext<"/api/w/[productId]/business">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { productId } = await ctx.params;
  const { t } = await getTranslator();
  if (!UUID.test(productId)) return Response.json({ error: t("Which workspace?") }, { status: 400 });
  try {
    return Response.json(await loadBusinessSummary(session, productId));
  } catch (error) {
    if (error instanceof WorkspaceNotFoundError) return Response.json({ error: error.message }, { status: 404 });
    const message = error instanceof Error ? error.message : String(error);
    if (MISSING_TABLES.test(message)) return Response.json({ error: t("Measure's tables aren't in the database yet. Open /setup and press Apply the update.") }, { status: 503 });
    return caughtFailure("business summary", error, t("Couldn't load the business summary. Try again."), 500, {}, t);
  }
}
