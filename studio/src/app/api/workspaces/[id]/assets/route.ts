import type { NextRequest } from "next/server";
import { isResponse, requireUser } from "@/lib/server/auth";
import { refuseWhenFull } from "@/lib/server/storage";
import { loadRow } from "@/lib/server/workspaces";
import { WORKSPACE_BUCKET } from "@/lib/workspace";

const TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

/**
 * Starts a brand image upload ({ kind: "icon" | "screenshot", contentType }): returns a one-time
 * token for the browser to upload straight to Storage (no size limit from this server), and the
 * public URL to save in the brand kit once it's there.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/workspaces/[id]/assets">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const row = await loadRow(session, (await ctx.params).id);
  if (isResponse(row)) return row;
  const { kind, contentType, size } = await request.json().catch(() => ({}));
  if (kind !== "icon" && kind !== "screenshot") return Response.json({ error: "Upload an icon or a screenshot." }, { status: 400 });
  const ext = TYPES[contentType];
  if (!ext) return Response.json({ error: "Use a PNG, JPEG or WebP image." }, { status: 400 });

  const full = await refuseWhenFull(session, "upload", { fileBytes: Number(size) || 0 });
  if (full) return full;
  const path = `${session.user.id}/${row.id}/brand/${kind}-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
  const bucket = session.supabase.storage.from(WORKSPACE_BUCKET);
  const { data, error } = await bucket.createSignedUploadUrl(path);
  if (error) return Response.json({ error: `Couldn't start the upload: ${error.message}` }, { status: 500 });
  return Response.json({ bucket: WORKSPACE_BUCKET, path: data.path, token: data.token, url: bucket.getPublicUrl(data.path).data.publicUrl });
}
