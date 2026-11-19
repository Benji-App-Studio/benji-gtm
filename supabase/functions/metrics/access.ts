// Who may use the install's ad and revenue tokens through Measure.
//
// An install that has been through setup has an owner: the owner and the members they added may sync,
// the scheduled sync pulls their workspaces, and the email list below is ignored. An install from
// before setup existed has no owner and keeps MEASURE_ALLOWED_EMAILS, an optional comma (or space)
// separated list of emails: unset allows everyone signed in (and the scheduled sync pulls every
// connected workspace); set it to narrow both.
import type { Role } from "../_shared/auth.ts";

/** A user's role in the install (_shared/auth.ts roleOf): `legacy` when the install has no owner, null for a stranger. */
export type InstallRole = Role | "legacy" | null;

export const emails = (raw: string | undefined) => (raw ?? "").toLowerCase().split(/[\s,]+/).filter(Boolean);

export const isAllowed = (email: string | null | undefined, raw: string | undefined) => {
  const list = emails(raw);
  if (!list.length) return true;
  return Boolean(email) && list.includes(email!.trim().toLowerCase());
};

/**
 * May this person use Measure? An owner or member may, whatever the email list says; someone who is
 * neither may not; `legacy` (an install with no owner) falls back to the email list.
 */
export const mayMeasure = (role: InstallRole, email: string | null | undefined, raw: string | undefined) =>
  role === "legacy" ? isAllowed(email, raw) : role === "owner" || role === "member";

/**
 * The owners (user ids) whose workspaces the scheduled sync may pull. With `roleOf`, the install's
 * owner and members are in and strangers are out. Anyone it calls `legacy` (and everyone, without
 * `roleOf`) is checked the old way: each one's email looked up once and checked against the list, all
 * of them in when the list is unset. An owner whose role or email can't be read is left out.
 */
export async function allowedOwners(
  userIds: string[], emailOf: (id: string) => Promise<string | null>, raw: string | undefined,
  roleOf?: (id: string) => Promise<InstallRole>,
): Promise<Set<string>> {
  const out = new Set<string>();
  const legacy: string[] = [];
  for (const id of new Set(userIds)) {
    const role = roleOf ? await roleOf(id).catch(() => null) : "legacy";
    if (role === "legacy") legacy.push(id);
    else if (role) out.add(id);
  }
  const listed = emails(raw).length > 0;
  for (const id of legacy) {
    if (!listed) { out.add(id); continue; }
    const email = await emailOf(id).catch(() => null);
    if (isAllowed(email, raw)) out.add(id);
  }
  return out;
}
