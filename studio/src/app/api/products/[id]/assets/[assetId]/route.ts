import type { NextRequest } from "next/server";
import { ASSET_COLUMNS, CONSENT_OPTIONS, type AssetKind } from "@/lib/product-assets";
import { isResponse, requireUser } from "@/lib/server/auth";
import { WORKSPACE_BUCKET } from "@/lib/workspace";
import { dbFailure } from "@/lib/server/errors";

const KINDS: AssetKind[] = ["app_screen", "product", "packaging", "lifestyle", "person", "logo", "other"];
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) || null : null);

/** Edits one image: kind (then the AI keeps it), label, group, hidden; for people, consent and possible minor. */
export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/products/[id]/assets/[assetId]">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { id, assetId } = await ctx.params;
  const body = await request.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};
  if (KINDS.includes(body.kind)) { patch.kind = body.kind; patch.kind_locked = true; }
  if ("label" in body) patch.label = text(body.label, 120);
  if ("group_name" in body) patch.group_name = text(body.group_name, 80);
  if (typeof body.hidden === "boolean") patch.hidden = body.hidden;
  if (CONSENT_OPTIONS.some((c) => c.id === body.consent)) patch.consent = body.consent;
  if (typeof body.possible_minor === "boolean") patch.possible_minor = body.possible_minor;
  if (!Object.keys(patch).length) return Response.json({ error: "Nothing to change." }, { status: 400 });
  const { data, error } = await session.supabase.from("product_assets").update(patch).eq("id", assetId).eq("product_id", id).select(ASSET_COLUMNS).maybeSingle();
  if (error) return dbFailure("asset update", error, "Couldn't save the change. Try again.");
  return data ? Response.json({ asset: data }) : Response.json({ error: "Not found" }, { status: 404 });
}

/** Deletes one image, and its file when it's in this product's folder. */
export async function DELETE(_request: NextRequest, ctx: RouteContext<"/api/products/[id]/assets/[assetId]">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { id, assetId } = await ctx.params;
  const { data: asset } = await session.supabase.from("product_assets").select("storage_path").eq("id", assetId).eq("product_id", id).maybeSingle<{ storage_path: string | null }>();
  if (!asset) return Response.json({ error: "Not found" }, { status: 404 });
  await session.supabase.from("product_assets").delete().eq("id", assetId);
  if (asset.storage_path?.startsWith(`${session.user.id}/${id}/assets/`)) await session.supabase.storage.from(WORKSPACE_BUCKET).remove([asset.storage_path]);
  return Response.json({ deleted: true });
}
