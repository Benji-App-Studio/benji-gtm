// Getting the owner back in without email: with a Supabase access token (the same kind setup uses),
// the owner's password is set to a new one through the project's Auth admin API. Used by the
// "Forgot your password?" page on a local copy, by the last setup step when a project that already has
// an owner is connected to a new computer, and by `scripts/provision.mjs --reset-password`.
//
// The token is used for this call only: never stored, logged or returned. So is the new password.
import { createOwner, isEmail, limitsFor, listProjects, projectProblem, readKeys } from "./install";
import { managementApi, projectApi, type ManagementApi, type ProjectApi } from "./management-api";
import { ProvisionError, redact, type Emit, type FetchLike } from "./types";

export interface OwnerAccount { id: string; email: string; recorded: boolean }

/**
 * The install's owner: by the owner id the install records, else by the email kept on this computer.
 * Null when neither finds an account (it was deleted).
 */
export async function findOwner(api: ManagementApi, ref: string, storedEmail?: string | null): Promise<OwnerAccount | null> {
  const [table] = await api.query<{ present: boolean }>(ref, "select to_regclass('public.install') is not null as present");
  if (!table?.present) throw new ProvisionError("not_prepared", "This Supabase project isn't set up for the app yet. Open the setup page and run setup from the start.");
  const [install] = await api.query<{ owner_user_id: string | null; email: string | null }>(ref,
    "select i.owner_user_id, (select u.email from auth.users u where u.id = i.owner_user_id) as email from public.install i where i.id");
  if (install?.owner_user_id && install.email) return { id: install.owner_user_id, email: install.email.toLowerCase(), recorded: true };
  if (storedEmail && isEmail(storedEmail)) {
    const [user] = await api.query<{ id: string }>(ref, "select id from auth.users where lower(email) = lower($1) limit 1", [storedEmail]);
    if (user?.id) return { id: user.id, email: storedEmail.trim().toLowerCase(), recorded: false };
  }
  return null;
}

export interface ResetInput {
  password: string;
  /** The email kept in the local config, when there is one: a second way to find the owner. */
  storedEmail?: string | null;
  /** Only when the owner's account is gone: create it again with this email. */
  recreateEmail?: string | null;
  /** The address the app runs on (needed only to create the account again). */
  appOrigin: string;
}

export interface ResetResult { email: string; userId: string; recreated: boolean }

export const NO_ACCOUNT_MESSAGE = "The owner's account is no longer in your Supabase project. Type your email below to create it again, with the password you chose.";

/** Sets the owner's password (or creates the owner again when asked and the account is gone). */
export async function resetOwnerPassword(api: ManagementApi, project: ProjectApi, ref: string, input: ResetInput, emit: Emit = () => {}): Promise<ResetResult> {
  if (input.password.length < 8) throw new ProvisionError("weak_password", "Use a password with at least 8 characters.");
  const owner = await findOwner(api, ref, input.storedEmail);
  if (!owner) {
    if (!input.recreateEmail) throw new ProvisionError("no_account", NO_ACCOUNT_MESSAGE);
    if (!isEmail(input.recreateEmail)) throw new ProvisionError("bad_email", "That doesn't look like an email address. Check it for typos.");
    // Existing settings and data stay: createOwner only fills in an owner where there is none.
    const made = await createOwner(api, project, ref, { email: input.recreateEmail, password: input.password, appOrigin: input.appOrigin, limits: limitsFor("free") }, emit);
    if (!made.created && !(await project.setUserPassword(made.userId, input.password))) throw new ProvisionError("no_account", NO_ACCOUNT_MESSAGE);
    return { email: input.recreateEmail.trim().toLowerCase(), userId: made.userId, recreated: true };
  }
  // Found by the stored email only: record them as the owner again (an owner is never replaced).
  if (!owner.recorded) await createOwner(api, project, ref, { email: owner.email, password: input.password, appOrigin: input.appOrigin, limits: limitsFor("free") }, emit);
  if (!(await project.setUserPassword(owner.id, input.password))) throw new ProvisionError("no_account", NO_ACCOUNT_MESSAGE);
  return { email: owner.email, userId: owner.id, recreated: false };
}

export interface LocalResetInput extends ResetInput {
  accessToken: string;
  ref: string;
}

export interface LocalResetDeps { fetch: FetchLike; managementBase?: string; projectBase?: (ref: string) => string }

/**
 * The whole reset from a token: checks the token can see the project and that it is running, reads a
 * secret key (kept in memory), then sets the password. Errors carry plain sentences with no secret in them.
 */
export async function localReset(input: LocalResetInput, deps: LocalResetDeps): Promise<ResetResult & { publishableKey: string }> {
  const secrets = [input.accessToken, input.password];
  try {
    if (!input.accessToken?.trim()) throw new ProvisionError("no_token", "Paste your Supabase access token first.");
    const api = managementApi(deps.fetch, input.accessToken.trim(), deps.managementBase);
    const project = (await listProjects(api)).find((candidate) => candidate.ref === input.ref);
    if (!project) throw new ProvisionError("no_project", "This access token can't see your project. Use a token from the Supabase account that owns it.");
    const problem = projectProblem(project);
    if (problem) throw new ProvisionError("not_ready", problem, { detail: `status ${project.status}` });
    const keys = await readKeys(api, input.ref);
    secrets.push(keys.secretKey);
    const result = await resetOwnerPassword(api, projectApi(deps.fetch, input.ref, keys.secretKey, deps.projectBase?.(input.ref)), input.ref, input);
    return { ...result, publishableKey: keys.publishableKey };
  } catch (error) {
    if (error instanceof ProvisionError) {
      throw new ProvisionError(error.code, redact(error.message, secrets), { detail: error.detail ? redact(error.detail, secrets) : undefined, status: error.status });
    }
    throw new ProvisionError("unexpected", "Something unexpected went wrong. Try again.", { detail: redact(error instanceof Error ? error.message : String(error), secrets) });
  }
}
