import { getTranslator } from "@/lib/i18n/server";
import type { NextRequest } from "next/server";
import { isResponse, requireUser } from "@/lib/server/auth";
import { callFunction, relay } from "@/lib/server/functions";
import type { InstallState } from "@/lib/install/types";

/** Changes the install's settings (name, AI provider, models, limits, research sources). Owner only; the backend enforces it. */
export async function PATCH(request: NextRequest) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return Response.json({ error: (await getTranslator()).t("Nothing to change.") }, { status: 400 });
  const { name, aiProvider, models, limits, research } = body;
  return relay(await callFunction<InstallState>("install", session, "settings", { body: { name, aiProvider, models, limits, research } }));
}
