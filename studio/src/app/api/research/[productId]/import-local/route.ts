import type { NextRequest } from "next/server";
import { getTranslator } from "@/lib/i18n/server";
import { isResponse, requireUser } from "@/lib/server/auth";
import { readNewAds, research } from "@/lib/server/research";

/** The most this route reads, after decompressing. */
const MAX_BYTES = 10 * 1024 * 1024;

/** Reads the body as text, gunzipping `application/gzip` uploads, and stops past MAX_BYTES. */
async function readBody(request: NextRequest): Promise<string | null> {
  if (!request.body) return "";
  const gzip = (request.headers.get("content-type") ?? "").includes("gzip");
  const stream = gzip ? request.body.pipeThrough(new DecompressionStream("gzip")) : request.body;
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/**
 * Imports a file from the local Meta Ad Library scraper (scripts/meta-ad-library, schema
 * LOCAL_SCHEMA in lib/research.ts) into the workspace's ads. The browser sends `{ watchId?, createWatch?, own?, file, batch? }`,
 * gzipped when it can (Vercel caps request bodies at 4.5 MB); a big file comes as several requests, each with
 * a slice of the ads and a `batch` (lib/scrape-import.ts). The `research` function does the work.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/research/[productId]/import-local">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { t } = await getTranslator();
  const { productId } = await ctx.params;
  let text: string | null;
  try {
    text = await readBody(request);
  } catch {
    return Response.json({ error: t("Couldn't read the upload. Try again.") }, { status: 400 });
  }
  if (text === null) return Response.json({ error: t("That upload is over 10 MB. Reload the page (a current Research page sends a big file in parts) and import it again.") }, { status: 413 });
  let input: Record<string, unknown>;
  try {
    input = JSON.parse(text);
  } catch {
    return Response.json({ error: t("That isn't a JSON file.") }, { status: 400 });
  }
  if (!input?.file || typeof input.file !== "object") return Response.json({ error: t("Choose the scraper's .json file.") }, { status: 400 });
  const result = await research(session, "import-local", {
    productId,
    watchId: typeof input.watchId === "string" ? input.watchId : undefined,
    createWatch: input.createWatch === true,
    own: input.own === true,
    holdId: typeof input.holdId === "string" ? input.holdId : undefined,
    file: input.file,
    batch: input.batch && typeof input.batch === "object" ? input.batch : undefined,
  }, undefined, t);
  // Once the whole file is in, its new ads are read in the background.
  const last = !input.batch || (result.data as { batch?: { last?: boolean } }).batch?.last === true;
  if (result.ok && last) await readNewAds(session, productId, t);
  return Response.json(result.data, { status: result.ok ? 200 : result.status });
}
