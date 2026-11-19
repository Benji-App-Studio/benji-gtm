// The steps that make a prepared project somebody's install: its keys, its plan and limits, the owner
// account, the public assets and the optional scheduled jobs. Each is safe to run again.
import { sqlLiteral } from "./migrations";
import type { ApiProject, ManagementApi, ProjectApi } from "./management-api";
import { ProvisionError, type Emit, type InstallLimits, type Plan, type ProjectKeys, type ProjectSummary, type RepoFiles } from "./types";

export const ASSETS_BUCKET = "app-assets";
export const AD_STYLES_DIR = "studio/public/ad-styles";
export const AD_STYLES_PREFIX = "ad-styles";

const MB = 1024 * 1024;
/** The free plan's ceiling for one uploaded file. */
export const FREE_UPLOAD_MB = 50;
/** What the largest bucket (copies of competitors' videos) allows, so paid plans are raised to it. */
export const PAID_UPLOAD_MB = 300;

/** What the plan allows: how long a function may run, how big an upload may be, how much storage is included. */
export const limitsFor = (plan: Plan, uploadLimitMb?: number): InstallLimits =>
  plan === "paid"
    ? { wallClockSec: 400, uploadLimitMb: uploadLimitMb ?? PAID_UPLOAD_MB, storageQuotaGb: 100 }
    : { wallClockSec: 150, uploadLimitMb: Math.min(uploadLimitMb ?? FREE_UPLOAD_MB, FREE_UPLOAD_MB), storageQuotaGb: 1 };

// MARK: Projects, plan, keys

export const toSummary = (project: ApiProject): ProjectSummary => ({
  ref: project.ref ?? project.id ?? "",
  name: project.name,
  region: project.region,
  status: project.status,
  organizationSlug: project.organization_slug ?? project.organization_id ?? "",
});

export async function listProjects(api: ManagementApi): Promise<ProjectSummary[]> {
  return (await api.listProjects()).map(toSummary).filter((project) => project.ref);
}

/** Why a project can't be used right now, in plain words; null when it is running. */
export function projectProblem(project: ProjectSummary): string | null {
  if (project.status === "ACTIVE_HEALTHY") return null;
  if (project.status === "COMING_UP" || project.status === "RESTORING" || project.status === "RESTARTING" || project.status === "UNKNOWN") {
    return `"${project.name}" is still starting. Wait about two minutes, then check again.`;
  }
  if (project.status === "INACTIVE" || project.status === "PAUSING" || project.status === "GOING_DOWN") {
    return `"${project.name}" is paused. Open it in your Supabase dashboard, press Restore, then check again.`;
  }
  return `"${project.name}" isn't running normally (Supabase says ${project.status}). Open it in your Supabase dashboard to see why.`;
}

/**
 * Free or paid. The organization says so; when it doesn't, a project that can resize images is on a
 * paid plan (Supabase offers that from Pro up).
 */
export async function detectPlan(api: ManagementApi, project: ProjectSummary): Promise<{ plan: Plan; source: string }> {
  const organization = project.organizationSlug ? await api.getOrganization(project.organizationSlug) : null;
  if (organization?.plan) return { plan: organization.plan === "free" ? "free" : "paid", source: `organization plan: ${organization.plan}` };
  const storage = await api.getStorageConfig(project.ref).catch(() => null);
  if (storage?.features?.imageTransformation?.enabled) return { plan: "paid", source: "image resizing is on" };
  return { plan: "free", source: "no plan reported; treated as free" };
}

const usable = (value: string | null | undefined): value is string => typeof value === "string" && /^[\w.\-]{20,}$/.test(value);

/**
 * The project's publishable key (for the browser) and a secret key (for setup's own calls). Newer
 * projects have both; one is added when it is missing, and the older anon / service_role pair is the
 * fallback.
 */
export async function readKeys(api: ManagementApi, ref: string, options: { create?: boolean } = {}): Promise<ProjectKeys> {
  // `create: false` only reads: adopting an existing install must not add keys to it.
  const create = options.create !== false;
  const keys = await api.apiKeys(ref);
  const pick = (test: (key: (typeof keys)[number]) => boolean) => keys.find((key) => test(key) && usable(key.api_key))?.api_key ?? null;
  let publishable = pick((key) => key.type === "publishable");
  if (!publishable) {
    const created = create ? await api.createApiKey(ref, { type: "publishable", name: "default" }) : null;
    publishable = usable(created?.api_key) ? created.api_key : pick((key) => key.name === "anon");
  }
  let secret = pick((key) => key.type === "secret");
  if (!secret) secret = pick((key) => key.name === "service_role");
  if (!secret && create) {
    const created = await api.createApiKey(ref, { type: "secret", name: "setup", secret_jwt_template: { role: "service_role" } });
    secret = usable(created?.api_key) ? created.api_key : null;
  }
  if (!publishable || !secret) {
    throw new ProvisionError("no_keys", "Couldn't read this project's API keys. Open the project in Supabase, wait until it has finished starting, then press Retry.", { detail: `publishable: ${publishable ? "found" : "missing"}, secret: ${secret ? "found" : "missing"}` });
  }
  return { publishableKey: publishable, secretKey: secret };
}

