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
//
// Accounts mode (a `platform` row, 20261120100000_platform_accounts.sql) wins over both: every signed-in
// account with a confirmed email is let in as role "account" (its own keys, settings and storage:
// _shared/tenant.ts), unless it is suspended. Nobody is the owner there; `manager` is the account itself.
import type { SupabaseClient } from "@supabase/supabase-js";

export class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export interface Caller {
  id: string; email: string | null;
  /** False while the email address isn't confirmed (Supabase's "Confirm email"); accounts mode refuses those. */
  confirmed?: boolean;
}
export type Role = "owner" | "member" | "account";
/** accounts: a platform row. install: an install row (and no platform row). legacy: neither. */
export type Mode = "accounts" | "install" | "legacy";
/** `legacy`: no install row at all (set up before installs had owners), so no membership to check. */
export interface Member extends Caller { role: Role | "legacy" }

export interface InstallRow { ownerUserId: string | null; settings: Record<string, unknown> }
export interface PlatformRow { settings: Record<string, unknown> }
/** One row of `accounts` (accounts mode). */
export interface AccountRow {
  userId: string; plan: string; staff: boolean; status: "active" | "suspended";
  settings: Record<string, unknown>; limitsOverride: Record<string, unknown>;
}

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
  /**
   * Who may change keys and settings: the owner of an install; in accounts mode, the account itself
   * (each manages its own); on a legacy database, nobody (403, as `owner`).
   */
  manager(req: Request): Promise<Member>;
  /** The install row, or null when setup hasn't run on this database. */
  install(): Promise<InstallRow | null>;
  /** The platform row (accounts mode), or null. A missing table reads as null; any other failure is 503. */
  platform(): Promise<PlatformRow | null>;
  /** Which mode this database is in. */
  mode(): Promise<Mode>;
  /** An account's row, made on first use (accounts mode only; null in the other modes). */
  account(userId: string): Promise<AccountRow | null>;
  /** The role of a user id (for worker code that already knows the user). */
  roleOf(userId: string): Promise<Role | "legacy" | null>;
  /** Forget what is cached (all of it, or one account's row). */
  clear(userId?: string): void;
}

const ACCOUNT_CACHE_MAX = 500;
const UNAVAILABLE = "Couldn't check who may use this install. Try again in a moment.";

function readAccount(row: Record<string, unknown>): AccountRow {
  const obj = (value: unknown) => (value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {});
  return {
    userId: String(row.user_id), plan: typeof row.plan === "string" ? row.plan : "free", staff: row.staff === true,
    status: row.status === "suspended" ? "suspended" : "active", settings: obj(row.settings), limitsOverride: obj(row.limits_override),
  };
}

