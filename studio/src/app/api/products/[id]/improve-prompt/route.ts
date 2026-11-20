import type { NextRequest } from "next/server";
import { appFromBrand, improveBlocklist, improvedProblems, improveInstructions } from "@/lib/make-for-app";
import { cleanMustAvoid } from "@/lib/creative-plan";
import { ASSET_COLUMNS, type ProductAsset } from "@/lib/product-assets";
import { isResponse, requireUser } from "@/lib/server/auth";
import { brandFor } from "@/lib/server/brand";
import { creativesBackend } from "@/lib/server/creatives-backend";
import { getTranslator } from "@/lib/i18n/server";
import { translateServerMessage } from "@/lib/i18n/server-messages";

/**
 * "Improve with AI" ({ prompt, mustAvoid }): OpenAI rewrites the prompt more precisely, with the brand's
 * rules as its instructions and their brand plus the banned words as words it may not bring in. The
 * creatives backend holds the key and refuses a rewrite that breaks a rule; this route checks again
 * (forbidden claims too) before answering { prompt, note }.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/products/[id]/improve-prompt">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const tr = await getTranslator();
  const { t } = tr;
  const { id } = await ctx.params;
  const body = await request.json().catch(() => ({}));
  const prompt = typeof body.prompt === "string" ? body.prompt.slice(0, 6000) : "";
  if (prompt.trim().length < 20) return Response.json({ error: t("Nothing to improve yet.") }, { status: 400 });
  const mustAvoid = cleanMustAvoid(body.mustAvoid);
  const [merged, assets] = await Promise.all([
    brandFor(session, id),
    session.supabase.from("product_assets").select(ASSET_COLUMNS).eq("product_id", id).eq("hidden", false).limit(50).returns<ProductAsset[]>(),
  ]);
  const kit = merged.kit;
  const app = appFromBrand({ appName: kit.appName, tagline: kit.tagline, colors: kit.colors, iconUrl: kit.iconUrl, screenshots: kit.screenshotUrls.length, tone: kit.tone, forbiddenClaims: merged.forbiddenClaims, profile: merged.profile, system: merged.system }, assets.data ?? []);
  const result = await creativesBackend<{ prompt?: string; note?: string }>(session, "prompt/improve", { productId: id, instructions: improveInstructions(app), prompt, blocked: improveBlocklist(app, mustAvoid) }, { timeoutMs: 60_000 });
  if (!result.ok || typeof result.data.prompt !== "string") {
    const status = result.status === 404 ? 501 : result.status || 502;
    return Response.json({ error: result.status === 404 ? t("Improve with AI needs the latest backend: update it (Settings › Updates).") : result.data.error ? translateServerMessage(result.data.error, tr) : t("OpenAI didn't answer. Try again.") }, { status });
  }
  const problems = improvedProblems(prompt, result.data.prompt, app, mustAvoid);
  if (problems.length) return Response.json({ error: t("The rewrite broke your brand rules ({problems}), so your prompt was kept.", { problems: problems.join("; ") }) }, { status: 422 });
  return Response.json({ prompt: result.data.prompt, note: result.data.note ?? "" });
}
