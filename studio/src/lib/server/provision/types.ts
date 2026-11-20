// Shared shapes for provisioning a Supabase project (see index.ts for the overview).
// Plain TypeScript with relative imports only: the studio's API routes, scripts/provision.mjs and the
// tests all load these files.
import { m } from "../../i18n/translate";

/** `fetch`, injected so tests never touch the network. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Reads files of the downloaded folder. Paths are relative to its root, with forward slashes. */
export interface RepoFiles {
  /** File names (not paths) directly inside a folder, sorted; empty when the folder is missing. */
  list(dir: string): Promise<string[]>;
  exists(path: string): Promise<boolean>;
  readText(path: string): Promise<string>;
  readBytes(path: string): Promise<Uint8Array>;
}

export const STEP_IDS = ["project", "keys", "migrations", "function-urls", "functions", "owner", "storage", "jobs", "config"] as const;
export type StepId = (typeof STEP_IDS)[number];

/** What a step is called on the checklist. */
// Said with t() on the setup page (app/setup/parts.tsx).
export const STEP_LABELS: Record<StepId, string> = {
  project: m("Check the project is ready"),
  keys: m("Read the project's keys"),
  migrations: m("Create the database tables"),
  "function-urls": m("Point the database at its backend functions"),
  functions: m("Install the backend functions"),
  owner: m("Create your account and close sign-up"),
  storage: m("Copy the Style Library images"),
  jobs: m("Turn on the scheduled jobs"),
  config: m("Save the connection on this computer"),
};

/** The steps the checklist runs before the account exists, when it is created, and for a later update. */
export const PREPARE_STEPS: readonly StepId[] = ["project", "keys", "migrations", "function-urls", "functions", "storage"];
export const ACCOUNT_STEPS: readonly StepId[] = ["owner", "jobs", "config"];
export const UPDATE_STEPS: readonly StepId[] = ["project", "keys", "migrations", "function-urls", "functions", "storage", "jobs"];

export type StepStatus = "running" | "done" | "skipped" | "failed";

export interface ProgressEvent {
  step: StepId;
  status: StepStatus;
  /** One plain sentence for the person watching. */
  message: string;
  /** Technical detail (an API answer, a file name), folded away on the page. Never a secret. */
  detail?: string;
  progress?: { done: number; total: number };
}

export type Emit = (event: ProgressEvent) => void;

export type Plan = "free" | "paid";

export interface InstallLimits { wallClockSec: number; uploadLimitMb: number; storageQuotaGb: number }

export interface ProjectSummary {
  ref: string;
  name: string;
  region: string;
  status: string;
  organizationSlug: string;
}

export interface ProjectKeys {
  /** Safe for the browser; written to the local config. */
  publishableKey: string;
  /** Full access to the project. Kept in memory for the length of one run; never written or returned. */
  secretKey: string;
}

export interface LedgerRow { version: string; name: string; sha256: string }

/** A failure with a sentence the person can act on, and the technical detail kept apart. */
export class ProvisionError extends Error {
  readonly code: string;
  readonly detail?: string;
  readonly status?: number;
  constructor(code: string, message: string, options: { detail?: string; status?: number } = {}) {
    super(message);
    this.name = "ProvisionError";
    this.code = code;
    this.detail = options.detail;
    this.status = options.status;
  }
}

/** Removes secrets (the access token, a key, a password) from text before it is shown or returned. */
export function redact(text: string, secrets: (string | null | undefined)[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret && secret.length >= 6) out = out.split(secret).join("[hidden]");
  }
  return out;
}
