// Runs the provisioning steps in order, reporting progress, and stops at the first failure. Every
// step is safe to repeat, so "resume" is simply running again: finished work is skipped or redone
// harmlessly.
import { collectFunctionFiles, deployFunctions, FUNCTION_NAMES } from "./functions";
import { createOwner, detectPlan, limitsFor, listAdStyleAssets, listProjects, prepareStorage, projectProblem, readKeys, refreshPlanLimits, scheduleJobs } from "./install";
import { isProjectRef, managementApi, projectApi, projectUrl } from "./management-api";
import { applyMigrations, inspect, listMigrations, retargetSql, setFunctionUrls, type ProjectInspection } from "./migrations";
import { ProvisionError, redact, STEP_IDS, type Emit, type FetchLike, type Plan, type ProgressEvent, type ProjectKeys, type ProjectSummary, type RepoFiles, type StepId } from "./types";

export interface LocalConfig { supabaseUrl: string; publishableKey: string; publicOrigin: string | null; imageTransforms: boolean }

export interface ProvisionDeps {
  fetch: FetchLike;
  files: RepoFiles;
  /** Writes the local config file (step `config`). Left out, that step is skipped. */
  writeConfig?: (config: LocalConfig) => void | Promise<void>;
  /** Other base addresses, for tests. */
  managementBase?: string;
  projectBase?: (ref: string) => string;
}

export interface ProvisionInput {
  /** The person's Supabase access token. Used for this run only; never stored, logged or returned. */
  accessToken: string;
  ref: string;
  /** Which steps to run (always in the fixed order). Default: all of them. */
  steps?: readonly StepId[];
  /** Needed by the `owner` step. */
  owner?: { email: string; password: string };
  /** The address the app runs on, e.g. http://localhost:3000. */
  appOrigin?: string;
  /** Where a deployed copy is reachable from the internet; left out, read from the environment. */
  publicOrigin?: string | null;
  functions?: readonly string[];
  workspaceName?: string;
}

export interface ProvisionResult {
  ok: boolean;
  completed: StepId[];
  failed?: { step: StepId; code: string; message: string; detail?: string };
  project?: ProjectSummary;
  mode?: ProjectInspection["state"];
  plan?: Plan;
  supabaseUrl?: string;
  publishableKey?: string;
  ownerUserId?: string;
}

export const DEFAULT_APP_ORIGIN = "http://localhost:3000";

