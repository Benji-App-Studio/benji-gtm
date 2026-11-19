import type { NextRequest } from "next/server";
import { isResponse, requireUser } from "@/lib/server/auth";
import { research } from "@/lib/server/research";

/** Checking thousands of file sizes takes a while. */
export const maxDuration = 150;

const MAX_BYTES = 10 * 1024 * 1024;

/**
 * The import pop-up's storage check: the browser sends `{ holdId, files: [{ url, kind }] }` (gzipped when it
 * can) for the files a scraper file would store; the research function's `media-preview` measures them and
 * says what's already stored, what's over the upload limit and what won't fit.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/research/[productId]/media-preview">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { productId } = await ctx.params;
  let input: { holdId?: unknown; files?: unknown };
  try {
    const gzip = (request.headers.get("content-type") ?? "").includes("gzip");
    const body = gzip && request.body ? request.body.pipeThrough(new DecompressionStream("gzip")) : request.body;
    const text = body ? await new Response(body).text() : "";
    if (text.length > MAX_BYTES) return Response.json({ error: "Too many files to check at once." }, { status: 413 });
    input = JSON.parse(text);
  } catch {
    return Response.json({ error: "Couldn't read the request." }, { status: 400 });
  }
  const result = await research(session, "media-preview", { productId, holdId: input.holdId, files: input.files }, 140_000);
  return Response.json(result.data, { status: result.ok ? 200 : result.status });
}
