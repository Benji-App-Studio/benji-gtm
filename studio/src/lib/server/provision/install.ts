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

const LIMIT_FIELDS = ["wallClockSec", "uploadLimitMb", "storageQuotaGb"] as const;
const sameLimits = (a: InstallLimits, b: InstallLimits) => LIMIT_FIELDS.every((field) => a[field] === b[field]);

/**
 * What an update run writes to `install.settings.limits` after the plan was detected again, or null to
 * leave them. They are rewritten only when they still hold the other plan's defaults (what setup wrote,
 * so the plan changed since: an upgrade, or a downgrade); limits the owner changed by hand are never
 * touched. Missing fields read as the free plan's, as the functions read them (_shared/limits.ts).
 */
export function limitsToWrite(stored: unknown, plan: Plan, uploadLimitMb?: number): InstallLimits | null {
  const set = stored && typeof stored === "object" && !Array.isArray(stored) ? stored as Record<string, unknown> : {};
  const current = { ...limitsFor("free") } as InstallLimits;
  for (const field of LIMIT_FIELDS) {
    const value = set[field];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) current[field] = value;
  }
  const target = limitsFor(plan, uploadLimitMb);
  const other = limitsFor(plan === "paid" ? "free" : "paid");
  if (sameLimits(current, target)) return null;
  return sameLimits(current, other) ? target : null;
}

/**
 * During an update: the plan is detected again (it may have been upgraded since setup), and the stored
 * limits follow it when they are still the other plan's defaults (limitsToWrite). The write only lands
 * if nobody changed the limits meanwhile. Answers what was done.
 */
export async function refreshPlanLimits(api: ManagementApi, ref: string, plan: Plan, uploadLimitMb: number, emit: Emit): Promise<"updated" | "kept" | "unchanged" | "no_install"> {
  const [row] = await api.query<{ limits: unknown }>(ref, "select settings->'limits' as limits from public.install where id");
  if (!row) return "no_install";
  const next = limitsToWrite(row.limits, plan, uploadLimitMb);
  if (!next) {
    const target = limitsFor(plan, uploadLimitMb);
    const stored = row.limits && typeof row.limits === "object" ? row.limits as Record<string, unknown> : {};
    const handMade = LIMIT_FIELDS.some((field) => typeof stored[field] === "number" && stored[field] !== target[field]);
    if (handMade) {
      emit({ step: "storage", status: "done", message: `Your ${plan} plan's limits weren't applied: the ones in Settings > Limits were changed by hand, so they were kept.`, detail: `stored ${JSON.stringify(stored)}; ${plan} plan ${JSON.stringify(target)}` });
      return "kept";
    }
    return "unchanged";
  }
  await api.query(ref, "update public.install set settings = jsonb_set(settings, '{limits}', $1::jsonb, true) where id and (settings->'limits') is not distinct from $2::jsonb",
    [JSON.stringify(next), row.limits === null || row.limits === undefined ? null : JSON.stringify(row.limits)]);
  emit({
    step: "storage", status: "done",
    message: `Limits now match your ${plan} plan: ${next.wallClockSec} s per function run, ${next.uploadLimitMb} MB per file, ${next.storageQuotaGb} GB of storage.`,
    detail: `was ${JSON.stringify(row.limits ?? null)}`,
  });
  return "updated";
}

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
    return `"${project.name}" is paused. Open it in your Supabase dashboard, press Resume project, then check again.`;
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

/** The project already has its owner: this caller signs in with that account (the setup page offers it). */
const ownerExists = (email: string | null) =>
  new ProvisionError("owner_exists", `This project already has its owner (${maskEmail(email ?? "another account")}). Sign in as the owner instead.`);

export interface OwnerInput {
  email: string; password: string; appOrigin: string; limits: InstallLimits; workspaceName?: string;
  /** Where a deployed copy is reachable from the internet. Left out: read from the environment (publicOriginFromEnv). */
  publicOrigin?: string | null;
}

/** An http(s) address reduced to its origin, or null. */
export function cleanPublicOrigin(value: string | null | undefined): string | null {
  const text = value?.trim();
  if (!text) return null;
  try {
    const url = new URL(text.includes("://") ? text : `https://${text}`);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

/** A deployed copy's public address, from the same settings the app reads (lib/install/config.ts). */
export function publicOriginFromEnv(): string | null {
  const env = process.env;
  return cleanPublicOrigin(env["NEXT_PUBLIC_PUBLIC_ORIGIN"] || env["PUBLIC_ORIGIN"] || env["VERCEL_PROJECT_PRODUCTION_URL"] || null);
}

/**
 * The project's Site URL and redirect allow-list. The local addresses (with their localhost/127.0.0.1
 * twin) are always allowed. A copy with a public address also allows `<public>/auth/confirm**`, where the
 * password-reset, confirmation and Google sign-in links come back, and uses it as the Site URL, so a link
 * Supabase can't match never falls back to a local address.
 */
export function authUrlConfig(currentAllowList: string | null | undefined, appOrigin: string, publicOrigin: string | null): { site_url: string; uri_allow_list: string } {
  const allowed = new Set((currentAllowList ?? "").split(",").map((entry) => entry.trim()).filter(Boolean));
  for (const origin of localOrigins(appOrigin)) allowed.add(`${origin}/**`);
  if (publicOrigin) allowed.add(`${publicOrigin}/auth/confirm**`);
  return { site_url: publicOrigin ?? new URL(appOrigin).origin, uri_allow_list: [...allowed].join(",") };
}

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
  if (install?.owner_user_id && (install.email ?? "").toLowerCase() !== email) throw ownerExists(install.email);

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
  // One claim in the database that only one caller can win (migration 20261119180000): two setup tabs
  // racing each other get one owner. Settings saved earlier win over these defaults, an owner is never
  // replaced, and only the recorded owner gets the owner membership.
  const [claim] = await api.query<{ owner: string | null }>(ref, "select public.install_claim_owner($1::uuid, $2::jsonb) as owner", [user.id, settings]);
  if (claim?.owner !== user.id) {
    // Another tab won. An account made just now for the losing email is removed again, so it can't linger.
    if (created) await api.query(ref, "delete from auth.users where id = $1::uuid and not exists (select 1 from public.install where owner_user_id = $1::uuid)", [user.id]);
    const [winner] = claim?.owner ? await api.query<{ email: string | null }>(ref, "select email::text as email from auth.users where id = $1::uuid", [claim.owner]) : [];
    throw ownerExists(winner?.email ?? null);
  }

  emit({ step: "owner", status: "running", message: "Closing sign-up so only you can get in." });
  const current = await api.getAuthConfig(ref);
  const publicOrigin = input.publicOrigin === undefined ? publicOriginFromEnv() : cleanPublicOrigin(input.publicOrigin);
  await api.updateAuthConfig(ref, { ...authUrlConfig(current.uri_allow_list, input.appOrigin, publicOrigin), disable_signup: true });

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
