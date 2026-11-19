// Every Supabase endpoint that setup calls, in one file, so a wrong guess about the platform is fixed
// here and nowhere else. Two clients:
//   managementApi  api.supabase.com, signed with the person's access token (account-wide, short-lived use)
//   projectApi     the project's own Auth and Storage APIs, signed with the project's secret key
//
// Sources (checked 19 Nov 2026):
//   https://api.supabase.com/api/v1-json                       the Management API's OpenAPI document
//   https://supabase.com/docs/reference/api/v1-run-a-query      POST /v1/projects/{ref}/database/query (beta)
//   https://supabase.com/docs/reference/api/v1-deploy-a-function  POST /v1/projects/{ref}/functions/deploy
//   https://github.com/supabase/cli  apps/cli/src/shared/functions/deploy.ts  (what `--use-api` sends)
//   https://supabase.com/docs/guides/api/api-keys                publishable and secret keys go in `apikey`
import { ProvisionError, redact, type FetchLike } from "./types";

export const MANAGEMENT_API = "https://api.supabase.com";

/** 20 lower-case characters. Checked before a ref is ever put in an address. */
export const isProjectRef = (value: unknown): value is string => typeof value === "string" && /^[a-z0-9]{20}$/.test(value);

export const projectUrl = (ref: string): string => `https://${ref}.supabase.co`;
export const functionsBase = (ref: string): string => `${projectUrl(ref)}/functions/v1`;

// MARK: Shapes (only the fields setup reads)

export interface ApiProject {
  ref?: string;
  id?: string;
  name: string;
  region: string;
  status: string;
  organization_slug?: string;
  organization_id?: string;
}

export interface ApiOrganization { id: string; name: string; plan?: "free" | "pro" | "team" | "enterprise" | "platform" }

export interface ApiKey {
  name: string;
  type?: "legacy" | "publishable" | "secret" | null;
  api_key?: string | null;
}

export interface ApiAuthConfig { site_url?: string | null; uri_allow_list?: string | null; disable_signup?: boolean | null }

export interface ApiStorageConfig {
  fileSizeLimit?: number;
  features?: { imageTransformation?: { enabled: boolean } };
}

export interface DeployedFunction { id: string; slug: string; status: string; version: number }

export interface FunctionUpload {
  slug: string;
  /** Path of index.ts, in the same form as the uploaded file names. */
  entrypointPath: string;
  /** Path of the function's deno.json (its import map), or "" when it has none. */
  importMapPath: string;
  verifyJwt: boolean;
  files: { path: string; bytes: Uint8Array }[];
}

// MARK: Errors

/** Turns a failed call into a sentence a non-coder can act on; the raw answer goes in `detail`. */
function failure(what: string, status: number, body: string, secrets: string[]): ProvisionError {
  const detail = redact(`${what}: HTTP ${status} ${body.slice(0, 600)}`.trim(), secrets);
  const message =
    status === 401 ? "Supabase didn't accept the access token. Create a new token and paste it again."
    : status === 403 ? "This access token isn't allowed to do that. Use a token from the account that owns the project."
    : status === 402 ? "Your Supabase plan has reached a limit. Open your Supabase dashboard to see which one."
    : status === 404 ? "Supabase couldn't find that project. Check that you picked the right one."
    : status === 429 ? "Supabase asked us to slow down. Wait one minute, then press Retry."
    : status >= 500 ? "Supabase had a problem on its side. Wait a minute, then press Retry."
    : "Supabase refused a step. Press Retry. If it fails again, open the technical detail below.";
  return new ProvisionError(`http_${status}`, message, { detail, status });
}

const unreachable = (what: string, error: unknown, secrets: string[]) =>
  new ProvisionError("network", "Couldn't reach Supabase. Check your internet connection, then press Retry.", {
    detail: redact(`${what}: ${error instanceof Error ? error.message : String(error)}`, secrets),
  });

interface CallOptions {
  method?: string;
  query?: Record<string, string>;
  json?: unknown;
  body?: BodyInit;
  headers?: Record<string, string>;
  /** Statuses that count as success besides 2xx. */
  accept?: number[];
}

