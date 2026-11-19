// The last setup step, around `provision`: create the owner (or, for a project that already has one,
// connect this computer and set the owner's password again), sign them in, and keep the sign-in in the
// local config so the app signs them in by itself on this computer from then on.
//
// Pure: Supabase calls go through `deps.fetch`; signing in and saving the sign-in are passed in, so
// the route and the tests share this code.
import { installOwned } from "./install";
import { managementApi, projectUrl } from "./management-api";
import { localReset } from "./reset";
import { provision, type ProvisionDeps, type ProvisionResult } from "./run";
import { ACCOUNT_STEPS, ProvisionError, type Emit, type FetchLike, type ProgressEvent, type StepId } from "./types";

export const CONNECT_STEPS: readonly StepId[] = ["project", "keys", "config"];

export interface AccountStepInput {
  accessToken: string;
  ref: string;
  /** A project that already has its owner: connect it and set the owner's password to `password`. */
  connectOnly: boolean;
  /** The owner's email (a new account only). */
  email?: string;
  /** The password typed on the page. */
  password: string;
  appOrigin?: string;
}

export interface AccountStepDeps {
  provision: ProvisionDeps;
  /** Signs in on the server (session cookies on the response). */
  signIn: (email: string, password: string) => Promise<boolean>;
  /** Keeps the owner's sign-in in the local config. */
  rememberOwner: (owner: { email: string; password: string }) => void;
}

export type AccountStepResult =
  | { ok: true; email: string; signedIn: boolean; events: ProgressEvent[] }
  | { ok: false; status: number; error: string; detail?: string; code?: string; events: ProgressEvent[] };

/**
 * Whether the owner can sign in with this password, asked of the project's Auth directly (the password
 * grant, with the publishable key): no cookies, no local config needed. The local config is written
 * only after this answers yes, so a reset or sign-in that fails leaves setup where it was, to retry.
 */
export async function passwordWorks(fetch: FetchLike, base: string, publishableKey: string, email: string, password: string): Promise<boolean> {
  try {
    const response = await fetch(`${base}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: publishableKey, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    await response.body?.cancel().catch(() => undefined);
    return response.ok;
  } catch {
    return false;
  }
}

const SIGN_IN_FAILED = "Your password was set, but signing in with it didn't work yet. Nothing was saved on this computer, so press the button again to retry.";

export async function completeAccountStep(input: AccountStepInput, deps: AccountStepDeps, onEvent: Emit = () => {}): Promise<AccountStepResult> {
  const events: ProgressEvent[] = [];
  const emit: Emit = (event) => { events.push(event); onEvent(event); };
  const failed = (error: unknown, status = 502): AccountStepResult => error instanceof ProvisionError
    ? { ok: false, status: error.code === "no_account" || error.code === "owner_exists" || error.code === "not_ready" ? 409 : error.status === 401 ? 401 : status, error: error.message, detail: error.detail, code: error.code, events }
    : { ok: false, status: 500, error: "Something unexpected went wrong. Try again.", events };
  if (input.password.length < 8) return { ok: false, status: 400, error: "Use a password with at least 8 characters.", events };
  const appOrigin = input.appOrigin ?? "http://localhost:3000";
  const base = deps.provision.projectBase?.(input.ref) ?? projectUrl(input.ref);
  const run = (steps: readonly StepId[], owner?: { email: string; password: string }) =>
    provision({ accessToken: input.accessToken, ref: input.ref, steps, appOrigin, ...(owner ? { owner } : {}) }, deps.provision, emit);
  const stopped = (result: ProvisionResult): AccountStepResult =>
    ({ ok: false, status: result.failed?.code === "owner_exists" ? 409 : 502, error: result.failed?.message ?? "Setup stopped. Try again.", detail: result.failed?.detail, code: result.failed?.code, events });

  if (input.connectOnly) {
    // The browser's word isn't enough: a prepared project with no owner would be connected and left ownerless.
    try {
      if (!(await installOwned(managementApi(deps.provision.fetch, input.accessToken), input.ref))) {
        return { ok: false, status: 409, error: "This project doesn't have an owner yet. Create your account to finish setup.", events };
      }
    } catch (error) { return failed(error); }
    // The project and its keys first; the connection is saved on this computer only once the reset and
    // a sign-in with the new password have worked.
    const checked = await run(CONNECT_STEPS.filter((step) => step !== "config"));
    if (!checked.ok) return stopped(checked);
    let reset: { email: string; publishableKey: string };
    try {
      reset = await localReset({ accessToken: input.accessToken, ref: input.ref, password: input.password, appOrigin }, deps.provision);
    } catch (error) { return failed(error); }
    if (!(await passwordWorks(deps.provision.fetch, base, reset.publishableKey, reset.email, input.password))) return { ok: false, status: 502, error: SIGN_IN_FAILED, events };
    const saved = await run(["config"]);
    if (!saved.ok) return stopped(saved);
    return finish(reset.email);
  }

  const email = (input.email ?? "").trim().toLowerCase();
  const made = await run(ACCOUNT_STEPS.filter((step) => step !== "config"), { email, password: input.password });
  if (!made.ok) return stopped(made);
  const publishableKey = made.publishableKey ?? "";
  // An account that already existed keeps its old password: set it to the one just typed, so what the
  // page shows is what works. The connection is saved only once that password signs in.
  if (!(await passwordWorks(deps.provision.fetch, base, publishableKey, email, input.password))) {
    try { await localReset({ accessToken: input.accessToken, ref: input.ref, password: input.password, storedEmail: email, appOrigin }, deps.provision); } catch (error) { return failed(error); }
    if (!(await passwordWorks(deps.provision.fetch, base, publishableKey, email, input.password))) return { ok: false, status: 502, error: SIGN_IN_FAILED, events };
  }
  const saved = await run(["config"]);
  if (!saved.ok) return stopped(saved);
  return finish(email);

  async function finish(owner: string): Promise<AccountStepResult> {
    // The config now names the project, so the server's own sign-in (session cookies) can work.
    const signedIn = await deps.signIn(owner, input.password);
    if (signedIn) {
      try { deps.rememberOwner({ email: owner, password: input.password }); } catch { /* the login page asks once, and keeps it then */ }
    }
    return { ok: true, email: owner, signedIn, events };
  }
}
