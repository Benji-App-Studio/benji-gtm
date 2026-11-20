// The install's own backend: who may use this copy of the app, its settings, and its API keys.
//
// Keys are checked live with their provider (checks.ts), then stored in Vault through the
// `install_put_secret` RPC; every other function reads them with _shared/keys.ts. Nothing here ever
// answers with a key's value: the app sees "set, last 4 characters, checked" (settings.ts KeyState).
// The one exception is `runner-secret/rotate`, which shows the secret it just generated, once.
//
// Routes (the owner of the install unless noted):
//   GET  health                               no sign-in: { ok: true } (accounts mode: { ok: true, mode: "accounts" })
//   GET  capabilities                         any member: role, settings and each key's state
//                                             (on an install from before setup existed: any signed-in user, role "legacy")
//   POST keys/put            { name, value }  check the key live, store it, answer { name, key }
//                                             (a key its provider rejects answers 400 { error } and nothing is stored)
//   POST keys/verify         { name }         check the stored key again, answer { name, key }
//   POST keys/delete         { name }         forget the key, answer { ok: true }
//   POST settings            { name?, aiProvider?, models?, limits? }   merge into the settings, answer the new state
//   GET  members                              { members }
//   POST members/add         { email, redirectTo? }   add someone; { member, inviteLink? } (the link is for the owner to pass on)
//   POST members/remove      { userId }       { ok: true } (never the owner)
//   POST runner-secret/rotate                 a new secret for the desktop runner: { secret, key }
//   GET  storage                              any member: what is stored, by bucket and app ({ rows, apps, quotaBytes, uploadLimitBytes })
//   POST storage/cleanup     { action, appId?, days?, run?, deleting? }   any member: preview (run false) or run a cleanup
//                                             ({ action, files, bytes, items, done }; storage.ts)
//   POST account/delete      { confirm }      the caller deletes their own account (account.ts): every app, file,
//                                             key and row, then the sign-in: { deleted, done, apps, files, bytes }.
//                                             done false: call again, it carries on (no confirm needed once started;
//                                             409 "busy" while another call works on it). Accounts mode: any account
//                                             but the install's owner and the last staff account; install mode:
//                                             members, never the owner (403, code "owner"); legacy: 403.
//   POST account/delete/sweep                 the cron job (worker secret): carries on stalled deletions and looks at
//                                             deleted accounts' folders again 3 h and 24 h later.
//
// Accounts mode (a platform row; routes.ts): "the owner" above is each account itself, for its own keys
// and settings; capabilities adds { mode: "accounts", plan }; the settings route ignores limits; members,
// members/add and members/remove answer 404; runner-secret/rotate is for staff only; storage and its
// cleanups see only the caller's apps and uploads.
import { createClient } from "@supabase/supabase-js";
import { createTenancy } from "../_shared/tenant.ts";
import { createInstall } from "./routes.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

function serviceKey(): string {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    return keys.default ?? Object.values(keys)[0];
  } catch {
    throw new Error("No service key in the environment.");
  }
}

const db = createClient(SUPABASE_URL, serviceKey(), { auth: { persistSession: false, autoRefreshToken: false } });

Deno.serve(createInstall({ db, tenancy: createTenancy(db), fetch, env: (name) => Deno.env.get(name) }));