export async function provision(input: ProvisionInput, deps: ProvisionDeps, onEvent: Emit = () => {}): Promise<ProvisionResult> {
  const secrets: (string | undefined)[] = [input.accessToken, input.owner?.password];
  const emit: Emit = (event) => onEvent({ ...event, message: redact(event.message, secrets), ...(event.detail ? { detail: redact(event.detail, secrets) } : {}) });
  const wanted = new Set<StepId>(input.steps ?? STEP_IDS);
  const completed: StepId[] = [];
  const result: ProvisionResult = { ok: false, completed };
  const fail = (step: StepId, error: unknown): ProvisionResult => {
    const known = error instanceof ProvisionError;
    const message = redact(known ? error.message : "Something unexpected went wrong. Press Retry.", secrets);
    const detail = redact(known ? error.detail ?? "" : error instanceof Error ? error.message : String(error), secrets) || undefined;
    emit({ step, status: "failed", message, detail });
    return { ...result, failed: { step, code: known ? error.code : "unexpected", message, detail } };
  };

  if (!input.accessToken?.trim()) return fail("project", new ProvisionError("no_token", "Paste your Supabase access token first."));
  if (!isProjectRef(input.ref)) return fail("project", new ProvisionError("bad_ref", "Pick a project from the list first."));
  const ref = input.ref;
  const api = managementApi(deps.fetch, input.accessToken.trim(), deps.managementBase);
  const appOrigin = input.appOrigin ?? DEFAULT_APP_ORIGIN;

  // Later steps need what the first two find out, also when those two aren't asked for by name.
  let project: ProjectSummary | null = null;
  let plan: Plan | null = null;
  let keys: ProjectKeys | null = null;
  const needProject = async (announce: boolean) => {
    if (project && plan) return { project, plan };
    if (announce) emit({ step: "project", status: "running", message: "Looking at the project." });
    const found = (await listProjects(api)).find((candidate) => candidate.ref === ref);
    if (!found) throw new ProvisionError("no_project", "This access token can't see that project. Use a token from the Supabase account that owns it.");
    const problem = projectProblem(found);
    if (problem) throw new ProvisionError("not_ready", problem, { detail: `status ${found.status}` });
    const inspection = await inspect(api, ref);
    const detected = await detectPlan(api, found);
    project = found; plan = detected.plan;
    result.project = found; result.plan = detected.plan; result.mode = inspection.state; result.supabaseUrl = projectUrl(ref);
    if (announce) {
      emit({
        step: "project", status: "done",
        message: inspection.state === "empty" ? `"${found.name}" is empty and ready.` : `"${found.name}" was set up before. Only what is new will be added.`,
        detail: `${ref} · ${found.region} · ${detected.plan} plan (${detected.source}) · ${inspection.applied.length} database changes already applied`,
      });
    }
    return { project: found, plan: detected.plan };
  };
  const needKeys = async (announce: boolean) => {
    if (keys) return keys;
    if (announce) emit({ step: "keys", status: "running", message: "Reading the project's keys." });
    keys = await readKeys(api, ref);
    if (keys.secretKey) secrets.push(keys.secretKey);
    result.publishableKey = keys.publishableKey;
    if (announce) emit({ step: "keys", status: "done", message: "Got the project's keys. The secret one stays in memory and is never saved." });
    return keys;
  };
  const projectClient = async () => projectApi(deps.fetch, ref, (await needKeys(false)).secretKey, deps.projectBase?.(ref));

  const handlers: Record<StepId, () => Promise<void>> = {
    project: async () => { await needProject(true); },
    keys: async () => { await needProject(false); await needKeys(true); },
    migrations: async () => { await needProject(false); await applyMigrations(api, deps.files, ref, emit); },
    "function-urls": async () => { await needProject(false); await setFunctionUrls(api, ref, emit); },
    functions: async () => { await needProject(false); await deployFunctions(api, deps.files, ref, emit, input.functions ?? FUNCTION_NAMES); },
    owner: async () => {
      if (!input.owner) { emit({ step: "owner", status: "skipped", message: "No account details were given, so no account was created." }); return; }
      const { plan: detected } = await needProject(false);
      const owner = await createOwner(api, await projectClient(), ref, { ...input.owner, appOrigin, ...(input.publicOrigin !== undefined ? { publicOrigin: input.publicOrigin } : {}), limits: limitsFor(detected), workspaceName: input.workspaceName }, emit);
      result.ownerUserId = owner.userId;
    },
    storage: async () => {
      const { plan: detected } = await needProject(false);
      const { uploadLimitMb } = await prepareStorage(api, await projectClient(), deps.files, ref, detected, emit);
      // The plan was detected again for this run: after an upgrade (or a downgrade) the stored limits
      // follow it, unless the owner changed them by hand (install.ts limitsToWrite).
      await refreshPlanLimits(api, ref, detected, uploadLimitMb, emit);
    },
    jobs: async () => { await needProject(false); await scheduleJobs(api, ref, emit); },
    config: async () => {
      if (!deps.writeConfig) { emit({ step: "config", status: "skipped", message: "The connection wasn't saved on this computer." }); return; }
      const { plan: detected } = await needProject(false);
      const { publishableKey } = await needKeys(false);
      emit({ step: "config", status: "running", message: "Saving the connection on this computer." });
      await deps.writeConfig({ supabaseUrl: projectUrl(ref), publishableKey, publicOrigin: null, imageTransforms: detected === "paid" });
      emit({ step: "config", status: "done", message: "Saved. The app now uses your project." });
    },
  };

  for (const step of STEP_IDS) {
    if (!wanted.has(step)) continue;
    try { await handlers[step](); } catch (error) { return fail(step, error); }
    completed.push(step);
  }
  return { ...result, ok: true };
}

// MARK: Dry run

export interface ProvisionPlan {
  steps: StepId[];
  migrations: { file: string; retargeted: boolean }[];
  functions: { slug: string; files: string[]; missing: string[]; error?: string }[];
  assets: string[];
}

/** What a run would do, worked out from the files alone. Calls nothing. */
export async function planProvision(files: RepoFiles, options: { steps?: readonly StepId[]; functions?: readonly string[]; ref?: string } = {}): Promise<ProvisionPlan> {
  const ref = options.ref && isProjectRef(options.ref) ? options.ref : "a".repeat(20);
  const migrations: ProvisionPlan["migrations"] = [];
  for (const migration of await listMigrations(files)) {
    const sql = await files.readText(migration.path);
    migrations.push({ file: migration.file, retargeted: retargetSql(sql, ref) !== sql });
  }
  const functions: ProvisionPlan["functions"] = [];
  for (const slug of options.functions ?? FUNCTION_NAMES) {
    try {
      const bundle = await collectFunctionFiles(files, slug);
      functions.push({ slug, files: [...bundle.paths, ...(bundle.importMapPath ? [bundle.importMapPath] : [])], missing: bundle.missing });
    } catch (error) {
      functions.push({ slug, files: [], missing: [], error: error instanceof Error ? error.message : String(error) });
    }
  }
  const wanted = new Set<StepId>(options.steps ?? STEP_IDS);
  return { steps: STEP_IDS.filter((step) => wanted.has(step)), migrations, functions, assets: await listAdStyleAssets(files) };
}

export type { ProgressEvent };
