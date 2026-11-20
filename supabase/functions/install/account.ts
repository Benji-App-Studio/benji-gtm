// Settings > Account > Delete my account: the caller deletes their OWN account, never anyone else's (the
// id comes from the session only; nothing in the request names a user). Records: account_deletions and
// deleted_apps (migration 20261120500000_account_deletion.sql).
//
// Who may: an account in accounts mode, except the install's owner and the last staff account; in install
// mode a member, never the owner (the owner transfers or deletes the whole install instead); nobody on a
// legacy database. A deletion already started may always be carried on by its account.
//
// What happens, in this order, so a call that stops part way (an error, the time budget, a closed tab) is
// carried on by the next call or by the sweeper, and no file is ever left without a record of whose it is:
//   1. start (once): an account_deletions row, and the account is locked at once so nothing new is added:
//      accounts mode suspends it (the workers, the database's install_allows and uploads stop); install
//      mode removes its membership (the same, for a member). Only this route still lets it in.
//   2. each app: recorded in deleted_apps (its id can never be used again), then its row is deleted, which
//      cascades to every other table for it (research, creatives, generation jobs, launch drafts and
//      tracking, Measure data), so no worker keeps writing for it.
//   3. each app the account ever had (app_owners, deleted_apps): its folders in creatives and ad-media,
//      a batch at a time within the time budget.
//   4. the account's own folders (workspace/<user>/, thumbs/<user>/).
//   5. the sign-in itself (auth.users, with the service role). Every remaining row keyed to the user
//      cascades from it (accounts, account_usage, account_secrets_meta, account_rate, app_owners, profiles,
//      …), and its trigger purges every Vault key under `acct:<user>:`.
//   6. account_deletions.finished_at. The sweeper looks at the folders again 3 and 24 hours later (a
//      signed upload URL made before the deletion lives 2 hours), then forgets the user id.
// Ads already created in the person's own Meta ad account are not touched (they are Meta's, not ours).
//
// One call at a time (a lease); each works for at most `budgetMs` and answers { done: false } with what it
// removed so far; the studio calls again, and the sweeper (cron, every ten minutes) carries on any deletion
// left alone for five minutes. The log line carries counts and the mode only, never an id or an email.
import type { SupabaseClient } from "@supabase/supabase-js";
import { type Auth, HttpError } from "../_shared/auth.ts";
import type { Tenancy } from "../_shared/tenant.ts";

/** What the request must carry to start a deletion: the studio sends it once the person typed the confirmation word. */
export const DELETE_CONFIRM = "delete-my-account";
/** Starting a deletion (accounts mode, per account): carrying one on is never limited. */
export const DELETE_RATE: readonly [number, number] = [3600, 10];
const DELETE_BUCKET = "install.account_delete";
/** How long one call works before answering { done: false }; the studio's call waits 140 s. */
const BUDGET_MS = 90_000;
/** How long the sweeper works per wake-up. */
const SWEEP_BUDGET_MS = 120_000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** An error with a stable code the studio translates (the English is for logs and older studios). */
export class DeleteError extends HttpError {
  constructor(status: number, readonly code: string, message: string) { super(status, message); }
}

export interface DeleteResult { deleted: boolean; done: boolean; apps: number; files: number; bytes: number }

interface Storage {
  clearFolder(bucket: string, prefix: string, stop?: () => boolean): Promise<{ files: number; bytes: number; done: boolean }>;
}

export interface AccountDeletionDeps {
  db: SupabaseClient; auth: Auth; tenancy: Tenancy; storage: Storage;
  now?: () => number; budgetMs?: number;
  /** Where the one log line goes (default console.log). */
  log?: (line: string) => void;
}

type DeleteMode = "accounts" | "install";
interface Caller { id: string; mode: DeleteMode; staff: boolean; resuming: boolean }
interface Deletion { user_id: string; mode: DeleteMode; touched_at: string; lease_until: string | null; finished_at: string | null; sweeps: number }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OWNER_TEXT = "The owner can't delete their account here. Give the workspace to someone else first, or delete the whole workspace (its Supabase project).";

