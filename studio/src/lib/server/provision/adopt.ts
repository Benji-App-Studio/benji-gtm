// Adoption: brings an install that already exists under the ledger. Its database was built by hand
// from these same migrations before the ledger existed, its keys are edge function secrets and it has
// no `install` row. A normal run refuses such a project ("already has data"); this records what is
// already there instead of running it again, and then changes as little as it is asked to.
//
// Terminal only (scripts/provision.mjs --adopt). Every step is safe to repeat. A dry run makes the
// same read-only calls and reports what each step would do; it cannot write (readOnlyFetch).
// The guide is docs/ADOPTING-AN-EXISTING-INSTALL.md.
import { deployFunctions, FUNCTION_NAMES } from "./functions";
import { ASSETS_BUCKET, copyStyleAssets, detectPlan, isEmail, listAdStyleAssets, listProjects, projectProblem, readKeys, scheduleJobs } from "./install";
import { isProjectRef, managementApi, projectApi, projectUrl } from "./management-api";
import { applyMigrations, LEDGER_SQL, listMigrations, setFunctionUrls, sha256Hex, sqlLiteral, type MigrationFile } from "./migrations";
import type { LocalConfig, ProvisionDeps } from "./run";
import { ProvisionError, redact, type FetchLike, type InstallLimits, type ProgressEvent, type ProjectSummary, type RepoFiles, type StepId, type StepStatus } from "./types";

/** The last migration an install built by hand is expected to have: everything before the ledger existed. */
export const ADOPT_BASELINE_VERSION = "20261106103000";

/**
 * The numbers the functions use on an install with no `install` row (supabase/functions/_shared/limits.ts,
 * LEGACY_LIMITS). Written into the new row so that giving the install an owner doesn't change them.
 */
export const LEGACY_LIMITS: InstallLimits = { wallClockSec: 400, uploadLimitMb: 300, storageQuotaGb: 100 };

export const ADOPT_STEP_IDS = ["project", "check", "ledger", "migrations", "function-urls", "functions", "owner", "storage", "jobs", "config"] as const;
export type AdoptStepId = (typeof ADOPT_STEP_IDS)[number];

export const ADOPT_STEP_LABELS: Record<AdoptStepId, string> = {
  project: "Find the project",
  check: "Check it is this app's database",
  ledger: "Record the migrations it already has",
  migrations: "Apply newer migrations",
  "function-urls": "Function addresses",
  functions: "Edge functions",
  owner: "Owner and members",
  storage: "Style Library images",
  jobs: "Optional scheduled jobs",
  config: "Local config file",
};

export interface AdoptEvent {
  step: AdoptStepId;
  /** `planned`: a dry run saying what it would do. */
  status: StepStatus | "planned";
  message: string;
  detail?: string;
}
export type AdoptEmit = (event: AdoptEvent) => void;

// MARK: Sentinel objects

export interface ObjectNames { tables: string[]; functions: string[] }

const CREATE = /^[ \t]*create[ \t]+(or[ \t]+replace[ \t]+)?(table|function)[ \t]+(if[ \t]+not[ \t]+exists[ \t]+)?(?:"?([a-z_][a-z0-9_]*)"?\.)?"?([a-z_][a-z0-9_]*)"?/gim;
const DROP = /^[ \t]*drop[ \t]+(table|function)[ \t]+(?:if[ \t]+exists[ \t]+)?(?:"?([a-z_][a-z0-9_]*)"?\.)?"?([a-z_][a-z0-9_]*)"?/gim;
const RENAME = /^[ \t]*alter[ \t]+(table|function)[ \t]+(?:if[ \t]+exists[ \t]+)?(?:"?([a-z_][a-z0-9_]*)"?\.)?"?([a-z_][a-z0-9_]*)"?(?:\([^)]*\))?[ \t]+rename[ \t]+to[ \t]+"?([a-z_][a-z0-9_]*)"?/gim;
/** The ledger is made by setup itself, so it never counts as evidence for or against. */
const LEDGER_TABLE = "install_migrations";
const inPublic = (schema: string | undefined) => !schema || schema.toLowerCase() === "public";