// MARK: Owner

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isEmail = (value: unknown): value is string => typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) && value.length <= 254;

/** An address with its twin: a browser may open the app as localhost or as 127.0.0.1. */
export function localOrigins(origin: string): string[] {
  const url = new URL(origin);
  const twin = url.hostname === "localhost" ? "127.0.0.1" : url.hostname === "127.0.0.1" ? "localhost" : null;
  return twin ? [url.origin, `${url.protocol}//${twin}${url.port ? `:${url.port}` : ""}`] : [url.origin];
}

const maskEmail = (email: string): string => email.replace(/^(.).*(@.*)$/, "$1***$2");

export interface OwnerInput { email: string; password: string; appOrigin: string; limits: InstallLimits; workspaceName?: string }

/**
 * Creates the owner's account (already confirmed, so no email is needed), records them as the owner
 * of this install, then closes public sign-up and tells Supabase the address the app runs on.
 */
export async function createOwner(api: ManagementApi, project: ProjectApi, ref: string, input: OwnerInput, emit: Emit): Promise<{ userId: string; created: boolean }> {
  const email = input.email.trim().toLowerCase();
  if (!isEmail(email)) throw new ProvisionError("bad_email", "That doesn't look like an email address. Check it for typos.");
  if (input.password.length < 8) throw new ProvisionError("weak_password", "Use a password with at least 8 characters.");
  emit({ step: "owner", status: "running", message: "Creating your account." });

  const [install] = await api.query<{ owner_user_id: string | null; email: string | null }>(ref,
    "select i.owner_user_id, (select u.email from auth.users u where u.id = i.owner_user_id) as email from public.install i where i.id");
  if (install?.owner_user_id && (install.email ?? "").toLowerCase() !== email) {
    throw new ProvisionError("owner_exists", `This project already has an owner (${maskEmail(install.email ?? "another account")}). Sign in with that account instead.`);
  }

  const lookup = "select id from auth.users where lower(email) = lower($1) limit 1";
  let [user] = await api.query<{ id: string }>(ref, lookup, [email]);
  let created = false;
  if (!user) {
    const made = await project.createUser({ email, password: input.password });
    if (made) { user = made; created = true; }
    else [user] = await api.query<{ id: string }>(ref, lookup, [email]);
  }
  if (!user || !UUID.test(user.id)) throw new ProvisionError("no_owner", "Couldn't create your account. Press Retry.", { detail: "auth.users has no row for that email after the create call" });

  const settings = JSON.stringify({ name: input.workspaceName?.trim() || "My workspace", aiProvider: "openai", limits: input.limits });
  // Settings saved earlier win over these defaults, and an owner is never replaced.
  await api.query(ref, [
    `insert into public.install (id, owner_user_id, settings) values (true, ${sqlLiteral(user.id)}::uuid, ${sqlLiteral(settings)}::jsonb)`,
    "on conflict (id) do update set owner_user_id = coalesce(public.install.owner_user_id, excluded.owner_user_id), settings = excluded.settings || public.install.settings;",
    `insert into public.install_members (user_id, role) values (${sqlLiteral(user.id)}::uuid, 'owner')`,
    "on conflict (user_id) do update set role = 'owner';",
  ].join("\n"));

  emit({ step: "owner", status: "running", message: "Closing sign-up so only you can get in." });
  const current = await api.getAuthConfig(ref);
  const allowed = new Set((current.uri_allow_list ?? "").split(",").map((entry) => entry.trim()).filter(Boolean));
  for (const origin of localOrigins(input.appOrigin)) allowed.add(`${origin}/**`);
  await api.updateAuthConfig(ref, { site_url: new URL(input.appOrigin).origin, uri_allow_list: [...allowed].join(","), disable_signup: true });

  emit({ step: "owner", status: "done", message: created ? "Your account is ready. Sign-up is closed to everyone else." : "This email already had an account in the project, so its password was kept. Sign-up is closed to everyone else." });
  return { userId: user.id, created };
}

