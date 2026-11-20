import type { NextRequest } from "next/server";
import { CREATIVES_BUCKET } from "@/lib/creatives";
import { zipName } from "@/lib/export-paths";
import { zip, type ZipEntry } from "@/lib/zip";
import { isResponse, requireUser } from "@/lib/server/auth";
import { approvedForExport } from "@/lib/server/export";
import { caughtFailure } from "@/lib/server/errors";
import { getTranslator } from "@/lib/i18n/server";

/** Files fetched at once while building the zip. */
const PARALLEL = 6;

/**
 * "Download approved": the product's approved creatives as one zip, filed
 * <awareness level or format>/<creative>/<aspect>.<ext> (lib/export-paths.ts). Creatives only: no JSON.
 * `?ids=a,b` limits it to those creatives.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/studio/[productId]/export">) {
  const { t } = await getTranslator();
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { productId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(productId)) return Response.json({ error: t("This workspace doesn't exist.") }, { status: 404 });
  const ids = request.nextUrl.searchParams.get("ids")?.split(",").filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 500);
  let set;
  try {
    set = await approvedForExport(session, productId, ids);
  } catch (error) {
    return caughtFailure("export list", error, t("Couldn't list the approved creatives. Try again."), 500, {}, t);
  }
  if (!set.files.length) return Response.json({ error: t("No approved creatives to download yet.") }, { status: 404 });

  const entries: ZipEntry[] = [];
  const failed: string[] = [];
  for (let i = 0; i < set.files.length; i += PARALLEL) {
    await Promise.all(set.files.slice(i, i + PARALLEL).map(async (f) => {
      const { data } = await session.supabase.storage.from(CREATIVES_BUCKET).download(f.storagePath);
      const blob = data ?? await fetch(f.url, { cache: "no-store" }).then((r) => (r.ok ? r.blob() : null)).catch(() => null);
      if (!blob) { failed.push(f.zipPath); return; }
      entries.push({ path: f.zipPath, bytes: new Uint8Array(await blob.arrayBuffer()) });
    }));
  }
  if (!entries.length) return Response.json({ error: t("Couldn't read any of the files from storage. Try again.") }, { status: 502 });
  entries.sort((a, b) => a.path.localeCompare(b.path));
  const body = zip(entries);
  return new Response(body as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${zipName(set.appName)}"`,
      "Content-Length": String(body.length),
      "Cache-Control": "no-store",
      ...(failed.length ? { "X-Export-Missing": String(failed.length) } : {}),
    },
  });
}
