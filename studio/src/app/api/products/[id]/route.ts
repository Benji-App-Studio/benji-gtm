import type { NextRequest } from "next/server";
import { getTranslator } from "@/lib/i18n/server";
import { isResponse, requireUser } from "@/lib/server/auth";
import { productInput, saveCompetitorField } from "@/lib/server/products";
import { callFunction } from "@/lib/server/functions";
import { forgetStorage } from "@/lib/server/storage";

export async function GET(_request: NextRequest, ctx: RouteContext<"/api/products/[id]">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { id } = await ctx.params;
  const { data } = await session.supabase.from("products").select("*").eq("id", id).maybeSingle();
  if (data) return Response.json(data);
  const { t } = await getTranslator();
  return Response.json({ error: t("Not found") }, { status: 404 });
}

export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/products/[id]">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { id } = await ctx.params;
  const { t } = await getTranslator();
  const parsed = productInput(await request.json().catch(() => ({})), true);
  if (typeof parsed === "string") return Response.json({ error: t(parsed) }, { status: 400 });
  const { data: exists } = await session.supabase.from("products").select("id").eq("id", id).maybeSingle();
  if (!exists) return Response.json({ error: t("Not found") }, { status: 404 });
  // Competitor names go to the product's one list first; the row's column follows it.
  const input = await saveCompetitorField(session, id, parsed);
  const query = Object.keys(input).length ? session.supabase.from("products").update(input).eq("id", id) : session.supabase.from("products").select("*").eq("id", id);
  const { data, error } = await query.select().maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return data ? Response.json(data) : Response.json({ error: t("Not found") }, { status: 404 });
}

/**
 * Deletes an app: its files first (creatives, saved competitor media, uploads and brand files, through the
 * install function's storage cleanup, which no longer counts them against the quota), then the row, whose
 * rows in every other table go with it. When the files can't be removed, nothing is deleted.
 */
export async function DELETE(_request: NextRequest, ctx: RouteContext<"/api/products/[id]">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { id } = await ctx.params;
  const { t } = await getTranslator();
  const { data: product } = await session.supabase.from("products").select("is_primary").eq("id", id).maybeSingle();
  if (!product) return Response.json({ error: t("This app doesn't exist (it may have been deleted already).") }, { status: 404 });
  if (product.is_primary) return Response.json({ error: t("Your main product can't be deleted; edit it instead.") }, { status: 400 });
  const files = await callFunction<{ files?: number; bytes?: number }>("install", session, "storage/cleanup", {
    body: { action: "app_files", appId: id, run: true, deleting: true }, timeoutMs: 140_000,
    messages: { unreachable: t("Couldn't reach the backend to remove the app's files. Nothing was deleted; try again in a moment.") },
  });
  // A backend from before storage cleanup (404) can't remove files: the app is still deleted, as before.
  if (!files.ok && files.status !== 404) return Response.json({ error: files.data.error ? t("The app's files couldn't be removed, so the app wasn't deleted. {reason}", { reason: files.data.error }) : t("The app's files couldn't be removed, so the app wasn't deleted. Try again in a moment.") }, { status: 500 });
  forgetStorage();
  const { error } = await session.supabase.from("products").delete().eq("id", id);
  if (error) return Response.json({ error: t("The app couldn't be deleted: {reason}. Try again in a moment.", { reason: error.message }) }, { status: 500 });
  return Response.json({ deleted: true, files: files.ok ? files.data.files ?? 0 : null, bytes: files.ok ? files.data.bytes ?? 0 : null });
}
