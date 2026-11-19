// The install function's routes, built over a database client, the key reader, the caller check and a
// transport, so they run in tests against fakes (routes_test.ts). index.ts wires the real ones.
import type { SupabaseClient } from "@supabase/supabase-js";
import { type Auth, HttpError, type Member } from "../_shared/auth.ts";
import { modelOverrides } from "../_shared/ai/models.ts";
import { keyLabel, type Keys } from "../_shared/keys.ts";
import { resolveLimits } from "../_shared/limits.ts";
import { createStorage } from "./storage.ts";
import { APPSTACK_PER_APP, checkKey, type CheckResult, type Fetch, isKeyName, KEY_NAMES } from "./checks.ts";
import {
  installState, type InstallMember, isEmail, isUuid, type KeyMeta, keyState, type KeyState, mergeSettings, newRunnerSecret, settingsPatch,
} from "./settings.ts";

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 300);
/** The longest value a key may have (a Google service account file is about 2,400 characters). */
const VALUE_MAX = 20_000;
/** How many accounts are looked through to find one by email (200 a page). */
const USER_PAGES = 50;

// MARK: HTTP

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

async function body(req: Request): Promise<Record<string, unknown>> {
  try {
    const parsed = await req.json();
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export interface InstallDeps {
  db: SupabaseClient; secrets: Keys; auth: Auth; fetch: Fetch;
  /** Reads a plain environment variable (the research switches); none when left out. */
  env?: (name: string) => string | undefined;
}

/** The function's request handler. */
export function createInstall({ db, secrets, auth, fetch, env = () => undefined }: InstallDeps): (req: Request) => Promise<Response> {
  // Settings > Storage (storage.ts): what is stored against the plan's quota, and the cleanups.
  const storage = createStorage({ db, limits: async () => resolveLimits(await auth.install(), env) });

  async function handle(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    const parts = new URL(req.url).pathname.replace(/\/+$/, "").split("/");
    const route = parts.slice(parts.lastIndexOf("install") + 1).join("/");
    try {
      switch (route) {
        case "health": return json({ ok: true });
        case "capabilities": return json(await capabilities(await auth.member(req)));
        case "keys/put": { await auth.owner(req); return json(await putKey(await body(req))); }
        case "keys/verify": { await auth.owner(req); return json(await verifyKey(await body(req))); }
        case "keys/delete": { await auth.owner(req); return json(await deleteKey(await body(req))); }
        case "settings": { const owner = await auth.owner(req); return json(await saveSettings(owner, await body(req))); }
        case "members": { await auth.owner(req); return json({ members: await members() }); }
        case "members/add": { await auth.owner(req); return json(await addMember(await body(req))); }
        case "members/remove": { await auth.owner(req); return json(await removeMember(await body(req))); }
        case "runner-secret/rotate": { await auth.owner(req); return json(await rotateRunnerSecret()); }
        case "storage": { await auth.member(req); return json(await storage.usage()); }
        case "storage/cleanup": { await auth.member(req); return json(await storage.cleanup(await body(req))); }
        default: return json({ error: "Not found" }, 404);
      }
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status);
      console.error(errorText(error));
      return json({ error: `Something went wrong: ${errorText(error)}` }, 500);
    }
  }

  // MARK: Capabilities

  async function metaRows(): Promise<Map<string, KeyMeta>> {
    // No table (a database from before the install migration) reads the same as no rows.
    const { data } = await db.from("install_secrets_meta").select("name, last4, verified_at, status, message");
    return new Map(((data ?? []) as KeyMeta[]).map((row) => [row.name, row]));
  }

  async function stateOf(name: string, meta?: Map<string, KeyMeta>): Promise<KeyState> {
    const rows = meta ?? await metaRows();
    return keyState(await secrets.source(name), rows.get(name));
  }

  async function capabilities(caller: Member) {
    const meta = await metaRows();
    // Every key in the catalogue, and any per-app AppStack key that is set.
    const names = new Set<string>(KEY_NAMES);
    for (const name of await secrets.withPrefix("APPSTACK_API_KEY_")) if (APPSTACK_PER_APP.test(name)) names.add(name);
    const keys: Record<string, KeyState> = {};
    for (const name of names) keys[name] = await stateOf(name, meta);
    const row = await auth.install();
    return {
      ...installState({
        role: caller.role, owned: Boolean(row?.ownerUserId), settings: row?.settings, keys, modelEnv: await modelOverrides(secrets),
        researchEnv: { RESEARCH_TIKTOK: env("RESEARCH_TIKTOK"), RESEARCH_META_APIFY_ACTOR: env("RESEARCH_META_APIFY_ACTOR") },
      }),
      // The newest migration applied by setup (the ledger): the studio compares it with the newest one
      // its own copy carries, to tell when "Apply the update" was skipped (GET /api/install updateNeeded).
      schemaVersion: await schemaVersion(),
    };
  }

  /** The newest version in public.install_migrations; null when it has none or can't be read. */
  async function schemaVersion(): Promise<string | null> {
    const { data, error } = await db.from("install_migrations").select("version").order("version", { ascending: false }).limit(1);
    if (error) return null;
    const version = (data as { version?: unknown }[] | null)?.[0]?.version;
    return typeof version === "string" && /^\d{14}$/.test(version) ? version : null;
  }

  // MARK: Keys

  function keyName(input: Record<string, unknown>): string {
    if (!isKeyName(input.name)) throw new HttpError(400, "This isn't a key the app uses.");
    return input.name;
  }

  /** "Your OpenAI key", to start a sentence with. */
  const Label = (name: string) => keyLabel(name).replace(/^./, (c) => c.toUpperCase());
  const envWins = (name: string) =>
    `${Label(name)} is set as an edge function secret on the Supabase project, which always wins. Change or remove it there (Edge Functions > Secrets) to manage it here.`;

  /** Records a check's result next to the key (and next to the other half of a pair it proved good). */
  async function mark(name: string, result: CheckResult) {
    if (result.status === "unverified") {
      // Stored but not decided: keep the reason for the Settings page.
      const { error } = await db.from("install_secrets_meta").update({ status: "unverified", verified_at: null, message: result.message.slice(0, 300) }).eq("name", name);
      if (error) throw new Error(error.message);
      return;
    }
    const { error } = await db.rpc("install_mark_secret", { p_name: name, p_ok: result.status === "ok", p_message: result.message });
    if (error) throw new Error(error.message);
    for (const other of result.status === "ok" ? result.also ?? [] : []) {
      await db.rpc("install_mark_secret", { p_name: other, p_ok: true, p_message: result.message });
    }
  }

  const check = (name: string, value: string) => checkKey(name, value, { fetch, other: (other) => secrets.get(other) });

  async function putKey(input: Record<string, unknown>) {
    const name = keyName(input);
    const value = typeof input.value === "string" ? input.value.trim() : "";
    if (!value) throw new HttpError(400, "Paste the key first.");
    if (value.length > VALUE_MAX) throw new HttpError(400, "That's too long to be a key. Copy it again and paste only the key.");
    if (await secrets.source(name) === "env") throw new HttpError(409, envWins(name));

    const result = await check(name, value);
    if (result.status === "failed") throw new HttpError(400, result.message);

    const { error } = await db.rpc("install_put_secret", { p_name: name, p_value: value });
    if (error) throw new Error(`The key couldn't be saved: ${error.message}`);
    await mark(name, result);
    secrets.clear();
    return { name, key: await stateOf(name) };
  }

  async function verifyKey(input: Record<string, unknown>) {
    const name = keyName(input);
    const value = await secrets.get(name);
    if (!value) throw new HttpError(404, `${Label(name)} isn't set yet.`);
    const result = await check(name, value);
    const meta = await metaRows();
    const source = await secrets.source(name);
    if (result.status === "unverified" && meta.get(name)?.status === "ok" && (source === "vault" || !meta.get(name)?.last4)) {
      // The provider couldn't be asked this time: a key it accepted before stays accepted.
    } else if (source === "vault") {
      await mark(name, result);
    } else if (!meta.get(name)?.last4) {
      // From the environment: there is no stored copy to mark, so keep the result in a row of its own
      // (no last 4 characters). A row that describes a copy stored here is left alone.
      const row = { name, last4: null, status: result.status, verified_at: result.status === "unverified" ? null : new Date().toISOString(), message: result.message.slice(0, 300) };
      const { error } = await db.from("install_secrets_meta").upsert(row, { onConflict: "name" });
      if (error) throw new Error(error.message);
    }
    const state = await stateOf(name);
    // Always answer what this check found, also when it couldn't be written down.
    return { name, key: { ...state, status: result.status, message: result.message } };
  }

  async function deleteKey(input: Record<string, unknown>) {
    const name = keyName(input);
    // Supplied by the environment with no copy stored here: there is nothing to remove, so say where it lives.
    if (await secrets.source(name) === "env" && !(await metaRows()).get(name)?.last4) throw new HttpError(409, envWins(name));
    const { error } = await db.rpc("install_delete_secret", { p_name: name });
    if (error) throw new Error(`The key couldn't be removed: ${error.message}`);
    secrets.clear();
    return { ok: true };
  }

  async function rotateRunnerSecret() {
    const name = "CREATIVES_RUNNER_SECRET";
    if (await secrets.source(name) === "env") throw new HttpError(409, envWins(name));
    const secret = newRunnerSecret();
    const { error } = await db.rpc("install_put_secret", { p_name: name, p_value: secret });
    if (error) throw new Error(`The secret couldn't be saved: ${error.message}`);
    await mark(name, { status: "ok", message: "Generated here. Give it to the desktop runner; the old secret no longer works." });
    secrets.clear();
    return { secret, key: await stateOf(name) };
  }

  // MARK: Settings

  async function saveSettings(owner: Member, input: Record<string, unknown>) {
    const patch = settingsPatch(input);
    if (typeof patch === "string") throw new HttpError(400, patch);
    const { data, error } = await db.from("install").select("settings").maybeSingle();
    if (error || !data) throw new Error(error?.message ?? "This install has no settings row.");
    const { error: failed } = await db.from("install").update({ settings: mergeSettings(data.settings, patch) }).eq("id", true);
    if (failed) throw new Error(`The settings couldn't be saved: ${failed.message}`);
    auth.clear();
    return capabilities(owner);
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
