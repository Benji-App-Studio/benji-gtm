import { getInstallConfig } from "@/lib/install/config";
import { isResponse } from "@/lib/server/auth";
import { isLocalRequest } from "@/lib/server/provision/guard";
import { NO_STORE, requestOrigin, setupCaller } from "@/lib/server/provision/request-access";

/** Where setup stands, for the page: whether a project is connected and whether this caller may run setup. */
export async function GET(request: Request) {
  const caller = await setupCaller(request);
  const allowed = !isResponse(caller);
  return Response.json({
    configured: Boolean(getInstallConfig()),
    local: isLocalRequest(requestOrigin(request)),
    allowed,
    mode: allowed ? caller.mode : null,
    reason: allowed ? null : ((await caller.json().catch(() => null)) as { error?: string } | null)?.error ?? null,
  }, { headers: NO_STORE });
}