function caller(fetch: FetchLike, base: string, auth: Record<string, string>, secrets: string[]) {
  return async function call<T>(what: string, path: string, options: CallOptions = {}): Promise<{ status: number; data: T; text: string }> {
    const query = options.query ? `?${new URLSearchParams(options.query)}` : "";
    let response: Response;
    try {
      response = await fetch(`${base}${path}${query}`, {
        method: options.method ?? (options.json !== undefined || options.body !== undefined ? "POST" : "GET"),
        headers: { ...auth, ...(options.json !== undefined ? { "Content-Type": "application/json" } : {}), ...options.headers },
        body: options.json !== undefined ? JSON.stringify(options.json) : options.body,
        cache: "no-store",
      });
    } catch (error) {
      throw unreachable(what, error, secrets);
    }
    const text = await response.text().catch(() => "");
    if (!response.ok && !options.accept?.includes(response.status)) throw failure(what, response.status, text, secrets);
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    return { status: response.status, data: data as T, text };
  };
}

// MARK: Management API

export type ManagementApi = ReturnType<typeof managementApi>;

export function managementApi(fetch: FetchLike, accessToken: string, base: string = MANAGEMENT_API) {
  const call = caller(fetch, base, { Authorization: `Bearer ${accessToken}` }, [accessToken]);
  const needRef = (ref: string) => {
    if (!isProjectRef(ref)) throw new ProvisionError("bad_ref", "That doesn't look like a Supabase project. Pick the project from the list again.");
    return ref;
  };
  return {
    /** GET /v1/projects: every project the token's account can see. */
    async listProjects(): Promise<ApiProject[]> {
      const { data } = await call<ApiProject[]>("list projects", "/v1/projects");
      return Array.isArray(data) ? data : [];
    },

    /** GET /v1/organizations/{slug}: the plan, when the API includes it. */
    async getOrganization(slug: string): Promise<ApiOrganization | null> {
      const { status, data } = await call<ApiOrganization>("read organization", `/v1/organizations/${encodeURIComponent(slug)}`, { accept: [403, 404] });
      return status === 200 ? data : null;
    },

    /** GET /v1/projects/{ref}/api-keys?reveal=true: the keys with their values (secret keys included). */
    async apiKeys(ref: string): Promise<ApiKey[]> {
      const { data } = await call<ApiKey[]>("read API keys", `/v1/projects/${needRef(ref)}/api-keys`, { query: { reveal: "true" } });
      return Array.isArray(data) ? data : [];
    },

    /**
     * GET /v1/projects/{ref}/secrets: the names of the project's edge function secrets (the API answers
     * with a digest in place of each value). null when the token may not read them.
     */
    async listSecretNames(ref: string): Promise<string[] | null> {
      const { status, data } = await call<{ name?: string }[]>("list edge function secrets", `/v1/projects/${needRef(ref)}/secrets`, { accept: [403, 404] });
      return status === 200 && Array.isArray(data) ? data.flatMap((secret) => (typeof secret?.name === "string" ? [secret.name] : [])) : null;
    },

    /** POST /v1/projects/{ref}/api-keys?reveal=true: adds a publishable or a secret key. */
    async createApiKey(ref: string, input: { type: "publishable" | "secret"; name: string; secret_jwt_template?: Record<string, unknown> }): Promise<ApiKey | null> {
      const { status, data } = await call<ApiKey>("create API key", `/v1/projects/${needRef(ref)}/api-keys`, { query: { reveal: "true" }, json: input, accept: [400, 409] });
      return status < 300 ? data : null;
    },

    /**
     * POST /v1/projects/{ref}/database/query: runs SQL as the database owner and answers with the rows.
     * Without `parameters` the text may hold several statements; Postgres runs them as one transaction
     * (the migration step checks that this holds before it relies on it).
     */
    async query<T = Record<string, unknown>>(ref: string, sql: string, parameters?: unknown[]): Promise<T[]> {
      const { data } = await call<T[]>("run SQL", `/v1/projects/${needRef(ref)}/database/query`, { json: parameters ? { query: sql, parameters } : { query: sql } });
      return Array.isArray(data) ? data : [];
    },

    /**
     * POST /v1/projects/{ref}/functions/deploy?slug=<name>: multipart form, the contract the Supabase
     * CLI uses for `functions deploy --use-api`. One `metadata` part (JSON) and one `file` part per
     * source file, each named by its path; relative imports resolve between those paths, and the
     * platform bundles them. Creates the function, or replaces it.
     */
    async deployFunction(ref: string, upload: FunctionUpload): Promise<DeployedFunction> {
      const form = new FormData();
      form.append("metadata", JSON.stringify({
        name: upload.slug,
        verify_jwt: upload.verifyJwt,
        entrypoint_path: upload.entrypointPath,
        import_map_path: upload.importMapPath,
        static_patterns: [],
      }));
      for (const file of upload.files) form.append("file", new File([file.bytes as BlobPart], file.path));
      const { data } = await call<DeployedFunction>(`deploy function ${upload.slug}`, `/v1/projects/${needRef(ref)}/functions/deploy`, { query: { slug: upload.slug }, body: form });
      return data;
    },

    /** GET /v1/projects/{ref}/config/auth */
    async getAuthConfig(ref: string): Promise<ApiAuthConfig> {
      const { data } = await call<ApiAuthConfig>("read sign-in settings", `/v1/projects/${needRef(ref)}/config/auth`);
      return data ?? {};
    },

    /** PATCH /v1/projects/{ref}/config/auth: `uri_allow_list` is one comma-separated string. */
    async updateAuthConfig(ref: string, patch: ApiAuthConfig): Promise<void> {
      await call("change sign-in settings", `/v1/projects/${needRef(ref)}/config/auth`, { method: "PATCH", json: patch });
    },

    /** GET /v1/projects/{ref}/config/storage: the upload limit (bytes) and whether images can be resized. */
    async getStorageConfig(ref: string): Promise<ApiStorageConfig> {
      const { data } = await call<ApiStorageConfig>("read storage settings", `/v1/projects/${needRef(ref)}/config/storage`);
      return data ?? {};
    },

    /** PATCH /v1/projects/{ref}/config/storage */
    async updateStorageConfig(ref: string, patch: { fileSizeLimit: number }): Promise<void> {
      await call("change storage settings", `/v1/projects/${needRef(ref)}/config/storage`, { method: "PATCH", json: patch });
    },
  };
}