interface Statement { at: number; kind: "create" | "drop" | "rename"; object: "table" | "function"; name: string; to?: string; plain?: boolean }

/** Every `create`, `drop` and `rename` of a table or function in the public schema, in the order written. */
function statements(sql: string): Statement[] {
  const found: Statement[] = [];
  for (const match of sql.matchAll(CREATE)) {
    if (inPublic(match[4])) found.push({ at: match.index, kind: "create", object: match[2].toLowerCase() as "table" | "function", name: match[5].toLowerCase(), plain: !match[1] && !match[3] });
  }
  for (const match of sql.matchAll(DROP)) {
    if (inPublic(match[2])) found.push({ at: match.index, kind: "drop", object: match[1].toLowerCase() as "table" | "function", name: match[3].toLowerCase() });
  }
  for (const match of sql.matchAll(RENAME)) {
    if (inPublic(match[2])) found.push({ at: match.index, kind: "rename", object: match[1].toLowerCase() as "table" | "function", name: match[3].toLowerCase(), to: match[4].toLowerCase() });
  }
  return found.sort((a, b) => a.at - b.at);
}

/**
 * The tables and functions a run of migrations leaves in the public schema: everything they create,
 * minus what a later statement drops, following renames. Read from the files, so the list can't
 * fall out of step with them.
 */
export function sentinelObjects(sqlInOrder: string[]): ObjectNames {
  const live = { table: new Set<string>(), function: new Set<string>() };
  for (const sql of sqlInOrder) {
    for (const statement of statements(sql)) {
      const set = live[statement.object];
      if (statement.kind === "create") set.add(statement.name);
      else if (statement.kind === "drop") set.delete(statement.name);
      else if (set.delete(statement.name) && statement.to) set.add(statement.to);
    }
  }
  live.table.delete(LEDGER_TABLE);
  return { tables: [...live.table].sort(), functions: [...live.function].sort() };
}

/** What one migration creates with a plain `create` (no `or replace`, no `if not exists`): it fails if any of it is already there. */
export function plainCreates(sql: string): ObjectNames {
  const made = statements(sql).filter((statement) => statement.kind === "create" && statement.plain && statement.name !== LEDGER_TABLE);
  const names = (object: "table" | "function") => [...new Set(made.filter((statement) => statement.object === object).map((statement) => statement.name))].sort();
  return { tables: names("table"), functions: names("function") };
}

// MARK: Read-only queries (the only SQL a dry run may send)

export const OBJECTS_SQL = [
  "select 'table' as kind, c.relname::text as name from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p')",
  "union all",
  "select distinct 'function' as kind, p.proname::text as name from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'",
].join(" ");
export const LEDGER_ROWS_SQL = "select version, name, sha256, applied_at::text as applied_at from public.install_migrations order by version";
export const USER_BY_EMAIL_SQL = "select id, email::text as email from auth.users where lower(email) = lower($1) limit 1";
export const INSTALL_OWNER_SQL = "select i.owner_user_id, (select u.email::text from auth.users u where u.id = i.owner_user_id) as email from public.install i where i.id";
export const OTHER_USERS_SQL = "select u.id, u.email::text as email, false as member from auth.users u where u.id <> $1::uuid order by u.created_at";
export const OTHER_USERS_WITH_MEMBERS_SQL = "select u.id, u.email::text as email, exists (select 1 from public.install_members m where m.user_id = u.id) as member from auth.users u where u.id <> $1::uuid order by u.created_at";
const READ_QUERIES = new Set([OBJECTS_SQL, LEDGER_ROWS_SQL, USER_BY_EMAIL_SQL, INSTALL_OWNER_SQL, OTHER_USERS_SQL, OTHER_USERS_WITH_MEMBERS_SQL]);

/**
 * `fetch` for a dry run: GET requests pass, and so does a database query that is, word for word, one
 * of the read-only queries above. Anything else is stopped before it leaves this computer.
 */
