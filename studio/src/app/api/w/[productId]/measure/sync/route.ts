import type { NextRequest } from "next/server";
import { isResponse, requireUser } from "@/lib/server/auth";
import { metricsFunction } from "@/lib/server/measure";

// A first sync reads 90 days from Meta, RevenueCat and AppStack: give it time.
export const maxDuration = 150;

/** "Sync now": the metrics edge function pulls every connected source into the snapshots. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/w/[productId]/measure/sync">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { productId } = await ctx.params;
  const body = await request.json().catch(() => ({})) as { days?: unknown };
  const result = await metricsFunction(session, "sync", { productId, days: Number(body.days) || undefined }, 145_000);
  return Response.json(result.data, { status: result.ok ? 200 : result.status });
}
