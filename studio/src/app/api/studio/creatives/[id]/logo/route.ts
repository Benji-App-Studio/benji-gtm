import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { CREATIVES_BUCKET } from "@/lib/creatives";
import { LOGO_POSITIONS, overlayParam, type LogoPosition } from "@/lib/logo-overlay";
import { isResponse, requireUser } from "@/lib/server/auth";
import { setCreativeFile } from "@/lib/server/creative-file";
import { creativesBackend } from "@/lib/server/creatives-backend";
import { placeLogo } from "@/lib/server/logo-overlay";
import { caughtFailure, logDbError } from "@/lib/server/errors";
import { getTranslator } from "@/lib/i18n/server";

export const runtime = "nodejs";

/** What `copy.logo` records on a creative once our logo is placed: enough to place it again or undo it. */
interface PlacedLogo { url: string; position: LogoPosition; box: { left: number; top: number; width: number; height: number }; at: string; original: { path: string; url: string; sizeBytes: number | null; mime?: string } }

interface Row { id: string; product_id: string; job_id: string | null; kind: string; storage_path: string; url: string; mime: string; size_bytes: number | null; copy: Record<string, unknown> | null }

const mimeOf = (path: string) => (/\.jpe?g$/i.test(path) ? "image/jpeg" : /\.webp$/i.test(path) ? "image/webp" : "image/png");

const MAX_LOGO_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_BYTES = 40 * 1024 * 1024;

async function fetchBytes(url: string, max: number, what: string, types: RegExp): Promise<Uint8Array> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000), cache: "no-store" });
  if (!response.ok) throw new Error(`Couldn't download the ${what} (${response.status}).`);
  const type = response.headers.get("content-type") ?? "";
  if (type && !types.test(type)) throw new Error(`The ${what} isn't an image (${type.split(";")[0]}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > max) throw new Error(`The ${what} is too large (${Math.round(bytes.length / 1e6)} MB).`);
  return bytes;
}

/**
 * Places our real logo file on a finished image creative (lib/logo-overlay.ts), for jobs whose batch
 * asked for it (`params.logo_overlay`, set in Recreate). The Studio calls this as each such creative
 * arrives. Always works from the original file, so it's safe to repeat, to move the logo
 * (`{ position }`) or to take it off again (`{ position: "none" }`). The creative's url and
 * storage_path then point at the new file; the original stays in storage and in `copy.logo.original`.
 * The writes go through the owner-checked `creatives_set_file` function (migration 20261005300000);
 * its review trigger sends the creative back to QA (asked for here) and any decision back to pending.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/studio/creatives/[id]/logo">) {
  const { t } = await getTranslator();
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: t("This creative doesn't exist.") }, { status: 404 });
  const body = await request.json().catch(() => ({})) as { position?: unknown };
  const { supabase } = session;
  const { data: creative } = await supabase.from("creatives").select("id, product_id, job_id, kind, storage_path, url, mime, size_bytes, copy").eq("id", id).maybeSingle<Row>();
  if (!creative) return Response.json({ error: t("This creative doesn't exist.") }, { status: 404 });
  if (creative.kind !== "image") return Response.json({ error: t("Only image creatives get a placed logo.") }, { status: 400 });
  const { data: job } = creative.job_id
    ? await supabase.from("creative_jobs").select("params").eq("id", creative.job_id).maybeSingle<{ params: Record<string, unknown> }>()
    : { data: null };
  const wanted = overlayParam(job?.params);
  if (!wanted) return Response.json({ error: t("This creative's batch didn't ask for our logo to be placed.") }, { status: 400 });

  const copy = creative.copy ?? {};
  const placed = (copy.logo ?? null) as PlacedLogo | null;
  const original = placed?.original ?? { path: creative.storage_path, url: creative.url, sizeBytes: creative.size_bytes, mime: creative.mime };
  const publicUrl = (path: string) => supabase.storage.from(CREATIVES_BUCKET).getPublicUrl(path).data.publicUrl;
  // The image changed under any decision: QA looks again (the trigger already set it pending).
  const recheck = () => creativesBackend(session, "qa", { creativeIds: [id] }).catch(() => null);

  // Off again: back to the original file.
  if (body.position === "none") {
    if (!placed) return Response.json({ creative: { id, url: creative.url, storage_path: creative.storage_path, copy } });
    const saved = await setCreativeFile(supabase, id, { url: original.url, storage_path: original.path, size_bytes: original.sizeBytes, mime: original.mime ?? mimeOf(original.path), copy: { ...copy, logo: null, logoRemoved: true } });
    if ("error" in saved) return Response.json({ error: t("Couldn't take the logo off: {reason}", { reason: saved.error }) }, { status: 502 });
    await recheck();
    return Response.json({ creative: saved.creative });
  }

  const position = LOGO_POSITIONS.some((p) => p.id === body.position) ? body.position as LogoPosition : wanted.position;
  if (placed && placed.position === position && placed.url === wanted.url) return Response.json({ creative: { id, url: creative.url, storage_path: creative.storage_path, copy }, already: true });

  try {
    const [image, logo] = await Promise.all([
      fetchBytes(publicUrl(original.path), MAX_IMAGE_BYTES, "creative", /^image\//i),
      fetchBytes(wanted.url, MAX_LOGO_BYTES, "logo", /^(image\/|application\/octet-stream|binary\/octet-stream)/i),
    ]);
    const out = await placeLogo(image, logo, { position, placement: wanted.placement });
    // Next to the original, named for the logo and position: the same request makes the same file.
    const ext = out.mime === "image/jpeg" ? "jpg" : out.mime === "image/webp" ? "webp" : "png";
    const stem = original.path.replace(/\.[^./]+$/, "");
    const path = `${stem}-logo-${position.replace("_", "-")}-${createHash("sha1").update(wanted.url).digest("hex").slice(0, 8)}.${ext}`;
    const { error: uploadError } = await supabase.storage.from(CREATIVES_BUCKET).upload(path, out.bytes, { contentType: out.mime, upsert: false });
    if (uploadError && !/exists|duplicate/i.test(uploadError.message)) {
      const rls = /row-level security|policy/i.test(uploadError.message);
      throw new Error(rls ? logDbError("logo upload", uploadError, t("Storage refused the upload. Open /setup and press Apply the update, then try again."), t) : logDbError("logo upload", uploadError, t("Couldn't store the image. Try again."), t));
    }
    const record: PlacedLogo = { url: wanted.url, position, box: out.box, at: new Date().toISOString(), original };
    const saved = await setCreativeFile(supabase, id, { url: publicUrl(path), storage_path: path, size_bytes: out.bytes.length, mime: out.mime, copy: { ...copy, logo: record, logoRemoved: false } });
    if ("error" in saved) throw new Error(saved.error);
    await recheck();
    return Response.json({ creative: saved.creative });
  } catch (error) {
    return caughtFailure("logo", error, t("Couldn't place the logo. Try again."), 502, {}, t);
  }
}