/** Whether this project's install already has an owner (false on a project that isn't prepared yet). */
export async function installOwned(api: ManagementApi, ref: string): Promise<boolean> {
  const [table] = await api.query<{ present: boolean }>(ref, "select to_regclass('public.install') is not null as present");
  if (!table?.present) return false;
  const [install] = await api.query<{ owned: boolean }>(ref, "select owner_user_id is not null as owned from public.install where id");
  return Boolean(install?.owned);
}

// MARK: Storage, jobs

const CONTENT_TYPES: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", svg: "image/svg+xml" };
const contentType = (file: string): string | null => CONTENT_TYPES[file.slice(file.lastIndexOf(".") + 1).toLowerCase()] ?? null;

export const ASSETS_BUCKET_SQL = `insert into storage.buckets (id, name, public) values (${sqlLiteral(ASSETS_BUCKET)}, ${sqlLiteral(ASSETS_BUCKET)}, true) on conflict (id) do update set public = true;`;

/** The Style Library images that ship with the app. */
export async function listAdStyleAssets(files: RepoFiles): Promise<string[]> {
  return (await files.list(AD_STYLES_DIR)).filter((file) => contentType(file));
}

/** Makes sure the public `app-assets` bucket exists and copies the Style Library images into it. Returns how many. */
export async function copyStyleAssets(api: ManagementApi, project: ProjectApi, files: RepoFiles, ref: string, emit: Emit): Promise<number> {
  emit({ step: "storage", status: "running", message: "Making a place for the app's own images." });
  await api.query(ref, ASSETS_BUCKET_SQL);

  const assets = await listAdStyleAssets(files);
  let uploaded = 0;
  const queue = [...assets];
  const worker = async () => {
    for (let file = queue.shift(); file; file = queue.shift()) {
      await project.uploadObject(ASSETS_BUCKET, `${AD_STYLES_PREFIX}/${file}`, await files.readBytes(`${AD_STYLES_DIR}/${file}`), contentType(file) as string);
      uploaded += 1;
      emit({ step: "storage", status: "running", message: `Copying Style Library image ${uploaded} of ${assets.length}.`, detail: file, progress: { done: uploaded, total: assets.length } });
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, assets.length) }, worker));
  return uploaded;
}

/**
 * Copies the Style Library images into the public `app-assets` bucket and fits the project's upload
 * limit to its plan. Returns the limit now in force, in MB.
 */
export async function prepareStorage(api: ManagementApi, project: ProjectApi, files: RepoFiles, ref: string, plan: Plan, emit: Emit): Promise<{ uploaded: number; uploadLimitMb: number }> {
  const uploaded = await copyStyleAssets(api, project, files, ref, emit);
  const storage = await api.getStorageConfig(ref);
  const currentMb = Math.round((storage.fileSizeLimit ?? FREE_UPLOAD_MB * MB) / MB);
  const targetMb = plan === "paid" ? Math.max(currentMb, PAID_UPLOAD_MB) : FREE_UPLOAD_MB;
  let uploadLimitMb = currentMb;
  if (targetMb !== currentMb) {
    try {
      await api.updateStorageConfig(ref, { fileSizeLimit: targetMb * MB });
      uploadLimitMb = targetMb;
    } catch (error) {
      // Not worth stopping setup for: the app works with the limit the project already has.
      emit({ step: "storage", status: "running", message: `Kept the project's upload limit at ${currentMb} MB.`, detail: error instanceof ProvisionError ? error.detail : String(error) });
    }
  }
  emit({ step: "storage", status: "done", message: `Copied ${uploaded} Style Library images. One file can be up to ${uploadLimitMb} MB.`, progress: { done: uploaded, total: uploaded } });
  return { uploaded, uploadLimitMb };
}

/** Turns on the optional schedules (Measure sync, the daily Launch run). They wait for an owner. */
export async function scheduleJobs(api: ManagementApi, ref: string, emit: Emit): Promise<boolean> {
  const [install] = await api.query<{ owned: boolean }>(ref, "select owner_user_id is not null as owned from public.install where id");
  if (!install?.owned) {
    emit({ step: "jobs", status: "skipped", message: "The scheduled jobs start once your account exists." });
    return false;
  }
  await api.query(ref, "select public.install_schedule_optional_jobs();");
  emit({ step: "jobs", status: "done", message: "The scheduled jobs are on." });
  return true;
}
