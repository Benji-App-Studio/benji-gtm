import type { NextRequest } from "next/server";
import { isResponse, requireUser } from "@/lib/server/auth";
import { callFunction, relay } from "@/lib/server/functions";
import type { KeyState } from "@/lib/install/types";

/** Checks a stored key against its provider again and answers with its new state. */
export async function POST(_request: NextRequest, ctx: RouteContext<"/api/install/keys/[name]/verify">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { name } = await ctx.params;
  return relay(await callFunction<{ key: KeyState }>("install", session, "keys/verify", { body: { name }, timeoutMs: 45_000 }));
}
