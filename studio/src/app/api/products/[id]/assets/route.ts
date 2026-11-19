import type { NextRequest } from "next/server";
import { ASSET_COLUMNS, type AssetKind } from "@/lib/product-assets";
import { isResponse, requireUser } from "@/lib/server/auth";
import { refuseWhenFull } from "@/lib/server/storage";
import { findProductImages, sortProductAssets } from "@/lib/server/insight";
import { WORKSPACE_BUCKET } from "@/lib/workspace";
import { dbFailure } from "@/lib/server/errors";

export const maxDuration = 300;

const TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const KINDS: AssetKind[] = ["app_screen", "product", "packaging", "lifestyle", "person", "logo", "other"];

/** The product's images, newest first (hidden ones too, flagged). */
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/products/[id]/assets">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { id } = await ctx.params;
  const { data, error } = await session.supabase.from("product_assets").select(ASSET_COLUMNS).eq("product_id", id).order("created_at", { ascending: false }).limit(300);
  if (error) return dbFailure("assets list", error, "Couldn't load your images. Try again.");
  return Response.json({ assets: data ?? [] });
}

/**
 * `ticket`: a one-time upload URL for one image (the browser uploads straight to Storage).
 * `add`: records an uploaded image (kind optional; the user's kind is kept when the AI sorts).
 * `sort`: the AI sorts the images not sorted yet (or `all`).
 * `find`: reads the product's links again for their pictures only (in the background).
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/products/[id]/assets">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { id } = await ctx.params;
  const { data: product } = await session.supabase.from("products").select("id").eq("id", id).maybeSingle();
  if (!product) return Response.json({ error: "This product doesn't exist." }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  const folder = `${session.user.id}/${id}/assets/`;

  if (body.action === "ticket") {
    const ext = TYPES[body.contentType];
    if (!ext) return Response.json({ error: "Use a PNG, JPEG or WebP image." }, { status: 400 });
    const full = await refuseWhenFull(session, "upload", { fileBytes: Number(body.size) || 0 });
    if (full) return full;
    const path = `${folder}upload-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
    const bucket = session.supabase.storage.from(WORKSPACE_BUCKET);
    const { data, error } = await bucket.createSignedUploadUrl(path);
    if (error) return Response.json({ error: `Couldn't start the upload: ${error.message}` }, { status: 500 });
    return Response.json({ bucket: WORKSPACE_BUCKET, path: data.path, token: data.token, url: bucket.getPublicUrl(data.path).data.publicUrl });
  }

  if (body.action === "add") {
    const path = String(body.path ?? "");
    if (!path.startsWith(folder) || path.includes("..")) return Response.json({ error: "That file isn't in this product's folder." }, { status: 400 });
    const url = session.supabase.storage.from(WORKSPACE_BUCKET).getPublicUrl(path).data.publicUrl;
    const kind = KINDS.includes(body.kind) ? body.kind as AssetKind : "other";
    const size = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : null);
    const { data, error } = await session.supabase.from("product_assets").insert({
      product_id: id, url, storage_path: path, source: "upload", kind, kind_locked: KINDS.includes(body.kind),
      label: typeof body.label === "string" ? body.label.trim().slice(0, 120) || null : null, width: size(body.width), height: size(body.height),
    }).select(ASSET_COLUMNS).single();
    if (error) return dbFailure("asset save", error, "The image was uploaded but couldn't be saved. Try again.");
    return Response.json({ asset: data });
  }

  if (body.action === "find") {
    const result = await findProductImages(session, id);
    return Response.json(result.data, { status: result.ok ? 200 : result.status });
  }

  if (body.action === "sort") {
    const result = await sortProductAssets(session, id, body.all === true);
    return Response.json(result.data, { status: result.ok ? 200 : result.status });
  }

  return Response.json({ error: "Unknown action." }, { status: 400 });
}