export function readOnlyFetch(fetch: FetchLike): FetchLike {
  return async (input, init = {}) => {
    const method = (init.method ?? "GET").toUpperCase();
    if (method === "GET") return fetch(input, init);
    const path = new URL(input).pathname;
    if (method === "POST" && path.endsWith("/database/query") && typeof init.body === "string") {
      let query: unknown = null;
      try { query = (JSON.parse(init.body) as { query?: unknown }).query; } catch { query = null; }
      if (typeof query === "string" && READ_QUERIES.has(query)) return fetch(input, init);
    }
    throw new ProvisionError("dry_run_write", "The dry run was about to change something, so it stopped. Nothing was changed.", { detail: `${method} ${path}` });
  };
}

// MARK: Adopt

export interface AdoptInput {
  /** A Supabase access token. Used for this run only; never stored, logged or returned. */
  accessToken: string;
  ref: string;
  /** Read everything, write nothing, and report what each step would do. */
  dryRun?: boolean;
  /** An existing account that becomes the owner. Never created here, and its password is never touched. */
  ownerEmail?: string;
  /** `all`: every other existing account becomes a member. */
  members?: "all";
  /** Go on although some accounts will lose access once the install has an owner. */
  yes?: boolean;
  setFunctionUrls?: boolean;
  scheduleJobs?: boolean;
  /** Copy the Style Library images to the `app-assets` bucket. Default true (with an owner). */
  assets?: boolean;
  deployFunctions?: boolean;
  functions?: readonly string[];
  writeConfig?: boolean;
}

export interface AccountRef { id: string; email: string | null }