export function createAuth(db: SupabaseClient): Auth {
  let installCache: { at: number; row: InstallRow | null } | null = null;
  let platformCache: { at: number; row: PlatformRow | null } | null = null;
  const roleCache = new Map<string, { at: number; role: Role | null }>();
  const accountCache = new Map<string, { at: number; row: AccountRow }>();

  async function platform(): Promise<PlatformRow | null> {
    if (platformCache && Date.now() - platformCache.at < TTL_MS) return platformCache.row;
    const { data, error } = await db.from("platform").select("settings").maybeSingle();
    // No table (a database from before accounts existed) reads as no row. Any other failure is not an
    // answer: guessing "not accounts" would hand install-wide keys to every account.
    if (error && !isMissingTable(error)) throw new HttpError(503, UNAVAILABLE);
    const row = error || !data ? null : { settings: (data.settings as Record<string, unknown>) ?? {} };
    platformCache = { at: Date.now(), row };
    return row;
  }

  async function mode(): Promise<Mode> {
    if (await platform()) return "accounts";
    return (await install()) ? "install" : "legacy";
  }

  async function account(userId: string): Promise<AccountRow | null> {
    if (!(await platform())) return null;
    const hit = accountCache.get(userId);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.row;
    const { data, error } = await db.from("accounts").select("*").eq("user_id", userId).maybeSingle();
    if (error) throw new HttpError(503, UNAVAILABLE);
    let row = data as Record<string, unknown> | null;
    if (!row) {
      // First request of a new account: its row (free plan, active) is made now.
      const made = await db.rpc("account_ensure", { p_user: userId });
      if (made.error) throw new HttpError(503, UNAVAILABLE);
      row = (Array.isArray(made.data) ? made.data[0] : made.data) as Record<string, unknown> | null;
      if (!row) throw new HttpError(503, UNAVAILABLE);
    }
    const account = readAccount(row);
    if (accountCache.size >= ACCOUNT_CACHE_MAX) accountCache.delete(accountCache.keys().next().value!);
    accountCache.set(userId, { at: Date.now(), row: account });
    return account;
  }

  async function install(): Promise<InstallRow | null> {
    if (installCache && Date.now() - installCache.at < TTL_MS) return installCache.row;
    const { data, error } = await db.from("install").select("owner_user_id, settings").maybeSingle();
    // No table (a database from before the install migration) reads the same as no row. Any other
    // failure is not an answer: an install with an owner must never look ownerless because a read failed.
    if (error && !isMissingTable(error)) throw new HttpError(503, UNAVAILABLE);
    const row = error || !data ? null : { ownerUserId: (data.owner_user_id as string | null) ?? null, settings: (data.settings as Record<string, unknown>) ?? {} };
    installCache = { at: Date.now(), row };
    return row;
  }

  async function roleOf(userId: string): Promise<Role | "legacy" | null> {
    // Accounts mode: every account is its own; a suspended one is no one.
    if (await platform()) return (await account(userId))?.status === "active" ? "account" : null;
    const row = await install();
    // Only a database with no install row is an older, open install. A row without an owner is an
    // install that lost its owner: it must not open up to every account that can still sign in.
    if (!row) return "legacy";
    if (row.ownerUserId && row.ownerUserId === userId) return "owner";
    const hit = roleCache.get(userId);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.role;
    const { data, error } = await db.from("install_members").select("role").eq("user_id", userId).maybeSingle();
    if (error) throw new HttpError(503, UNAVAILABLE);
    const role = data ? ((data.role as Role) === "owner" ? "owner" : "member") : null;
    roleCache.set(userId, { at: Date.now(), role });
    return role;
  }

  async function user(req: Request): Promise<Caller> {
    const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) throw new HttpError(401, "Sign in first.");
    const { data, error } = await db.auth.getUser(token);
    if (error || !data.user) throw new HttpError(401, "Your session has expired. Sign in again.");
    return { id: data.user.id, email: data.user.email ?? null, confirmed: Boolean((data.user as { email_confirmed_at?: string | null }).email_confirmed_at) };
  }

  async function member(req: Request): Promise<Member> {
    const { confirmed, ...caller } = await user(req);
    if (await platform()) {
      if (!confirmed) throw new HttpError(403, "Confirm your email address first: open the link we sent you, then sign in again.");
      const row = await account(caller.id);
      if (row?.status !== "active") throw new HttpError(403, "This account is suspended. Contact support if you think this is a mistake.");
      return { ...caller, role: "account" };
    }
    const role = await roleOf(caller.id);
    if (!role) throw new HttpError(403, "This account isn't a member of this install. Ask its owner to add you.");
    return { ...caller, role };
  }

  async function owner(req: Request): Promise<Member> {
    const caller = await member(req);
    if (caller.role !== "owner") throw new HttpError(403, "Only the owner of this install can do that.");
    return caller;
  }

  async function manager(req: Request): Promise<Member> {
    return (await platform()) ? member(req) : owner(req);
  }

  return {
    user, member, owner, manager, install, platform, mode, account, roleOf,
    clear(userId?: string) {
      if (userId) { accountCache.delete(userId); roleCache.delete(userId); return; }
      installCache = null; platformCache = null; roleCache.clear(); accountCache.clear();
    },
  };
}
