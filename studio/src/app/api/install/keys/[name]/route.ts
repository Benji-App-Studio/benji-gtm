import { getTranslator } from "@/lib/i18n/server";
import type { NextRequest } from "next/server";
import { isResponse, requireUser } from "@/lib/server/auth";
import { callFunction, relay } from "@/lib/server/functions";
import type { KeyState } from "@/lib/install/types";

/** Stores one API key in the project's Vault. The backend checks it live first; a failed check answers 400 with `error`. */
export async function PUT(request: NextRequest, ctx: RouteContext<"/api/install/keys/[name]">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { name } = await ctx.params;
  const body = (await request.json().catch(() => null)) as { value?: unknown } | null;
  if (typeof body?.value !== "string" || !body.value.trim()) return Response.json({ error: (await getTranslator()).t("Paste the key first.") }, { status: 400 });
  return relay(await callFunction<{ key: KeyState }>("install", session, "keys/put", { body: { name, value: body.value }, timeoutMs: 45_000 }));
}

/** Removes one API key from the project's Vault. */
export async function DELETE(_request: NextRequest, ctx: RouteContext<"/api/install/keys/[name]">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { name } = await ctx.params;
  return relay(await callFunction<{ ok: true }>("install", session, "keys/delete", { body: { name } }));
}