export interface AdoptResult {
  ok: boolean;
  dryRun: boolean;
  completed: AdoptStepId[];
  failed?: { step: AdoptStepId; code: string; message: string; detail?: string };
  project?: ProjectSummary;
  /** What the migrations create that this database doesn't have (only when the check fails). */
  missing?: ObjectNames;
  /** Migrations written to the ledger as already applied, without running them. */
  recorded: string[];
  /** Newer migrations that were run (a dry run: that would be run). */
  applied: string[];
  owner?: { userId: string; email: string; already: boolean };
  /** Accounts that are not members: they lose access once the install has an owner. */
  losingAccess: AccountRef[];
  membersAdded: number;
  /** What was written as the install's AI provider so that it stays as it was. */
  aiProvider?: "typesafe" | "default" | "unknown";
  /** True when no owner was set: keys from edge function secrets, allow-lists, as before. */
  oldMode: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const maskEmail = (email: string): string => email.replace(/^(.).*(@.*)$/, "$1***$2");
const few = (names: string[], limit = 12): string => (names.length > limit ? `${names.slice(0, limit).join(", ")} and ${names.length - limit} more` : names.join(", "));

interface LedgerEntry { version: string; name: string; sha256: string; applied_at: string | null }

/**
 * True when the ledger's rows for the baseline are the ones adoption writes: all of them, with one
 * shared time (they go in as a single statement). A ledger filled by a normal run has a different
 * time on every row, because each migration is its own transaction.
 */
export function isAdoptedLedger(rows: LedgerEntry[], baseline: MigrationFile[]): boolean {
  const byVersion = new Map(rows.map((row) => [row.version, row]));
  if (!baseline.length || !baseline.every((migration) => byVersion.has(migration.version))) return false;
  return new Set(baseline.map((migration) => byVersion.get(migration.version)?.applied_at ?? "")).size === 1;
}

async function existingObjects(api: ReturnType<typeof managementApi>, ref: string): Promise<{ table: Set<string>; function: Set<string> }> {
  const rows = await api.query<{ kind: string; name: string }>(ref, OBJECTS_SQL);
  return {
    table: new Set(rows.filter((row) => row.kind === "table").map((row) => row.name)),
    function: new Set(rows.filter((row) => row.kind === "function").map((row) => row.name)),
  };
}

export async function adopt(input: AdoptInput, deps: ProvisionDeps, onEvent: AdoptEmit = () => {}): Promise<AdoptResult> {
  const dryRun = input.dryRun === true;
  const secrets: (string | undefined)[] = [input.accessToken];
  const emit: AdoptEmit = (event) => onEvent({ ...event, message: redact(event.message, secrets), ...(event.detail ? { detail: redact(event.detail, secrets) } : {}) });
  // The shared steps report under their own names, which are all adoption steps too.
  const shared = (event: ProgressEvent) => emit({ step: event.step as StepId & AdoptStepId, status: event.status, message: event.message, detail: event.detail });
  const completed: AdoptStepId[] = [];
  const result: AdoptResult = { ok: false, dryRun, completed, recorded: [], applied: [], losingAccess: [], membersAdded: 0, oldMode: true };
  const fail = (step: AdoptStepId, error: unknown): AdoptResult => {
    const known = error instanceof ProvisionError;
    const message = redact(known ? error.message : "Something unexpected went wrong. Nothing else was changed.", secrets);
    const detail = redact(known ? error.detail ?? "" : error instanceof Error ? error.message : String(error), secrets) || undefined;
    emit({ step, status: "failed", message, detail });
    return { ...result, failed: { step, code: known ? error.code : "unexpected", message, detail } };
  };
  /** A change: made on a real run, only described on a dry run. */
  const change = async (step: AdoptStepId, what: string, run: () => Promise<void>): Promise<void> => {
    if (dryRun) emit({ step, status: "planned", message: `Would ${what}.` });
    else await run();
  };

  if (!input.accessToken?.trim()) return fail("project", new ProvisionError("no_token", "Set SUPABASE_ACCESS_TOKEN to a Supabase access token."));
  if (!isProjectRef(input.ref)) return fail("project", new ProvisionError("bad_ref", "Say which project to adopt: --project <ref>, the 20 letters in its dashboard address."));
  const ownerEmail = input.ownerEmail?.trim().toLowerCase();
  if (ownerEmail !== undefined && !isEmail(ownerEmail)) return fail("owner", new ProvisionError("bad_email", "--owner-email doesn't look like an email address."));
  const ref = input.ref;
  const fetch = dryRun ? readOnlyFetch(deps.fetch) : deps.fetch;
  const api = managementApi(fetch, input.accessToken.trim(), deps.managementBase);
  const files: RepoFiles = deps.files;

  let step: AdoptStepId = "project";
  try {
    // 1. The project.
    emit({ step, status: "running", message: "Looking for the project." });
    const project = (await listProjects(api)).find((candidate) => candidate.ref === ref);
    if (!project) throw new ProvisionError("no_project", "This access token can't see that project. Use a token from the Supabase account that owns it.");
    const problem = projectProblem(project);
    if (problem) throw new ProvisionError("not_ready", problem, { detail: `status ${project.status}` });
    result.project = project;
    emit({ step, status: "done", message: `Found "${project.name}".`, detail: `${ref} · ${project.region}` });
    completed.push(step);

    // 2. Is it this app's database? Everything the baseline migrations create must be there.
    step = "check";
    const all = await listMigrations(files);
    const baseline = all.filter((migration) => migration.version <= ADOPT_BASELINE_VERSION);
    const newer = all.filter((migration) => migration.version > ADOPT_BASELINE_VERSION);
    if (!baseline.some((migration) => migration.version === ADOPT_BASELINE_VERSION)) {
      throw new ProvisionError("no_baseline", "This folder doesn't have the migrations an existing install was built from. Use a complete copy of the app.", { detail: `no migration with version ${ADOPT_BASELINE_VERSION} in supabase/migrations` });
    }
    const sql = new Map<string, string>();
    for (const migration of all) sql.set(migration.version, await files.readText(migration.path));
    const expected = sentinelObjects(baseline.map((migration) => sql.get(migration.version) as string));
    emit({ step, status: "running", message: `Comparing the database with what ${baseline.length} migrations create.` });
    const existing = await existingObjects(api, ref);
    const missing: ObjectNames = {
      tables: expected.tables.filter((name) => !existing.table.has(name)),
      functions: expected.functions.filter((name) => !existing.function.has(name)),
    };
    if (missing.tables.length || missing.functions.length) {
      result.missing = missing;
      throw new ProvisionError("not_this_app", "This database is not a complete copy of this app's database, so it was left alone. Nothing was changed.", {
        detail: [
          missing.tables.length ? `missing tables (${missing.tables.length} of ${expected.tables.length}): ${few(missing.tables)}` : "",
          missing.functions.length ? `missing functions (${missing.functions.length} of ${expected.functions.length}): ${few(missing.functions)}` : "",
        ].filter(Boolean).join("; "),
      });
    }
    const ledger = existing.table.has(LEDGER_TABLE) ? await api.query<LedgerEntry>(ref, LEDGER_ROWS_SQL) : [];
    const recordedAlready = ledger.length > 0;
    if (recordedAlready && !isAdoptedLedger(ledger, baseline)) {
      throw new ProvisionError("ledger_has_rows", "This project already keeps a ledger of its migrations, so there is nothing to adopt. Use the normal run (without --adopt) to update it.", { detail: `public.install_migrations has ${ledger.length} row(s) that adoption didn't write` });
    }
    const inLedger = new Set(ledger.map((row) => row.version));
    const pending = newer.filter((migration) => !inLedger.has(migration.version));
    // A newer migration whose plain `create`s already exist was run by hand: running it again would fail.
    const clashes = pending.flatMap((migration) => {
      const made = plainCreates(sql.get(migration.version) as string);
      const there = [...made.tables.filter((name) => existing.table.has(name)), ...made.functions.filter((name) => existing.function.has(name))];
      return there.length ? [`${migration.file}: ${few(there)}`] : [];
    });
    if (clashes.length) {
      throw new ProvisionError("applied_by_hand", "A newer migration looks as if it was already run by hand: what it creates is already in the database. Nothing was changed. Record that migration in public.install_migrations yourself, or remove what it created, then run this again.", { detail: clashes.join("; ") });
    }
    emit({ step, status: "done", message: `It is this app's database: all ${expected.tables.length} tables and ${expected.functions.length} functions are there.` });
    completed.push(step);

    // 3. The ledger: record the baseline as applied. Nothing is run.
    step = "ledger";
    if (recordedAlready) {
      emit({ step, status: "skipped", message: `The ${baseline.length} existing migrations were already recorded by an earlier adoption.` });
    } else {
      const rows: string[] = [];
      for (const migration of baseline) rows.push(`(${sqlLiteral(migration.version)}, ${sqlLiteral(migration.name)}, ${sqlLiteral(await sha256Hex(sql.get(migration.version) as string))})`);
      await change(step, `create public.install_migrations and record ${baseline.length} migrations as already applied, up to ${baseline[baseline.length - 1].file} (recorded, not run)`, async () => {
        await api.query(ref, `${LEDGER_SQL}\ninsert into public.install_migrations (version, name, sha256) values\n${rows.join(",\n")};`);
        emit({ step, status: "done", message: `Recorded ${baseline.length} migrations as already applied. They were recorded, not run.`, detail: `${baseline[0].file} to ${baseline[baseline.length - 1].file}` });
      });
      result.recorded = baseline.map((migration) => migration.file);
    }
    completed.push(step);

    // 4. Newer migrations run the normal way.
    step = "migrations";
    result.applied = pending.map((migration) => migration.file);
    if (dryRun) {
      emit({ step, status: "planned", message: pending.length ? `Would apply ${pending.length} newer ${pending.length === 1 ? "migration" : "migrations"}: ${pending.map((migration) => migration.file).join(", ")}.` : "No newer migration to apply." });
    } else {
      result.applied = (await applyMigrations(api, files, ref, shared)).applied;
    }
    completed.push(step);

    // 5 and 6. Only when asked for.
    step = "function-urls";
    if (!input.setFunctionUrls) emit({ step, status: "skipped", message: "The stored function addresses were left as they are (pass --set-function-urls to rewrite them)." });
    else await change(step, `store https://${ref}.supabase.co/functions/v1 as the address of every function`, () => setFunctionUrls(api, ref, shared));
    completed.push(step);

    step = "functions";
    const functionNames = input.functions ?? FUNCTION_NAMES;
    if (!input.deployFunctions) emit({ step, status: "skipped", message: "No function was deployed (pass --deploy-functions to deploy them)." });
    else await change(step, `deploy ${functionNames.length} edge functions with the JWT check off: ${functionNames.join(", ")}`, async () => { await deployFunctions(api, files, ref, shared, functionNames); });
    completed.push(step);

    // 7. The owner. An existing account, never a new one.
    step = "owner";
    const installTables = existing.table.has("install") || (!dryRun && completed.includes("migrations"));
    if (!ownerEmail) {
      emit({ step, status: "skipped", message: "No owner was named, so the install stays in its old mode: keys from edge function secrets, every signed-in account let in, Launch and Measure by their email allow-lists. Run again with --owner-email to give it an owner." });
    } else {
      const [user] = await api.query<AccountRef>(ref, USER_BY_EMAIL_SQL, [ownerEmail]);
      if (!user || !UUID.test(user.id)) throw new ProvisionError("no_user", `No account with the email ${ownerEmail} exists in this project. Adoption never creates an account: use the email of someone who already signs in.`);
      const [install] = installTables ? await api.query<{ owner_user_id: string | null; email: string | null }>(ref, INSTALL_OWNER_SQL) : [];
      if (install?.owner_user_id && install.owner_user_id !== user.id) {
        throw new ProvisionError("owner_exists", `This install already has a different owner (${maskEmail(install.email ?? "another account")}). Nothing was changed.`);
      }
      const already = install?.owner_user_id === user.id;
      const others = await api.query<AccountRef & { member: boolean }>(ref, installTables ? OTHER_USERS_WITH_MEMBERS_SQL : OTHER_USERS_SQL, [user.id]);
      const outside = others.filter((account) => !account.member).map(({ id, email }) => ({ id, email }));
      const addAll = input.members === "all";
      result.losingAccess = addAll ? [] : outside;
      if (!already && outside.length && !addAll && !input.yes) {
        throw new ProvisionError("confirm_members", `${outside.length} other ${outside.length === 1 ? "account" : "accounts"} can use this install today and would lose access once it has an owner. Nothing about access was changed. Run again with --members all to keep them as members, or with --yes to go on without them.`, { detail: outside.map((account) => account.email ?? account.id).join(", ") });
      }
      const secretNames = already ? null : await api.listSecretNames(ref).catch(() => null);
      const aiProvider: AdoptResult["aiProvider"] = already ? undefined : secretNames === null ? "unknown" : secretNames.includes("TYPESAFE_API_KEY") ? "typesafe" : "default";
      result.aiProvider = aiProvider;
      // The functions treat an install with a row differently from one without. These settings keep
      // what it does today: the limits the code always used, and TypeSafe where its key is set.
      const settings = JSON.stringify({ limits: LEGACY_LIMITS, ...(aiProvider === "typesafe" ? { aiProvider: "typesafe" } : {}) });
      const what = [
        already ? `keep ${ownerEmail} as the owner` : `make ${ownerEmail} the owner (existing account; no password change)`,
        already ? "" : `write the install's settings so nothing changes: limits ${LEGACY_LIMITS.wallClockSec} s / ${LEGACY_LIMITS.uploadLimitMb} MB / ${LEGACY_LIMITS.storageQuotaGb} GB${aiProvider === "typesafe" ? ", AI provider TypeSafe" : aiProvider === "unknown" ? "; the AI provider could NOT be read from the edge function secrets, so it would become OpenAI" : ", AI provider left at the default (no TypeSafe key among the edge function secrets)"}`,
        addAll && outside.length ? `add ${outside.length} other ${outside.length === 1 ? "account as a member" : "accounts as members"}` : "",
        !addAll && outside.length ? `leave ${outside.length} ${outside.length === 1 ? "account" : "accounts"} without access: ${few(outside.map((account) => account.email ?? account.id))}` : "",
      ].filter(Boolean).join("; ");
      await change(step, what, async () => {
        await api.query(ref, [
          `insert into public.install (id, owner_user_id, settings) values (true, ${sqlLiteral(user.id)}::uuid, ${sqlLiteral(settings)}::jsonb)`,
          "on conflict (id) do update set owner_user_id = coalesce(public.install.owner_user_id, excluded.owner_user_id), settings = excluded.settings || public.install.settings;",
          `insert into public.install_members (user_id, role) values (${sqlLiteral(user.id)}::uuid, 'owner')`,
          "on conflict (user_id) do update set role = 'owner';",
          ...(addAll ? [`insert into public.install_members (user_id, role) select u.id, 'member' from auth.users u where u.id <> ${sqlLiteral(user.id)}::uuid on conflict (user_id) do nothing;`] : []),
        ].join("\n"));
        emit({
          step, status: "done",
          message: `${already ? `${ownerEmail} was already the owner.` : `${ownerEmail} is now the owner.`}${addAll && outside.length ? ` ${outside.length} other ${outside.length === 1 ? "account was added as a member" : "accounts were added as members"}.` : outside.length ? ` ${outside.length} other ${outside.length === 1 ? "account is" : "accounts are"} not members and can no longer use the install.` : ""}${aiProvider === "unknown" ? " The AI provider could not be read from the edge function secrets: check Settings > AI models." : ""}`,
          detail: !addAll && outside.length ? `not members: ${outside.map((account) => account.email ?? account.id).join(", ")}` : undefined,
        });
      });
      result.owner = { userId: user.id, email: ownerEmail, already };
      result.membersAdded = addAll ? outside.length : 0;
      result.oldMode = false;
    }
    completed.push(step);

    // 8. Style Library images: allowed, repeatable, and only alongside an owner.
    step = "storage";
    const wantsAssets = input.assets !== false && Boolean(ownerEmail);
    if (!wantsAssets) {
      emit({ step, status: "skipped", message: input.assets === false ? "The Style Library images were not copied (--no-assets)." : "The Style Library images were not copied: that happens together with setting an owner." });
    } else {
      const count = (await listAdStyleAssets(files)).length;
      await change(step, `make sure the public ${ASSETS_BUCKET} bucket exists and copy ${count} Style Library images into it (the upload limit is not touched)`, async () => {
        let keys;
        try { keys = await readKeys(api, ref, { create: false }); } catch (error) {
          if (!(error instanceof ProvisionError) || error.code !== "no_keys") throw error;
          emit({ step, status: "skipped", message: "The Style Library images were not copied: the project's secret key couldn't be read, and adoption doesn't create one.", detail: error.detail });
          return;
        }
        secrets.push(keys.secretKey);
        const uploaded = await copyStyleAssets(api, projectApi(deps.fetch, ref, keys.secretKey, deps.projectBase?.(ref)), files, ref, shared);
        emit({ step, status: "done", message: `Copied ${uploaded} Style Library images. The upload limit was not touched.` });
      });
    }
    completed.push(step);

    // 9 and 10. Only when asked for.
    step = "jobs";
    if (!input.scheduleJobs) emit({ step, status: "skipped", message: "The optional scheduled jobs were not turned on (pass --schedule-jobs to turn them on)." });
    else if (!ownerEmail) emit({ step, status: "skipped", message: "The optional scheduled jobs wait for an owner: pass --owner-email as well." });
    else await change(step, "turn on the optional scheduled jobs (measure-sync every 6 hours, launch-daily)", async () => { await scheduleJobs(api, ref, shared); });
    completed.push(step);

    step = "config";
    if (!input.writeConfig) emit({ step, status: "skipped", message: "The local config file was not written (pass --write-config to write it)." });
    else if (!deps.writeConfig) emit({ step, status: "skipped", message: "The local config file can't be written from here." });
    else {
      await change(step, `write the local config file for ${projectUrl(ref)}`, async () => {
        const { publishableKey } = await readKeys(api, ref, { create: false });
        const { plan } = await detectPlan(api, project);
        const config: LocalConfig = { supabaseUrl: projectUrl(ref), publishableKey, publicOrigin: null, imageTransforms: plan === "paid" };
        await deps.writeConfig?.(config);
        emit({ step, status: "done", message: "Saved the connection on this computer." });
      });
    }
    completed.push(step);
  } catch (error) {
    return fail(step, error);
  }
  return { ...result, ok: true };
}
