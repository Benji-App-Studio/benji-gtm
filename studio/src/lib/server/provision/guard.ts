// Who may use the setup routes. Before the install is connected, only a browser on this same
// computer; afterwards, only the signed-in owner. Pure, so the rules are tested without a server.

const LOOPBACK_NAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** The host part of a `Host` header or of an origin, lower-case, without the port. */
function hostName(value: string): string | null {
  const text = value.trim().toLowerCase();
  if (!text || /[\s/@,]/.test(text.replace(/^https?:\/\//, ""))) return null;
  try { return new URL(text.includes("://") ? text : `http://${text}`).hostname; } catch { return null; }
}

/** True for localhost, 127.0.0.1, [::1] and names ending in .localhost (with or without a port). */
export function isLoopbackHost(value: string | null | undefined): boolean {
  if (!value) return false;
  const name = hostName(value);
  if (!name) return false;
  return LOOPBACK_NAMES.has(name) || name.endsWith(".localhost") || /^127(\.\d{1,3}){3}$/.test(name);
}

const isLoopbackAddress = (value: string): boolean => {
  const address = value.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/^::ffff:/, "");
  return address === "::1" || address === "localhost" || /^127(\.\d{1,3}){3}$/.test(address);
};

export interface RequestOrigin {
  host: string | null;
  /** Sent by browsers on POST requests; absent on plain navigation and from command-line tools. */
  origin: string | null;
  /** The connecting address, when the server reports it. */
  forwardedFor?: string | null;
}

/**
 * Whether a request was made by a browser on this computer, to this computer: the `Host` must be a
 * loopback name (so the page wasn't reached over the network or through a tunnel), the `Origin`,
 * when sent, must be one too (so another website can't post here), and so must the connecting
 * address when the server passes it on.
 */
export function isLocalRequest(request: RequestOrigin): boolean {
  if (!isLoopbackHost(request.host)) return false;
  if (request.origin != null && request.origin !== "" && !isLoopbackHost(request.origin)) return false;
  if (request.forwardedFor) {
    const hops = request.forwardedFor.split(",").map((hop) => hop.trim()).filter(Boolean);
    if (hops.some((hop) => !isLoopbackAddress(hop))) return false;
  }
  return true;
}

export type SetupAccess =
  | { allowed: true; mode: "first-run" | "owner" }
  | { allowed: false; status: 401 | 403; reason: string };

/**
 * The rule for every setup route:
 *   not configured yet  -> allowed from this computer only
 *   configured          -> allowed for the signed-in owner only
 *   accounts mode       -> allowed for signed-in staff only (lib/install/setup-access.ts shows /setup to staff
 *                          only; there is no install of an account's own to set up or update)
 */
export function decideSetupAccess(input: { configured: boolean; local: boolean; signedIn: boolean; role: string | null; accounts?: { staff: boolean } }): SetupAccess {
  if (!input.configured) {
    return input.local
      ? { allowed: true, mode: "first-run" }
      : { allowed: false, status: 403, reason: "Setup can only be done on the computer the app is running on. Start the app with start.command and open it there, at its localhost address." };
  }
  if (!input.signedIn) return { allowed: false, status: 401, reason: "Sign in as the owner to continue." };
  if (input.accounts) {
    return input.accounts.staff ? { allowed: true, mode: "owner" } : { allowed: false, status: 403, reason: "Only staff can do this." };
  }
  if (input.role !== "owner") return { allowed: false, status: 403, reason: "Only the owner of this install can do this." };
  return { allowed: true, mode: "owner" };
}

/** The address the app is reached at, taken from a local request (used for Supabase's redirect list). */
export function appOriginOf(request: RequestOrigin, protocol: string = "http"): string | null {
  if (request.origin && isLoopbackHost(request.origin)) {
    try { return new URL(request.origin).origin; } catch { /* fall through to the host */ }
  }
  return request.host && isLoopbackHost(request.host) ? `${protocol}://${request.host.trim().toLowerCase()}` : null;
}
