import type { NextRequest } from "next/server";
import { getTranslator } from "@/lib/i18n/server";
import { isResponse, requireUser } from "@/lib/server/auth";
import { VERIFIERS, type VerifyResult } from "@/lib/server/connections";
import { loadRow } from "@/lib/server/workspaces";
import { toWorkspace, toWorkspaceView, WORKSPACE_COLUMNS, type WorkspaceRow } from "@/lib/workspace";
import { CONNECTION_KEYS, connectionValues, type ConnectionCheck, type ConnectionKey } from "@/lib/workspace-schema";
import { dbFailure, logCaught } from "@/lib/server/errors";

/**
 * Checks one connection ({ connection: "meta" | "revenuecat" | "appstack" | "storage" }) and records
 * the result against the values it checked, so editing them later drops the connection back to "set".
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/workspaces/[id]/verify">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const row = await loadRow(session, (await ctx.params).id);
  if (isResponse(row)) return row;
  const { connection } = await request.json().catch(() => ({}));
  const { t } = await getTranslator();
  if (!CONNECTION_KEYS.includes(connection)) return Response.json({ error: t("Choose a connection to check.") }, { status: 400 });
  const key = connection as ConnectionKey;
  const workspace = toWorkspace(row);
  if (!connectionValues(workspace.connections, key)) return Response.json({ error: t("Save the IDs first.") }, { status: 400 });

  let result: VerifyResult;
  try {
    result = await VERIFIERS[key]({ workspace, supabase: session.supabase, userId: session.user.id });
  } catch (error) {
    // Stored in English with the check; the page translates it where it shows it (connectionMessage).
    result = { ok: false, message: `The check failed: ${logCaught("workspace verify", error, "something went wrong. Try again.")}`.slice(0, 400) };
  }
  if (result.pending) return Response.json({ result, workspace: toWorkspaceView(row) });

  const check: ConnectionCheck = { ok: result.ok, message: result.message.slice(0, 400), checkedAt: new Date().toISOString(), values: connectionValues(workspace.connections, key) };
  const { data, error } = await session.supabase.from("products").update({ connection_checks: { ...row.connection_checks, [key]: check } })
    .eq("id", row.id).select(WORKSPACE_COLUMNS).single<WorkspaceRow>();
  if (error) return dbFailure("workspace verify save", error, t("The check ran but its result couldn't be saved. Try again."), 500, {}, t);
  return Response.json({ result, workspace: toWorkspaceView(data) });
}
