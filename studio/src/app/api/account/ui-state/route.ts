import { getTranslator } from "@/lib/i18n/server";
import { isResponse, requireUser } from "@/lib/server/auth";
import { readUiState, writeUiState } from "@/lib/server/ui-state";
import { validUiEntry } from "@/lib/ui-state";

/** The account's UI choices (lib/ui-state.ts): `{ state, stored }`; `stored: false` before the migration. */
export async function GET() {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { state, stored } = await readUiState(session);
  return Response.json({ state, stored }, { headers: { "Cache-Control": "no-store" } });
}

/** One change: `{ key, value }` (value null removes it). Only the keys lib/ui-state.ts knows. */
export async function PATCH(request: Request) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const body = (await request.json().catch(() => ({}))) as { key?: unknown; value?: unknown };
  if (!validUiEntry(body.key, body.value ?? null)) return Response.json({ error: (await getTranslator()).t("Unknown setting.") }, { status: 400 });
  const result = await writeUiState(session, body.key, (body.value as string | null | undefined) ?? null);
  return Response.json(result);
}
