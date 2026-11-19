import "server-only";
// The guard every setup route starts with (the rules themselves are in guard.ts), and what the routes
// share: where the app's files are and how the local config is written.
import { getInstallConfig, projectRef, writeInstallConfig } from "@/lib/install/config";
import { isLocalMode, startedLocalOnly } from "@/lib/install/local-auth";
import { isResponse, requireUser } from "@/lib/server/auth";
import { appOriginOf, decideSetupAccess, isLocalRequest, type RequestOrigin } from "./guard";
import { isProjectRef } from "./management-api";
import { findRepoRoot, nodeFiles } from "./node-files";
import type { ProvisionDeps } from "./run";
import { ProvisionError } from "./types";

export interface SetupCaller {
  /** `first-run`: nothing is connected yet and the request came from this computer. `owner`: the signed-in owner. */
  mode: "first-run" | "owner";
  /** The address the app is open at, when it is a local one. */
  appOrigin: string | null;
  /** The connected project, once there is one. Updates always go to it, whatever the request says. */
  connectedRef: string | null;
}

export const NO_STORE = { "Cache-Control": "no-store" };

export const refuse = (status: number, error: string, detail?: string) => Response.json(detail ? { error, detail } : { error }, { status, headers: NO_STORE });

export function requestOrigin(request: Request): RequestOrigin {
  return { host: request.headers.get("host"), origin: request.headers.get("origin"), forwardedFor: request.headers.get("x-forwarded-for") };
}

export { startedLocalOnly };

/**
 * Whether this request is on a copy in local mode (lib/install/local-auth.ts): the local file config,
 * started on this computer only, and a request from this computer (Host, Origin and address).
 */
export function localModeRequest(request: Request): boolean {
  const from = requestOrigin(request);
  return isLocalMode({ source: getInstallConfig()?.source, startedLocal: startedLocalOnly(), host: from.host, origin: from.origin, forwardedFor: from.forwardedFor });
}

/** Who is calling a setup route, or the response that turns them away. */
export async function setupCaller(request: Request): Promise<SetupCaller | Response> {
  const from = requestOrigin(request);
  // A request can claim any Host or X-Forwarded-For, so the headers alone never prove it came from this
  // computer. First-run setup is only open when the app was started listening on this computer alone
  // (start.command does that and says so with INSTALL_SETUP_LOCAL=1).
  const local = startedLocalOnly() && isLocalRequest(from);
  const config = getInstallConfig();
  let signedIn = false;
  let role: string | null = null;
  if (config) {
    const session = await requireUser();
    if (!isResponse(session)) {
      signedIn = true;
      const { data } = await session.supabase.from("install_members").select("role").eq("user_id", session.user.id).maybeSingle<{ role: string }>();
      role = data?.role ?? null;
    }
  }
  const access = decideSetupAccess({ configured: Boolean(config), local, signedIn, role });
  if (!access.allowed) return refuse(access.status, access.reason);
  return { mode: access.mode, appOrigin: local ? appOriginOf(from) : null, connectedRef: config ? projectRef(config.supabaseUrl) : null };
}

/** The request's JSON body with the access token checked for shape. The token is used and dropped. */
export async function readSetupBody(request: Request): Promise<{ token: string; body: Record<string, unknown> } | Response> {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  if (!body || !token) return refuse(400, "Paste your Supabase access token first.");
  if (token.length > 500 || /\s/.test(token)) return refuse(400, "That doesn't look like a Supabase access token. Copy it again, with no spaces.");
  return { token, body };
}

/** Which project a request is about: the connected one for the owner, the picked one on a first run. */
export function targetRef(caller: SetupCaller, body: Record<string, unknown>): string | Response {
  if (caller.mode === "owner") {
    return caller.connectedRef ?? refuse(409, "This install isn't connected to a hosted Supabase project, so it can't be updated from here.");
  }
  return isProjectRef(body.ref) ? body.ref : refuse(400, "Pick a project from the list first.");
}

/** Real `fetch`, the app's own files and the local config writer. */
export function provisionDeps(): ProvisionDeps {
  return { fetch: (input, init) => fetch(input, init), files: nodeFiles(findRepoRoot()), writeConfig: writeInstallConfig };
}

export function refuseError(error: unknown): Response {
  if (error instanceof ProvisionError) {
    const status = error.code === "has_data" || error.code === "not_ready" || error.code === "no_project" ? 409 : error.status === 401 ? 401 : 502;
    return refuse(status, error.message, error.detail);
  }
  return refuse(500, "Something unexpected went wrong. Try again.");
}
