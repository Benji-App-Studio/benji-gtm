import type { NextRequest } from "next/server";
import type { SuggestionKey } from "@/lib/brand";
import { isResponse, requireUser } from "@/lib/server/auth";
import { refuseWhenFull } from "@/lib/server/storage";
import { brandOverview, BrandSaveError, saveBrand, applyBrandSuggestion } from "@/lib/server/brand";
import { WORKSPACE_BUCKET, WorkspaceNotFoundError } from "@/lib/workspace";
import { caughtFailure } from "@/lib/server/errors";
import { getTranslator } from "@/lib/i18n/server";
import type { Translator } from "@/lib/i18n/translate";

const SUGGESTION_KEYS: SuggestionKey[] = ["tagline", "colors", "tone", "claims", "appStoreUrl", "icon", "screenshots"];

/** Font files the brand system keeps (composed ads render with them). WOFF2 isn't one: the renderer can't read it. */
const FONT_TYPES: Record<string, string> = { ttf: "font/ttf", otf: "font/otf", woff: "font/woff" };
const FONT_MAX_BYTES = 8 * 1024 * 1024;

/** Answers a brand error: 404 when the product isn't there, the save's own status, else 500. */
function failed(error: unknown, t: Translator["t"]) {
  if (error instanceof WorkspaceNotFoundError) return Response.json({ error: t("This product doesn't exist.") }, { status: 404 });
  if (error instanceof BrandSaveError) return Response.json({ error: t(error.message) }, { status: error.status });
  return caughtFailure("brand", error, t("Couldn't save the brand. Try again."), 500, {}, t);
}

/** The whole brand as the Brand page edits it (basics + system), and what the AI profile suggests. */
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/products/[id]/brand">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { t } = await getTranslator();
  try {
    return Response.json(await brandOverview(session, (await ctx.params).id));
  } catch (error) {
    return failed(error, t);
  }
}

/** Saves the brand: `{ basics, system }` (lib/server/brand.ts saveBrand keeps brand_kit and brand_system in step). */
export async function PUT(request: NextRequest, ctx: RouteContext<"/api/products/[id]/brand">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { t } = await getTranslator();
  const body = await request.json().catch(() => ({}));
  try {
    return Response.json(await saveBrand(session, (await ctx.params).id, { basics: body?.basics ?? null, system: body?.system }));
  } catch (error) {
    return failed(error, t);
  }
}

/**
 * `font-ticket`: a one-time upload URL for one font file (the browser uploads it straight to Storage).
 * `use`: applies one AI profile suggestion (`key`) to the saved brand ("Use this" on the Product page).
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/products/[id]/brand">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { t } = await getTranslator();
  const { id } = await ctx.params;
  const { data: product } = await session.supabase.from("products").select("id").eq("id", id).maybeSingle();
  if (!product) return Response.json({ error: t("This product doesn't exist.") }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  if (body.action === "use") {
    if (!SUGGESTION_KEYS.includes(body.key)) return Response.json({ error: t("Which suggestion?") }, { status: 400 });
    try {
      return Response.json(await applyBrandSuggestion(session, id, body.key as SuggestionKey));
    } catch (error) {
      return failed(error, t);
    }
  }
  if (body.action !== "font-ticket") return Response.json({ error: t("Unknown action.") }, { status: 400 });
  const name = String(body.fileName ?? "");
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (!FONT_TYPES[ext]) return Response.json({ error: t("Use a TTF, OTF or WOFF font file (WOFF2 can't be rendered).") }, { status: 400 });
  if (Number(body.size) > FONT_MAX_BYTES) return Response.json({ error: t("Font files are 8 MB at most.") }, { status: 400 });
  const full = await refuseWhenFull(session, "upload", { fileBytes: Number(body.size) || 0 });
  if (full) return full;
  const safe = name.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 60) || "font";
  const path = `${session.user.id}/${id}/fonts/${safe}-${crypto.randomUUID().slice(0, 6)}.${ext}`;
  const bucket = session.supabase.storage.from(WORKSPACE_BUCKET);
  const { data, error } = await bucket.createSignedUploadUrl(path);
  if (error) return Response.json({ error: t("Couldn't start the upload: {reason}", { reason: error.message }) }, { status: 500 });
  return Response.json({ bucket: WORKSPACE_BUCKET, path: data.path, token: data.token, contentType: FONT_TYPES[ext], url: bucket.getPublicUrl(data.path).data.publicUrl });
}
