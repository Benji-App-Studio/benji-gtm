// Applies supabase/migrations to a project in file-name order. Each file runs in one transaction
// together with its row in public.install_migrations (the ledger), so a file is either fully applied
// and recorded, or not at all, and a second run applies only what is new.
import { functionsBase, projectUrl, type ManagementApi } from "./management-api";
import { ProvisionError, type Emit, type LedgerRow, type RepoFiles } from "./types";

export const MIGRATIONS_DIR = "supabase/migrations";

export interface MigrationFile {
  /** The 14-digit timestamp the file name starts with. */
  version: string;
  name: string;
  file: string;
  path: string;
}

const FILE_NAME = /^(\d{14})_([a-z0-9_]+)\.sql$/;

/** The migration files, oldest first. Anything that isn't `<14 digits>_<name>.sql` is ignored. */
export async function listMigrations(files: RepoFiles): Promise<MigrationFile[]> {
  const names = await files.list(MIGRATIONS_DIR);
  const found = names.flatMap((file) => {
    const match = FILE_NAME.exec(file);
    return match ? [{ version: match[1], name: match[2], file, path: `${MIGRATIONS_DIR}/${file}` }] : [];
  });
  if (!found.length) {
    throw new ProvisionError("no_migrations", "The supabase/migrations folder is missing from this download. Download the app again and keep the folder as it is.");
  }
  return found.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const PROJECT_HOST = /https:\/\/[a-z0-9]{15,30}\.supabase\.co/g;

/**
 * A few early migrations store the address of the project they were first written for (the cron jobs
 * call the functions there). The files are never edited; the address is swapped for the target
 * project's own while the SQL is in memory.
 */
export function retargetSql(sql: string, ref: string): string {
  return sql.replace(PROJECT_HOST, projectUrl(ref));
}

/** A value as a SQL string literal (standard_conforming_strings is on for every Supabase database). */
export const sqlLiteral = (value: string): string => `'${value.replace(/'/g, "''")}'`;

export const LEDGER_SQL = `
create table if not exists public.install_migrations (
  version text primary key,
  name text not null,
  sha256 text not null,
  applied_at timestamptz not null default now()
);
alter table public.install_migrations enable row level security;
`.trim();

/** The file's SQL and its ledger row as one piece of text: Postgres runs it as a single transaction. */
export function migrationSql(migration: MigrationFile, sql: string, sha256: string, ref: string): string {
  const body = retargetSql(sql, ref).trimEnd();
  const ledger = `insert into public.install_migrations (version, name, sha256) values (${sqlLiteral(migration.version)}, ${sqlLiteral(migration.name)}, ${sqlLiteral(sha256)});`;
  // The lone ";" ends the file's last statement even when the file stops without one, or on a comment.
  return `${body}\n;\n${ledger}\n`;
}

export interface ProjectInspection {
  /** `empty`: nothing in the public schema. `update`: the ledger is there, so setup ran before. */
  state: "empty" | "update";
  tables: number;
  applied: LedgerRow[];
}

/**
 * Looks at the project before anything is changed. A project whose public schema already has tables
 * but no ledger belongs to something else: setup refuses it.
 */
export async function inspect(api: ManagementApi, ref: string): Promise<ProjectInspection> {
  const [row] = await api.query<{ tables: number | string; ledger: boolean }>(ref,
    "select (select count(*) from pg_catalog.pg_tables where schemaname = 'public')::int as tables, to_regclass('public.install_migrations') is not null as ledger");
  const tables = Number(row?.tables ?? 0);
  if (!row?.ledger) {
    if (tables > 0) {
      throw new ProvisionError("has_data", "This project already has data. Create a new empty project in Supabase and pick that one instead.", { detail: `${tables} table(s) in the public schema and no install_migrations ledger` });
    }
    return { state: "empty", tables, applied: [] };
  }
  const applied = await api.query<LedgerRow>(ref, "select version, name, sha256 from public.install_migrations order by version");
  return { state: "update", tables, applied };
}

/**
 * Proves, on this project, that a failed piece of SQL leaves nothing behind: creates a table and then
 * divides by zero in the same text. If the table survives, statements are not grouped in a
 * transaction and applying migrations here would be unsafe.
 */
async function assertOneTransaction(api: ManagementApi, ref: string): Promise<void> {
  const probe = "install_transaction_probe";
  try { await api.query(ref, `create table public.${probe} (); select 1/0;`); } catch { /* the division fails on purpose */ }
  const [row] = await api.query<{ present: boolean }>(ref, `select to_regclass('public.${probe}') is not null as present`);
  if (!row?.present) return;
  await api.query(ref, `drop table if exists public.${probe}`);
  throw new ProvisionError("not_transactional", "Supabase didn't run the test step safely, so setup stopped before changing anything. Use the terminal setup in the guide instead.", { detail: "POST /database/query kept a table created before a failing statement: multi-statement SQL is not one transaction here" });
}

export interface MigrationResult { applied: string[]; skipped: number; changed: string[] }

/** Applies every migration the ledger doesn't list yet. Safe to run again after a failure. */
export async function applyMigrations(api: ManagementApi, files: RepoFiles, ref: string, emit: Emit): Promise<MigrationResult> {
  const all = await listMigrations(files);
  emit({ step: "migrations", status: "running", message: "Checking which database changes are needed." });
  await api.query(ref, LEDGER_SQL);
  const ledger = await api.query<LedgerRow>(ref, "select version, name, sha256 from public.install_migrations order by version");
  const done = new Map(ledger.map((row) => [row.version, row]));
  const known = new Set(all.map((m) => m.version));
  const newer = ledger.filter((row) => !known.has(row.version));
  if (newer.length) {
    emit({ step: "migrations", status: "running", message: "This project was set up by a newer version of the app. Download the latest version to stay in step.", detail: `In the ledger but not in this folder: ${newer.map((row) => row.version).join(", ")}` });
  }
  const pending = all.filter((m) => !done.has(m.version));
  const changed: string[] = [];
  for (const migration of all) {
    const row = done.get(migration.version);
    if (row && row.sha256 !== await sha256Hex(await files.readText(migration.path))) changed.push(migration.file);
  }
  if (changed.length) {
    emit({ step: "migrations", status: "running", message: "Some database files changed after they were applied. They were left as they are.", detail: changed.join(", ") });
  }
  if (!pending.length) {
    emit({ step: "migrations", status: "skipped", message: "The database is already up to date.", progress: { done: all.length, total: all.length } });
    return { applied: [], skipped: all.length, changed };
  }
  await assertOneTransaction(api, ref);
  const applied: string[] = [];
  for (const migration of pending) {
    const sql = await files.readText(migration.path);
    emit({ step: "migrations", status: "running", message: `Applying database change ${applied.length + 1} of ${pending.length}.`, detail: migration.file, progress: { done: applied.length, total: pending.length } });
    try {
      await api.query(ref, migrationSql(migration, sql, await sha256Hex(sql), ref));
    } catch (error) {
      if (error instanceof ProvisionError && error.status === 400) {
        throw new ProvisionError("migration_failed", "A database change didn't apply. Nothing from that change was kept. Press Retry; if it fails again, send us the technical detail below.", { detail: `${migration.file}: ${error.detail ?? error.message}`, status: 400 });
      }
      if (error instanceof ProvisionError) throw new ProvisionError(error.code, error.message, { detail: `${migration.file}: ${error.detail ?? ""}`, status: error.status });
      throw error;
    }
    applied.push(migration.file);
  }
  emit({ step: "migrations", status: "done", message: `Applied ${applied.length} database ${applied.length === 1 ? "change" : "changes"}.`, progress: { done: pending.length, total: pending.length } });
  return { applied, skipped: all.length - pending.length, changed };
}

/** Stores this project's own function addresses in its Vault, replacing whatever the migrations wrote. */
export async function setFunctionUrls(api: ManagementApi, ref: string, emit: Emit): Promise<void> {
  emit({ step: "function-urls", status: "running", message: "Saving where this project's backend functions live." });
  await api.query(ref, `select public.install_set_function_urls(${sqlLiteral(functionsBase(ref))});`);
  emit({ step: "function-urls", status: "done", message: "The scheduled jobs now call this project's own functions.", detail: functionsBase(ref) });
}
