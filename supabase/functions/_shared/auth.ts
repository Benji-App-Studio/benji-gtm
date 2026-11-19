// Who is calling an edge function, and whether this install lets them in.
//
// An install that has been through setup has one `install` row naming its owner. Only the owner and
// the people in `install_members` may use the functions (they spend the owner's API keys). An install
// from before setup existed has no such row: every signed-in user is let in, as before, and the
// Launch and Measure functions keep their own email allow-lists.
//
// A row whose owner is gone (the owner's account was deleted, which empties `owner_user_id`) is NOT
// such an older install: its keys are still in Vault, so it stays closed to everyone but the members
// that are left, and nobody is the owner until setup names one again.
import type { SupabaseClient } from "@supabase/supabase-js";

export class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export interface Caller { id: string; email: string | null }
export type Role = "owner" | "member";
/** `legacy`: no install row at all (set up before installs had owners), so no membership to check. */
export interface Member extends Caller { role: Role | "legacy" }

export interface InstallRow { ownerUserId: string | null; settings: Record<string, unknown> }

const TTL_MS = 30_000;

/** Postgres "undefined table" (42P01), or PostgREST not finding it in its schema cache (PGRST205). */
const isMissingTable = (error: { code?: string; message?: string }) =>
  error.code === "42P01" || error.code === "PGRST205" || /does not exist|schema cache/i.test(error.message ?? "");

export interface Auth {
  /** The signed-in user behind the request's Bearer token, or 401. */
  user(req: Request): Promise<Caller>;
  /** The same, and 403 unless this install lets them in. */
  member(req: Request): Promise<Member>;
  /** The same, and 403 unless they own the install. On an install without an owner, 403 for everyone. */
  owner(req: Request): Promise<Member>;
  /** The install row, or null when setup hasn't run on this database. */
  install(): Promise<InstallRow | null>;
  /** The role of a user id (for worker code that already knows the user). */
  roleOf(userId: string): Promise<Role | "legacy" | null>;
  clear(): void;
}

export function createAuth(db: SupabaseClient): Auth {
  let installCache: { at: number; row: InstallRow | null } | null = null;
  const roleCache = new Map<string, { at: number; role: Role | null }>();

  async function install(): Promise<InstallRow | null> {
    if (installCache && Date.now() - installCache.at < TTL_MS) return installCache.row;
    const { data, error } = await db.from("install").select("owner_user_id, settings").maybeSingle();
    // No table (a database from before the install migration) reads the same as no row. Any other
    // failure is not an answer: an install with an owner must never look ownerless because a read failed.
    if (error && !isMissingTable(error)) throw new HttpError(503, "Couldn't check who may use this install. Try again in a moment.");
    const row = error || !data ? null : { ownerUserId: (data.owner_user_id as string | null) ?? null, settings: (data.settings as Record<string, unknown>) ?? {} };
    installCache = { at: Date.now(), row };
    return row;
  }

  async function roleOf(userId: string): Promise<Role | "legacy" | null> {
    const row = await install();
    // Only a database with no install row is an older, open install. A row without an owner is an
    // install that lost its owner: it must not open up to every account that can still sign in.
    if (!row) return "legacy";
    if (row.ownerUserId && row.ownerUserId === userId) return "owner";
    const hit = roleCache.get(userId);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.role;
    const { data, error } = await db.from("install_members").select("role").eq("user_id", userId).maybeSingle();
    if (error) throw new HttpError(503, "Couldn't check who may use this install. Try again in a moment.");
    const role = data ? ((data.role as Role) === "owner" ? "owner" : "member") : null;
    roleCache.set(userId, { at: Date.now(), role });
    return role;
  }

  async function user(req: Request): Promise<Caller> {
    const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) throw new HttpError(401, "Sign in first.");
    const { data, error } = await db.auth.getUser(token);
    if (error || !data.user) throw new HttpError(401, "Your session has expired. Sign in again.");
    return { id: data.user.id, email: data.user.email ?? null };
  }

  async function member(req: Request): Promise<Member> {
    const caller = await user(req);
    const role = await roleOf(caller.id);
    if (!role) throw new HttpError(403, "This account isn't a member of this install. Ask its owner to add you.");
    return { ...caller, role };
  }

  async function owner(req: Request): Promise<Member> {
    const caller = await member(req);
    if (caller.role !== "owner") throw new HttpError(403, "Only the owner of this install can do that.");
    return caller;
  }

  return { user, member, owner, install, roleOf, clear() { installCache = null; roleCache.clear(); } };
}
