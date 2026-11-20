import type { NextRequest } from "next/server";
import { isResponse, requireUser } from "@/lib/server/auth";
import { metricsFunction } from "@/lib/server/measure";

// A first sync reads 90 days from Meta, RevenueCat and AppStack: give it time.
export const maxDuration = 150;

/** "Sync now": the metrics edge function pulls every connected source (or only `sources`) into the snapshots. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/w/[productId]/measure/sync">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { productId } = await ctx.params;
  const body = await request.json().catch(() => ({})) as { days?: unknown; sources?: unknown };
  // A connection card syncs only its own source (the edge function keeps to the names it knows).
  const sources = Array.isArray(body.sources) ? body.sources.filter((s): s is string => typeof s === "string").slice(0, 5) : undefined;
  const result = await metricsFunction(session, "sync", { productId, days: Number(body.days) || undefined, sources }, 145_000);
  return Response.json(result.data, { status: result.ok ? 200 : result.status });
}
