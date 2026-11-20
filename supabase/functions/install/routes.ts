// The install function's routes, built over a database client, the tenancy (whose keys and settings:
// _shared/tenant.ts) and a transport, so they run in tests against fakes (routes_test.ts). index.ts wires
// the real ones.
//
// Accounts mode (a platform row): every signed-in account manages its own keys (account_put_secret and
// its kin, Vault `acct:<user>:<NAME>`) and its own settings (accounts.settings, without limits, which are
// the platform's). There are no members: those routes answer 404, and so does rotating the desktop
// runner's secret for anyone but staff. Settings > Storage shows and clears only the caller's files.
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError, type Member } from "../_shared/auth.ts";
import { modelOverrides } from "../_shared/ai/models.ts";
import { keyLabel, sameSecret } from "../_shared/keys.ts";
import { platformSafetyGb, resolveLimits, resolvePlatformLimits } from "../_shared/limits.ts";
import type { Tenancy, Tenant } from "../_shared/tenant.ts";
import { createStorage, type StorageScope } from "./storage.ts";
import { type AccountDeletionDeps, createAccountDeletion, DeleteError } from "./account.ts";
import { checkKey, isPerAppKey, type CheckResult, type Fetch, isKeyName, KEY_NAMES } from "./checks.ts";
import {
  installState, type InstallMember, isEmail, isUuid, type KeyMeta, keyState, type KeyState, mergeSettings, newRunnerSecret, type PlanState, settingsPatch,
} from "./settings.ts";

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 300);
/** The longest value a key may have (a Google service account file is about 2,400 characters). */
const VALUE_MAX = 20_000;
/** How many accounts are looked through to find one by email (200 a page). */
const USER_PAGES = 50;
/** Plan names for the "Plan & usage" panel when the plans table can't be read. */
const PLAN_NAMES: Record<string, string> = { free: "Free", pro: "Pro", staff: "Staff" };
/** The desktop runner belongs to the platform: an account never stores its secret. */
const RUNNER_SECRET = "CREATIVES_RUNNER_SECRET";

// MARK: HTTP

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const notFound = () => new HttpError(404, "Not found");

