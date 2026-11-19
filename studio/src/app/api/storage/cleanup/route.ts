import type { NextRequest } from "next/server";
import { cleanCleanup } from "@/lib/storage-usage";
import { isResponse, requireUser } from "@/lib/server/auth";
import { callFunction, relay } from "@/lib/server/functions";
import { forgetStorage } from "@/lib/server/storage";

/**
 * A storage cleanup ({ action, appId?, days?, run? }): without `run` it answers what would be deleted
 * ({ files, bytes, items }) for the confirm; with `run: true` the backend removes the files and clears the
 * database rows that point at them. Removing an existing app's files happens only when the app is deleted.
 */
export async function POST(request: NextRequest) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const body = await request.json().catch(() => ({}));
  const input = cleanCleanup(body);
  if (typeof input === "string") return Response.json({ error: input }, { status: 400 });
  const result = await callFunction("install", session, "storage/cleanup", {
    body: { ...input, run: body.run === true }, timeoutMs: 140_000,
    messages: { unreachable: "Couldn't reach the backend to clean up. Nothing was deleted; try again in a moment.", notDeployed: "Cleanup needs the latest backend: update it (Settings > Updates)." },
  });
  if (body.run === true) forgetStorage();
  if (result.status === 404) return Response.json({ error: "Cleanup needs the latest backend: update it (Settings > Updates explains how). Nothing was deleted." }, { status: 503 });
  return relay(result);
}
