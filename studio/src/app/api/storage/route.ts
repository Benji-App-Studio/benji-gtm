import type { NextRequest } from "next/server";
import { isResponse, requireUser } from "@/lib/server/auth";
import { storageSummary } from "@/lib/server/storage";

/** How full storage is: the summary by kind and app against the plan's quota (kept for a minute; `?fresh=1` measures again). */
export async function GET(request: NextRequest) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const read = await storageSummary(session, { fresh: request.nextUrl.searchParams.get("fresh") === "1" });
  return "error" in read ? Response.json({ error: read.error }, { status: read.status }) : Response.json(read.summary, { headers: { "Cache-Control": "private, max-age=60" } });
}