// MARK: The project's own APIs (secret key)

export type ProjectApi = ReturnType<typeof projectApi>;

/**
 * New keys (`sb_secret_...`) are sent in `apikey` only; the older service_role key is a JWT and is
 * also sent as the bearer token.
 */
export const secretKeyHeaders = (secretKey: string): Record<string, string> =>
  secretKey.startsWith("sb_") ? { apikey: secretKey } : { apikey: secretKey, Authorization: `Bearer ${secretKey}` };

export function projectApi(fetch: FetchLike, ref: string, secretKey: string, base: string = projectUrl(ref)) {
  const call = caller(fetch, base, secretKeyHeaders(secretKey), [secretKey]);
  return {
    /**
     * POST /auth/v1/admin/users with `email_confirm: true`: creates a confirmed user, no email sent.
     * Answers null when the address is already registered.
     */
    async createUser(input: { email: string; password: string }): Promise<{ id: string } | null> {
      const { status, data, text } = await call<{ id?: string; user?: { id?: string }; error_code?: string; msg?: string }>(
        "create the owner account", "/auth/v1/admin/users",
        { json: { email: input.email, password: input.password, email_confirm: true }, accept: [400, 422] },
      );
      if (status < 300) {
        const id = data?.id ?? data?.user?.id;
        if (id) return { id };
        throw new ProvisionError("bad_answer", "Supabase created the account but didn't say which one. Press Retry.", { detail: redact(text.slice(0, 300), [secretKey, input.password]) });
      }
      const code = data?.error_code ?? "";
      const said = `${data?.msg ?? ""} ${text}`.toLowerCase();
      if (code === "email_exists" || code === "user_already_exists" || said.includes("already been registered") || said.includes("already registered")) return null;
      if (code === "weak_password" || said.includes("password")) throw new ProvisionError("weak_password", "Supabase didn't accept that password. Use at least 8 characters, with letters and numbers.", { detail: redact(text.slice(0, 300), [secretKey, input.password]) });
      if (code === "validation_failed" || said.includes("email")) throw new ProvisionError("bad_email", "Supabase didn't accept that email address. Check it for typos.", { detail: redact(text.slice(0, 300), [secretKey, input.password]) });
      throw failure("create the owner account", status, text, [secretKey, input.password]);
    },

    /** POST /storage/v1/object/{bucket}/{path} with `x-upsert: true`: writes the file, replacing an older copy. */
    async uploadObject(bucket: string, path: string, bytes: Uint8Array, contentType: string): Promise<void> {
      const safePath = path.split("/").map(encodeURIComponent).join("/");
      await call(`upload ${path}`, `/storage/v1/object/${encodeURIComponent(bucket)}/${safePath}`, {
        body: new Blob([bytes as BlobPart], { type: contentType }),
        headers: { "Content-Type": contentType, "x-upsert": "true", "cache-control": "max-age=31536000" },
      });
    },
  };
}