export function createAccountDeletion({ db, auth, tenancy, storage, now = Date.now, budgetMs = BUDGET_MS, log = console.log }: AccountDeletionDeps) {
  const iso = (ms: number) => new Date(ms).toISOString();

  async function deletionOf(id: string): Promise<Deletion | null> {
    const { data, error } = await db.from("account_deletions").select("*").eq("user_id", id).maybeSingle();
    if (error) throw new HttpError(503, "Account deletion isn't available yet: apply the latest database update, then try again.");
    return data as Deletion | null;
  }

  /** The caller, and whether they may delete (or carry on deleting) their account here. */
  async function who(req: Request): Promise<Caller> {
    const user = await auth.user(req);
    const mode = await auth.mode();
    if (mode === "legacy") throw new DeleteError(403, "not_available", "Accounts can't be deleted in this workspace. Ask whoever runs it.");
    const open = await deletionOf(user.id);
    if (open && !open.finished_at) return { id: user.id, mode: open.mode, staff: false, resuming: true };
    if (mode === "install") {
      const role = await auth.roleOf(user.id);
      if (role === "owner") throw new DeleteError(403, "owner", OWNER_TEXT);
      if (role !== "member") throw new HttpError(403, "This account isn't a member of this install. Ask its owner to add you.");
      return { id: user.id, mode, staff: false, resuming: false };
    }
    const { data, error } = await db.from("accounts").select("status, staff").eq("user_id", user.id).maybeSingle();
    if (error) throw new HttpError(503, "Couldn't check who may use this install. Try again in a moment.");
    const row = data as { status?: string; staff?: boolean } | null;
    if (row?.status === "suspended") throw new HttpError(403, "This account is suspended. Contact support if you think this is a mistake.");
    // The install's owner (from before accounts mode) and the last staff account run the platform.
    const install = await auth.install();
    if (install?.ownerUserId === user.id) throw new DeleteError(403, "owner", OWNER_TEXT);
    if (row?.staff) {
      const { data: staff, error: failed } = await db.from("accounts").select("user_id").eq("staff", true).eq("status", "active");
      if (failed) throw new HttpError(503, "Couldn't check who may use this install. Try again in a moment.");
      if (!((staff ?? []) as { user_id: string }[]).some((s) => s.user_id !== user.id)) {
        throw new DeleteError(403, "last_staff", "The last staff account can't be deleted. Make another account staff first.");
      }
    }
    return { id: user.id, mode, staff: row?.staff === true, resuming: false };
  }

  /** Step 1: the record, and the account locked so nothing new is added while it is emptied. */
  async function start(caller: Caller) {
    const { error } = await db.from("account_deletions").upsert({ user_id: caller.id, mode: caller.mode }, { onConflict: "user_id", ignoreDuplicates: true });
    if (error) throw new Error(`The deletion couldn't be started: ${error.message}`);
    if (caller.mode === "accounts") {
      const { data } = await db.from("accounts").select("user_id").eq("user_id", caller.id).maybeSingle();
      if (!data) await db.rpc("account_ensure", { p_user: caller.id });
      const { error: locked } = await db.from("accounts").update({ status: "suspended" }).eq("user_id", caller.id);
      if (locked) throw new Error(`The account couldn't be locked for deletion: ${locked.message}`);
    } else {
      const { error: removed } = await db.from("install_members").delete().eq("user_id", caller.id).neq("role", "owner");
      if (removed) throw new Error(`The account couldn't be locked for deletion: ${removed.message}`);
    }
    auth.clear(caller.id);
    tenancy.clear(caller.id);
  }

  async function column(table: string, col: string, filter: [string, string]): Promise<string[]> {
    const { data, error } = await db.from(table).select(col).eq(filter[0], filter[1]);
    if (error) throw new Error(`Couldn't read the account's apps: ${error.message}`);
    return ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => String(r[col])).filter((v) => UUID.test(v));
  }

  /** Steps 2 to 6 for one account, within the time budget. */
  async function proceed(id: string, mode: DeleteMode, budget: number): Promise<DeleteResult> {
    const started = now();
    const total = { files: 0, bytes: 0 };
    let apps = 0;
    const outOfTime = () => now() - started > budget;
    const partial = (): DeleteResult => {
      log(JSON.stringify({ event: "account_delete", mode, done: false, apps, files: total.files, bytes: total.bytes, ms: now() - started }));
      return { deleted: false, done: false, apps, files: total.files, bytes: total.bytes };
    };
    const step = async <T>(what: string, work: () => Promise<T>): Promise<T> => {
      try {
        return await work();
      } catch (error) {
        const reason = (error instanceof Error ? error.message : String(error)).slice(0, 300);
        log(JSON.stringify({ event: "account_delete", mode, failed: what, apps, files: total.files }));
        throw new DeleteError(500, "stopped", `Your account wasn't fully deleted yet (${what}): ${reason} Try again: it carries on where it stopped.`);
      }
    };
    const clear = async (bucket: string, prefix: string) => {
      const cleared = await step("files", () => storage.clearFolder(bucket, prefix, outOfTime));
      total.files += cleared.files;
      total.bytes += cleared.bytes;
      return cleared.done;
    };

    // 2. Each app: recorded as deleted (for good), then its row, so every job and worker for it stops.
    for (const appId of await step("apps", () => column("products", "id", ["user_id", id]))) {
      await step("app", async () => {
        const kept = await db.from("deleted_apps").upsert({ app_id: appId, owner_user_id: id }, { onConflict: "app_id", ignoreDuplicates: true });
        if (kept.error) throw new Error(kept.error.message);
        const { error } = await db.from("products").delete().eq("id", appId).eq("user_id", id);
        if (error) throw new Error(error.message);
      });
      apps++;
    }

    // 3. Every app the account ever had: also the ones it deleted earlier, still counted against it.
    const owned = await step("apps", async () => [...new Set([...await column("app_owners", "app_id", ["user_id", id]), ...await column("deleted_apps", "app_id", ["owner_user_id", id])])]);
    for (const appId of owned) {
      const { data: live } = await db.from("products").select("user_id").eq("id", appId).maybeSingle();
      if (live && live.user_id !== id) continue; // never another account's app
      await step("app", async () => {
        const { error } = await db.from("deleted_apps").upsert({ app_id: appId, owner_user_id: id }, { onConflict: "app_id", ignoreDuplicates: true });
        if (error) throw new Error(error.message);
      });
      for (const bucket of ["creatives", "ad-media"]) if (!(await clear(bucket, `${appId}/`))) return partial();
      // Out of time: answer now, but only after this call removed something (an emptied folder is passed at once next time).
      if (outOfTime() && total.files > 0) return partial();
    }

    // 4. The account's own folders.
    for (const bucket of ["workspace", "thumbs"]) if (!(await clear(bucket, `${id}/`))) return partial();

    // 5. The sign-in, and with it every row and Vault key of the user.
    await step("sign-in", async () => {
      const { error } = await db.auth.admin.deleteUser(id);
      if (error && !/not.?found/i.test(error.message)) throw new Error(error.message);
    });
    // 6. Done; the late sweeps come later.
    await db.from("account_deletions").update({ finished_at: iso(now()), lease_until: null, touched_at: iso(now()) }).eq("user_id", id);
    auth.clear(id);
    tenancy.clear(id);
    log(JSON.stringify({ event: "account_delete", mode, done: true, apps, files: total.files, bytes: total.bytes, ms: now() - started }));
    return { deleted: true, done: true, apps, files: total.files, bytes: total.bytes };
  }

  /** One call at a time per account; the lease is given back when the call ends (or runs out on its own). */
  async function leased<T>(id: string, seconds: number, work: () => Promise<T>): Promise<T | null> {
    const { data, error } = await db.rpc("account_deletion_lease", { p_user: id, p_seconds: seconds });
    if (error) throw new HttpError(503, "Account deletion isn't available yet: apply the latest database update, then try again.");
    if (data !== true) return null;
    try {
      return await work();
    } finally {
      await db.from("account_deletions").update({ lease_until: null, touched_at: iso(now()) }).eq("user_id", id).is("finished_at", null);
    }
  }

  /** POST account/delete: start (with the confirmation) or carry on the caller's own deletion. */
  async function run(req: Request, input: Record<string, unknown>): Promise<DeleteResult> {
    const caller = await who(req);
    if (!caller.resuming) {
      if (caller.mode === "accounts" && !caller.staff) {
        const [windowSec, max] = DELETE_RATE;
        const { data, error } = await db.rpc("account_rate_hit", { p_user: caller.id, p_bucket: DELETE_BUCKET, p_window_sec: windowSec, p_max: max });
        // Starting a deletion fails closed: no answer from the limiter, no start.
        if (error) throw new HttpError(503, "Couldn't check who may use this install. Try again in a moment.");
        if (data === false) throw new HttpError(429, "That's a lot of requests in a short time. Wait a few minutes, then try again.");
      }
      if (input.confirm !== DELETE_CONFIRM) throw new DeleteError(400, "confirm", "Type the confirmation word to delete your account.");
      try {
        await start(caller);
      } catch (error) {
        throw new DeleteError(500, "stopped", `Your account wasn't fully deleted yet (start): ${(error instanceof Error ? error.message : String(error)).slice(0, 300)} Try again: it carries on where it stopped.`);
      }
    }
    const result = await leased(caller.id, Math.ceil(budgetMs / 1000) + 60, () => proceed(caller.id, caller.mode, budgetMs));
    if (!result) throw new DeleteError(409, "busy", "Your account is being deleted right now. Wait a moment: this page carries on by itself.");
    return result;
  }

  /** The late sweep of one deleted account's folders (files written after the deletion by a URL made before it). */
  async function lateSweep(id: string, stop: () => boolean): Promise<{ files: number; done: boolean }> {
    let files = 0;
    const apps = await column("deleted_apps", "app_id", ["owner_user_id", id]);
    const folders: [string, string][] = [...apps.flatMap((app): [string, string][] => [["creatives", `${app}/`], ["ad-media", `${app}/`]]), ["workspace", `${id}/`], ["thumbs", `${id}/`]];
    for (const [bucket, prefix] of folders) {
      const cleared = await storage.clearFolder(bucket, prefix, stop);
      files += cleared.files;
      if (!cleared.done) return { files, done: false };
    }
    return { files, done: true };
  }

  /** POST account/delete/sweep (the cron job, with the worker secret): carries on stalled deletions and does the late sweeps. */
  async function sweep(budget = SWEEP_BUDGET_MS) {
    const started = now();
    const stop = () => now() - started > budget;
    const summary = { resumed: 0, finished: 0, swept: 0, files: 0 };
    const { data: open } = await db.from("account_deletions").select("*").is("finished_at", null).lt("touched_at", iso(now() - 5 * MINUTE)).limit(20);
    for (const row of (open ?? []) as Deletion[]) {
      if (stop()) break;
      if (row.lease_until && Date.parse(row.lease_until) > now()) continue;
      const left = Math.max(1_000, budget - (now() - started));
      const result = await leased(row.user_id, Math.ceil(left / 1000) + 60, () => proceed(row.user_id, row.mode, left)).catch(() => null);
      summary.resumed++;
      if (result?.done) summary.finished++;
      if (result) summary.files += result.files;
    }
    const { data: done } = await db.from("account_deletions").select("*").not("finished_at", "is", null).lt("finished_at", iso(now() - 3 * HOUR)).limit(50);
    for (const row of (done ?? []) as Deletion[]) {
      if (stop()) break;
      const age = now() - Date.parse(row.finished_at!);
      if (row.sweeps >= 1 && age < 24 * HOUR) continue;
      const swept = await lateSweep(row.user_id, stop);
      summary.files += swept.files;
      if (!swept.done) break;
      summary.swept++;
      if (row.sweeps >= 1) {
        // The last sweep: forget the user id (the apps' ids stay retired).
        await db.from("deleted_apps").update({ owner_user_id: null }).eq("owner_user_id", row.user_id);
        await db.from("account_deletions").delete().eq("user_id", row.user_id);
      } else {
        await db.from("account_deletions").update({ sweeps: 1 }).eq("user_id", row.user_id);
      }
    }
    log(JSON.stringify({ event: "account_delete_sweep", ...summary, ms: now() - started }));
    return summary;
  }

  return { run, sweep };
}
