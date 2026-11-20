// Who may drive the install's Meta token, and which ad accounts it may write to.
//
// An install that has been through setup has an owner: the owner and the members they added may use
// Launch, and the email list below is ignored. An install from before setup existed has no owner, and
// keeps the optional email list (an unset list allows everyone signed in). The ad account list is an
// optional edge function setting on both.
//   LAUNCH_ALLOWED_EMAILS     comma (or space) separated emails of the people who may use Launch
//                             (only read on an install with no owner)
//   META_ALLOWED_AD_ACCOUNTS  comma separated ad account ids (act_ optional) Launch may write to
import type { Role } from "../_shared/auth.ts";

/** A comma/space separated list, trimmed and lower-cased, empties dropped. */
export const list = (raw: string | undefined) => (raw ?? "").toLowerCase().split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);

/** Why this person may not use Launch on an install with no owner (the email list), or null when they may. */
export function launchRefusal(email: string | null | undefined, raw: string | undefined): string | null {
  const allowed = list(raw);
  if (!allowed.length) return null;
  if (!email || !allowed.includes(email.trim().toLowerCase())) {
    return "Launch drives the team's Meta token, so it's limited to the people in LAUNCH_ALLOWED_EMAILS (Supabase → Edge Functions → Secrets).";
  }
  return null;
}

/**
 * Why this person may not use Launch, or null when they may. `role` is their role in the install
 * (_shared/auth.ts roleOf): an owner or member may, whatever the email list says; someone who is
 * neither may not; `legacy` (an install with no owner) falls back to the email list.
 */
export function launchAccess(role: Role | "legacy" | null, email: string | null | undefined, raw: string | undefined): string | null {
  if (role === "legacy") return launchRefusal(email, raw);
  // accounts mode: every account drives its own token, on its own workspaces.
  if (role === "owner" || role === "member" || role === "account") return null;
  return "This account isn't a member of this install. Ask its owner to add you.";
}

/** The ad account ids (digits, no act_) on META_ALLOWED_AD_ACCOUNTS. */
export const allowedAdAccounts = (raw: string | undefined) => list(raw).map((a) => a.replace(/^act_/, ""));

/**
 * Why Launch may not use this ad account, or null when it may. With no list set, any account may be
 * used; with one, only the accounts on it. `write` (every call that changes something on Meta) also
 * needs an ad account id in the workspace's settings.
 */
export function adAccountRefusal(adAccountId: string | undefined, raw: string | undefined, write: boolean): string | null {
  const allowed = allowedAdAccounts(raw);
  const id = (adAccountId ?? "").trim().replace(/^act_/, "");
  if (!id && write) return "Add the ad account id to this workspace's Launch settings first.";
  if (!allowed.length) return null;
  if (!id) return write ? "Add the ad account id to this workspace's Launch settings first." : null;
  if (!allowed.includes(id)) return "This ad account isn't on the list Launch may use (META_ALLOWED_AD_ACCOUNTS).";
  return null;
}