async function body(req: Request): Promise<Record<string, unknown>> {
  try {
    const parsed = await req.json();
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export interface InstallDeps {
  db: SupabaseClient; tenancy: Tenancy; fetch: Fetch;
  /** Reads a plain environment variable (the research switches); none when left out. */
  env?: (name: string) => string | undefined;
  /** Account deletion's clock, time budget and log line (tests); the real ones when left out. */
  deletion?: Pick<AccountDeletionDeps, "now" | "budgetMs" | "log">;
}

/** A request's caller and their tenant. */
type Caller = Member & { tenant: Tenant };
const accounts = (caller: Caller) => caller.tenant.mode === "accounts";

/** The function's request handler. */
export function createInstall({ db, tenancy, fetch, env = () => undefined, deletion: deletionDeps }: InstallDeps): (req: Request) => Promise<Response> {
  const auth = tenancy.auth;
  // Settings > Storage (storage.ts): what is stored against the plan's quota, and the cleanups.
  const storage = createStorage({
    db,
    limits: async () => (await auth.mode()) === "accounts" ? resolvePlatformLimits(await auth.platform(), env) : resolveLimits(await auth.install(), env),
  });

  // Settings > Account > Delete my account (account.ts): the caller's own account only.
  const deletion = createAccountDeletion({ db, auth, tenancy, storage, ...deletionDeps });

  /** Accounts mode: the caller's own storage (their files, their plan's storage); null elsewhere. */
  const scopeOf = (caller: Caller): StorageScope | null =>
    accounts(caller) ? { userId: caller.id, quotaBytes: (caller.tenant.plan?.limits.storageGb ?? 0) * 1e9 } : null;

  async function handle(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    const parts = new URL(req.url).pathname.replace(/\/+$/, "").split("/");
    const route = parts.slice(parts.lastIndexOf("install") + 1).join("/");
    try {
      switch (route) {
        case "health": return json((await auth.mode()) === "accounts" ? { ok: true, mode: "accounts" } : { ok: true });
        case "capabilities": return json(await capabilities(await tenancy.member(req)));
        case "keys/put": { const c = await tenancy.manager(req); await tenancy.rate(c.tenant, "install.keys"); return json(await putKey(c, await body(req))); }
        case "keys/verify": { const c = await tenancy.manager(req); await tenancy.rate(c.tenant, "install.keys"); return json(await verifyKey(c, await body(req))); }
        case "keys/delete": return json(await deleteKey(await tenancy.manager(req), await body(req)));
        case "settings": return json(await saveSettings(await tenancy.manager(req), await body(req)));
        case "members": { await installOnly(); await auth.owner(req); return json({ members: await members() }); }
        case "members/add": { await installOnly(); await auth.owner(req); return json(await addMember(await body(req))); }
        case "members/remove": { await installOnly(); await auth.owner(req); return json(await removeMember(await body(req))); }
        case "runner-secret/rotate": return json(await rotateRunnerSecret(await tenancy.manager(req)));
        case "storage": { const c = await tenancy.member(req); return json(await storage.usage(scopeOf(c))); }
        case "storage/cleanup": { const c = await tenancy.member(req); return json(await storage.cleanup(await body(req), scopeOf(c))); }
        case "account/delete": {
          if (req.method !== "POST") return json({ error: "Not found" }, 404);
          return json(await deletion.run(req, await body(req)));
        }
        case "account/delete/sweep": {
          // The cron job (account_deletions_sweep in SQL), with the worker secret the radar watchdog uses.
          if (req.method !== "POST") return json({ error: "Not found" }, 404);
          const secret = await tenancy.platform().get("RADAR_WORKER_SECRET");
          if (!secret || !sameSecret(req.headers.get("x-radar-worker") ?? "", secret)) throw new HttpError(403, "Forbidden");
          return json(await deletion.sweep());
        }
        default: return json({ error: "Not found" }, 404);
      }
    } catch (error) {
      if (error instanceof DeleteError) return json({ error: error.message, code: error.code }, error.status);
      if (error instanceof HttpError) return json({ error: error.message }, error.status);
      console.error(errorText(error));
      return json({ error: `Something went wrong: ${errorText(error)}` }, 500);
    }
  }

  /**
   * Accounts mode has no members (each account is its own). members/add in particular must never run
   * there: it replaces the password of an account that never signed in.
   */
  async function installOnly() {
    if ((await auth.mode()) === "accounts") throw notFound();
  }

  // MARK: Capabilities

  async function metaRows(caller: Caller): Promise<Map<string, KeyMeta>> {
    if (accounts(caller)) {
      const { data } = await db.from("account_secrets_meta").select("name, last4, verified_at, status, message").eq("user_id", caller.id);
      return new Map(((data ?? []) as KeyMeta[]).map((row) => [row.name, row]));
    }
    // No table (a database from before the install migration) reads the same as no rows.
    const { data } = await db.from("install_secrets_meta").select("name, last4, verified_at, status, message");
    return new Map(((data ?? []) as KeyMeta[]).map((row) => [row.name, row]));
  }

  async function stateOf(caller: Caller, name: string, meta?: Map<string, KeyMeta>): Promise<KeyState> {
    const rows = meta ?? await metaRows(caller);
    return keyState(await caller.tenant.keys.source(name), rows.get(name));
  }

  async function capabilities(caller: Caller) {
    const meta = await metaRows(caller);
    const { tenant } = caller;
    // Every key in the catalogue, and any per-app AppStack or RevenueCat key that is set (in accounts mode, the caller's).
    const names = new Set<string>(KEY_NAMES.filter((name) => !(accounts(caller) && name === RUNNER_SECRET && !tenant.staff)));
    for (const prefix of ["APPSTACK_API_KEY_", "REVENUECAT_API_KEY_"]) for (const name of await tenant.keys.withPrefix(prefix)) if (isPerAppKey(name)) names.add(name);
    const keys: Record<string, KeyState> = {};
    for (const name of names) keys[name] = await stateOf(caller, name, meta);
    if (accounts(caller)) {
      return {
        ...installState({
          role: "account", owned: true, settings: tenant.settings, keys, modelEnv: await modelOverrides(tenant.keys), mode: "accounts",
          plan: await planState(caller), limits: tenant.limits,
          // The project's research switches and the schema version are the platform's business: staff only.
          researchEnv: tenant.staff ? { RESEARCH_TIKTOK: env("RESEARCH_TIKTOK"), RESEARCH_META_APIFY_ACTOR: env("RESEARCH_META_APIFY_ACTOR") } : {},
        }),
        schemaVersion: tenant.staff ? await schemaVersion() : null,
      };
    }
    const row = await auth.install();
    return {
      ...installState({
        role: caller.role === "account" ? "member" : caller.role, owned: Boolean(row?.ownerUserId), settings: row?.settings, keys, modelEnv: await modelOverrides(tenant.keys),
        researchEnv: { RESEARCH_TIKTOK: env("RESEARCH_TIKTOK"), RESEARCH_META_APIFY_ACTOR: env("RESEARCH_META_APIFY_ACTOR") },
      }),
      // The newest migration applied by setup (the ledger): the studio compares it with the newest one
      // its own copy carries, to tell when "Apply the update" was skipped (GET /api/install updateNeeded).
      schemaVersion: await schemaVersion(),
    };
  }

  /** Accounts mode: the plan, its limits and what is used of them (apps, storage, generations this month). */
  async function planState(caller: Caller): Promise<PlanState> {
    const plan = caller.tenant.plan;
    // The month's counter (account_usage: what the generation cap reads, kept even when apps are deleted).
    const month = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString().slice(0, 10);
    const [apps, storageUsed, generations, named] = await Promise.all([
      db.from("products").select("id", { count: "exact", head: true }).eq("user_id", caller.id),
      db.rpc("account_storage_used", { p_user: caller.id }),
      db.from("account_usage").select("generations").eq("user_id", caller.id).eq("month", month).maybeSingle(),
      db.from("plans").select("name").eq("id", plan?.id ?? "free").maybeSingle(),
    ]);
    const id = plan?.id ?? "free";
    const state: PlanState = {
      id, name: (named.data?.name as string | undefined) ?? PLAN_NAMES[id] ?? id, staff: caller.tenant.staff,
      limits: plan?.limits ?? { maxApps: 0, storageGb: 0, monthlyGenerations: 0, jobConcurrency: 0, maxOpenJobs: 0 },
      usage: { apps: apps.count ?? 0, storageBytes: Number(storageUsed.data) || 0, generationsThisMonth: Number(generations.data?.generations) || 0 },
    };
    if (caller.tenant.staff) {
      // Staff see the whole project against its safety net (each account's plan is the real limit).
      const project = await db.rpc("research_storage_used");
      state.platform = { usedBytes: Number(project.data) || 0, safetyBytes: platformSafetyGb(await auth.platform()) * 1e9 };
    }
    return state;
  }

  /** The newest version in public.install_migrations; null when it has none or can't be read. */
  async function schemaVersion(): Promise<string | null> {
    const { data, error } = await db.from("install_migrations").select("version").order("version", { ascending: false }).limit(1);
    if (error) return null;
    const version = (data as { version?: unknown }[] | null)?.[0]?.version;
    return typeof version === "string" && /^\d{14}$/.test(version) ? version : null;
  }

  // MARK: Keys

  function keyName(caller: Caller, input: Record<string, unknown>): string {
    if (!isKeyName(input.name)) throw new HttpError(400, "This isn't a key the app uses.");
    if (accounts(caller) && input.name === RUNNER_SECRET) throw new HttpError(400, "The desktop runner isn't available on this account.");
    return input.name;
  }

  /** "Your OpenAI key", to start a sentence with. */
  const Label = (name: string) => keyLabel(name).replace(/^./, (c) => c.toUpperCase());
  const envWins = (name: string) =>
    `${Label(name)} is set as an edge function secret on the Supabase project, which always wins. Change or remove it there (Edge Functions > Secrets) to manage it here.`;

  /** Stores a key: the account's own in accounts mode, the install's otherwise. */
  async function store(caller: Caller, name: string, value: string) {
    return accounts(caller)
      ? await db.rpc("account_put_secret", { p_user: caller.id, p_name: name, p_value: value })
      : await db.rpc("install_put_secret", { p_name: name, p_value: value });
  }

  /** Records a check's result next to the key (and next to the other half of a pair it proved good). */
  async function mark(caller: Caller, name: string, result: CheckResult) {
    const own = accounts(caller);
    if (result.status === "unverified") {
      // Stored but not decided: keep the reason for the Settings page.
      const patch = { status: "unverified", verified_at: null, message: result.message.slice(0, 300) };
      const { error } = own
        ? await db.from("account_secrets_meta").update(patch).eq("user_id", caller.id).eq("name", name)
        : await db.from("install_secrets_meta").update(patch).eq("name", name);
      if (error) throw new Error(error.message);
      return;
    }
    const markOne = (key: string, ok: boolean) => own
      ? db.rpc("account_mark_secret", { p_user: caller.id, p_name: key, p_ok: ok, p_message: result.message })
      : db.rpc("install_mark_secret", { p_name: key, p_ok: ok, p_message: result.message });
    const { error } = await markOne(name, result.status === "ok");
    if (error) throw new Error(error.message);
    for (const other of result.status === "ok" ? result.also ?? [] : []) await markOne(other, true);
  }

  const check = (caller: Caller, name: string, value: string) => checkKey(name, value, { fetch, other: (other) => caller.tenant.keys.get(other) });

  /** Forget the caller's cached keys after a change (the shared reader in install mode, the account's in accounts mode). */
  const forget = (caller: Caller) => {
    if (accounts(caller)) tenancy.clear(caller.id);
    else caller.tenant.keys.clear();
  };

  async function putKey(caller: Caller, input: Record<string, unknown>) {
    const name = keyName(caller, input);
    const value = typeof input.value === "string" ? input.value.trim() : "";
    if (!value) throw new HttpError(400, "Paste the key first.");
    if (value.length > VALUE_MAX) throw new HttpError(400, "That's too long to be a key. Copy it again and paste only the key.");
    if (await caller.tenant.keys.source(name) === "env") throw new HttpError(409, envWins(name));

    const result = await check(caller, name, value);
    if (result.status === "failed") throw new HttpError(400, result.message);

    const { error } = await store(caller, name, value);
    if (error) throw new Error(`The key couldn't be saved: ${error.message}`);
    await mark(caller, name, result);
    forget(caller);
    return { name, key: await stateOf({ ...caller, tenant: await tenancy.for(caller.id) }, name) };
  }

  async function verifyKey(caller: Caller, input: Record<string, unknown>) {
    const name = keyName(caller, input);
    const value = await caller.tenant.keys.get(name);
    if (!value) throw new HttpError(404, `${Label(name)} isn't set yet.`);
    const result = await check(caller, name, value);
    const meta = await metaRows(caller);
    const source = await caller.tenant.keys.source(name);
    if (result.status === "unverified" && meta.get(name)?.status === "ok" && (source === "vault" || !meta.get(name)?.last4)) {
      // The provider couldn't be asked this time: a key it accepted before stays accepted.
    } else if (source === "vault") {
      await mark(caller, name, result);
    } else if (source === "platform") {
      // The platform's key, lent to a staff account: checked, never written down against the account.
    } else if (!meta.get(name)?.last4) {
      // From the environment: there is no stored copy to mark, so keep the result in a row of its own
      // (no last 4 characters). A row that describes a copy stored here is left alone.
      const row = { name, last4: null, status: result.status, verified_at: result.status === "unverified" ? null : new Date().toISOString(), message: result.message.slice(0, 300) };
      const { error } = await db.from("install_secrets_meta").upsert(row, { onConflict: "name" });
      if (error) throw new Error(error.message);
    }
    const state = await stateOf(caller, name);
    // Always answer what this check found, also when it couldn't be written down.
    return { name, key: { ...state, status: result.status, message: result.message } };
  }

  async function deleteKey(caller: Caller, input: Record<string, unknown>) {
    const name = keyName(caller, input);
    if (accounts(caller)) {
      const { error } = await db.rpc("account_delete_secret", { p_user: caller.id, p_name: name });
      if (error) throw new Error(`The key couldn't be removed: ${error.message}`);
      forget(caller);
      return { ok: true };
    }
    // Supplied by the environment with no copy stored here: there is nothing to remove, so say where it lives.
    if (await caller.tenant.keys.source(name) === "env" && !(await metaRows(caller)).get(name)?.last4) throw new HttpError(409, envWins(name));
    const { error } = await db.rpc("install_delete_secret", { p_name: name });
    if (error) throw new Error(`The key couldn't be removed: ${error.message}`);
    forget(caller);
    return { ok: true };
  }

  async function rotateRunnerSecret(caller: Caller) {
    // The runner is the platform's: in accounts mode only staff may rotate its (install-wide) secret.
    if (accounts(caller) && !caller.tenant.staff) throw notFound();
    const platform = tenancy.platform();
    const secret = newRunnerSecret();
    const fromEnv = accounts(caller) ? Boolean(env(RUNNER_SECRET)?.trim()) : await caller.tenant.keys.source(RUNNER_SECRET) === "env";
    if (fromEnv) throw new HttpError(409, envWins(RUNNER_SECRET));
    const { error } = await db.rpc("install_put_secret", { p_name: RUNNER_SECRET, p_value: secret });
    if (error) throw new Error(`The secret couldn't be saved: ${error.message}`);
    const note = "Generated here. Give it to the desktop runner; the old secret no longer works.";
    await db.rpc("install_mark_secret", { p_name: RUNNER_SECRET, p_ok: true, p_message: note });
    platform.clear();
    caller.tenant.keys.clear();
    const meta = new Map<string, KeyMeta>((((await db.from("install_secrets_meta").select("name, last4, verified_at, status, message").eq("name", RUNNER_SECRET)).data ?? []) as KeyMeta[]).map((row) => [row.name, row]));
    const source = accounts(caller) ? "vault" as const : await caller.tenant.keys.source(RUNNER_SECRET);
    return { secret, key: keyState(source, meta.get(RUNNER_SECRET)) };
  }

  // MARK: Settings

  async function saveSettings(caller: Caller, input: Record<string, unknown>) {
    if (accounts(caller)) {
      // The time and upload limits and the project's storage are the platform's: never an account's to set.
      const { limits: _limits, ...rest } = input;
      const patch = settingsPatch(rest);
      if (typeof patch === "string") throw new HttpError(400, patch);
      const { data, error } = await db.from("accounts").select("settings").eq("user_id", caller.id).maybeSingle();
      if (error || !data) throw new Error(error?.message ?? "This account has no settings row.");
      const merged = mergeSettings(data.settings, patch);
      delete merged.limits;
      const { error: failed } = await db.from("accounts").update({ settings: merged }).eq("user_id", caller.id);
      if (failed) throw new Error(`The settings couldn't be saved: ${failed.message}`);
      tenancy.clear(caller.id);
      return capabilities({ ...caller, tenant: await tenancy.for(caller.id) });
    }
    const patch = settingsPatch(input);
    if (typeof patch === "string") throw new HttpError(400, patch);
    const { data, error } = await db.from("install").select("settings").maybeSingle();
    if (error || !data) throw new Error(error?.message ?? "This install has no settings row.");
    const { error: failed } = await db.from("install").update({ settings: mergeSettings(data.settings, patch) }).eq("id", true);
    if (failed) throw new Error(`The settings couldn't be saved: ${failed.message}`);
    auth.clear();
    tenancy.clear();
    return capabilities({ ...caller, tenant: await tenancy.for(caller.id) });
  }

  // MARK: Members

  async function emailOf(userId: string): Promise<string | null> {
    const { data, error } = await db.auth.admin.getUserById(userId);
    return error ? null : data.user?.email ?? null;
  }

  async function members(): Promise<InstallMember[]> {
    const [{ data: install }, { data: rows, error }] = await Promise.all([
      db.from("install").select("owner_user_id, created_at").maybeSingle(),
      db.from("install_members").select("user_id, role, created_at").order("created_at", { ascending: true }),
    ]);
    if (error) throw new Error(error.message);
    const ownerId = (install?.owner_user_id as string | null) ?? null;
    const list = ((rows ?? []) as { user_id: string; role: string; created_at: string }[])
      .map((row) => ({ userId: row.user_id, role: row.user_id === ownerId || row.role === "owner" ? "owner" as const : "member" as const, createdAt: row.created_at }));
    // The owner is always listed, first, also when setup didn't give them a members row.
    if (ownerId && !list.some((m) => m.userId === ownerId)) list.unshift({ userId: ownerId, role: "owner", createdAt: String(install?.created_at ?? new Date().toISOString()) });
    list.sort((a, b) => Number(b.role === "owner") - Number(a.role === "owner"));
    return Promise.all(list.map(async (m) => ({ userId: m.userId, email: await emailOf(m.userId), role: m.role, createdAt: m.createdAt })));
  }

  interface AuthUser { id: string; email?: string | null; last_sign_in_at?: string | null }

  /** The account with this email, if there is one (the admin API has no lookup by email, so pages are read). */
  async function userByEmail(email: string): Promise<AuthUser | null> {
    for (let page = 1; page <= USER_PAGES; page++) {
      const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw new Error(error.message);
      const hit = data.users.find((u) => (u.email ?? "").toLowerCase() === email);
      if (hit) return hit;
      if (data.users.length < 200) return null;
    }
    return null;
  }

  async function addMember(input: Record<string, unknown>) {
    if (!isEmail(input.email)) throw new HttpError(400, "Enter the person's email address.");
    const email = input.email.trim().toLowerCase();
    const redirectTo = typeof input.redirectTo === "string" && /^https?:\/\//.test(input.redirectTo) ? input.redirectTo : undefined;
    const options = redirectTo ? { redirectTo } : undefined;
    const row = await auth.install();

    let user = await userByEmail(email);
    let inviteLink: string | undefined;
    if (!user) {
      // No account yet: create the invite here and hand the link to the owner, so nothing depends on email delivery.
      const { data, error } = await db.auth.admin.generateLink({ type: "invite", email, options });
      if (error || !data.user) throw new HttpError(400, `The invite couldn't be created: ${error?.message ?? "no account was made"}.`);
      user = data.user;
      inviteLink = data.properties?.action_link;
    } else if (!user.last_sign_in_at && user.id !== row?.ownerUserId) {
      // An account that has never signed in: invited before, or registered by anyone at all while
      // sign-up was open. Whoever made it may know its password, and the link below confirms the
      // address, so that password would open a member's account. Replace it first: the link is then
      // the only way in, and the invited person chooses a password of their own. (43 random characters:
      // Supabase Auth refuses passwords over 72.)
      const { error } = await db.auth.admin.updateUserById(user.id, { password: newRunnerSecret() });
      if (error) throw new HttpError(502, "This address already has an account that couldn't be made safe to invite. Try again in a moment.");
      // A fresh link to pass on (best effort).
      const { data } = await db.auth.admin.generateLink({ type: "recovery", email, options });
      inviteLink = data?.properties?.action_link;
    }

    const isOwner = user.id === row?.ownerUserId;
    if (!isOwner) {
      const { error } = await db.from("install_members").upsert({ user_id: user.id, role: "member" }, { onConflict: "user_id", ignoreDuplicates: true });
      if (error) throw new Error(`The member couldn't be added: ${error.message}`);
      auth.clear();
    }
    const { data: saved } = await db.from("install_members").select("role, created_at").eq("user_id", user.id).maybeSingle();
    const member: InstallMember = {
      userId: user.id, email: user.email ?? email,
      role: isOwner || saved?.role === "owner" ? "owner" : "member",
      createdAt: String(saved?.created_at ?? new Date().toISOString()),
    };
    return { member, ...(inviteLink ? { inviteLink } : {}) };
  }

  async function removeMember(input: Record<string, unknown>) {
    if (!isUuid(input.userId)) throw new HttpError(400, "Choose the member to remove.");
    const row = await auth.install();
    const { data: existing } = await db.from("install_members").select("role").eq("user_id", input.userId).maybeSingle();
    if (input.userId === row?.ownerUserId || existing?.role === "owner") throw new HttpError(400, "The owner can't be removed.");
    const { error } = await db.from("install_members").delete().eq("user_id", input.userId);
    if (error) throw new Error(`The member couldn't be removed: ${error.message}`);
    auth.clear();
    return { ok: true };
  }

  return handle;
}
