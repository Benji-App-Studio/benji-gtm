// A small Graph API client for the Marketing API, with the guard rails Launch depends on:
//   • every campaign, ad set and ad it creates is PAUSED (a write that would make one ACTIVE throws),
//   • it never deletes anything,
//   • the transport is injectable, so tests and LAUNCH_META_MOCK run against a fake Meta.
// Graph API v26.0 is current (released 2026-07-29; v25.0 stays supported until 2028).

export const GRAPH_VERSION = "v26.0";
export const GRAPH_HOST = "https://graph.facebook.com";

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
export type Params = Record<string, unknown>;

/** An error from Meta, with its code and the message written for the person using the app. */
export class GraphError extends Error {
  constructor(
    readonly status: number,
    readonly code: number | undefined,
    readonly subcode: number | undefined,
    message: string,
    readonly userTitle?: string,
    readonly fbtraceId?: string,
  ) {
    super(message);
  }
  /** Rate limits and transient failures: worth trying again later. */
  get transient(): boolean {
    return this.status >= 500 || [1, 2, 4, 17, 32, 341, 613, 80000, 80003, 80004].includes(this.code ?? -1);
  }
}

/** A write Launch refuses to send (it would publish or delete something). */
export class UnsafeWriteError extends Error {}

const CREATE_EDGES = /\/(campaigns|adsets|ads)$/;
const ALLOWED_STATUS = new Set(["PAUSED"]);

/** Throws unless the write keeps everything paused. Exported for tests. */
export function assertSafeWrite(path: string, params: Params) {
  for (const key of ["status", "configured_status", "status_option"]) {
    const value = params[key];
    if (value !== undefined && !ALLOWED_STATUS.has(String(value))) {
      throw new UnsafeWriteError(`Launch only creates paused drafts (${key}=${String(value)} refused on ${path}).`);
    }
  }
  if (CREATE_EDGES.test(path) && params.status !== "PAUSED") {
    throw new UnsafeWriteError(`Creating on ${path} needs status=PAUSED.`);
  }
  if (/\/copies$/.test(path) && params.status_option !== "PAUSED") {
    throw new UnsafeWriteError("Copies must be made with status_option=PAUSED.");
  }
}

export class Graph {
  private proof: Promise<string | null> | null = null;

  constructor(
    private readonly token: string,
    private readonly transport: Fetch = fetch,
    readonly version = GRAPH_VERSION,
    /** The Meta app's secret, when the app requires appsecret_proof on server calls (recommended). */
    private readonly appSecret?: string,
  ) {}

  /** HMAC-SHA256 of the token keyed by the app secret, hex. */
  private appSecretProof(): Promise<string | null> {
    if (!this.appSecret) return Promise.resolve(null);
    this.proof ??= (async () => {
      const enc = new TextEncoder();
      const key = await crypto.subtle.importKey("raw", enc.encode(this.appSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(this.token)));
      return [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
    })();
    return this.proof;
  }

  private url(path: string) {
    return `${GRAPH_HOST}/${this.version}/${path.replace(/^\/+/, "")}`;
  }

  async get<T = Record<string, unknown>>(path: string, params: Params = {}): Promise<T> {
    const query = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined) query.set(k, typeof v === "string" ? v : JSON.stringify(v));
    const proof = await this.appSecretProof();
    if (proof) query.set("appsecret_proof", proof);
    const qs = query.toString();
    return this.send<T>("GET", `${this.url(path)}${qs ? `?${qs}` : ""}`);
  }

  async post<T = Record<string, unknown>>(path: string, params: Params): Promise<T> {
    assertSafeWrite(path, params);
    const form = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined) form.set(k, typeof v === "string" ? v : JSON.stringify(v));
    const proof = await this.appSecretProof();
    if (proof) form.set("appsecret_proof", proof);
    return this.send<T>("POST", this.url(path), form);
  }

  private async send<T>(method: "GET" | "POST", url: string, body?: URLSearchParams): Promise<T> {
    const response = await this.transport(url, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
      body,
      signal: AbortSignal.timeout(60_000),
    });
    const text = await response.text();
    let data: Record<string, unknown> = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
    const error = data.error as Record<string, unknown> | undefined;
    if (!response.ok || error) {
      throw new GraphError(
        response.status,
        error?.code as number | undefined,
        error?.error_subcode as number | undefined,
        String(error?.error_user_msg ?? error?.message ?? `Meta answered ${response.status}.`).slice(0, 500),
        error?.error_user_title as string | undefined,
        error?.fbtrace_id as string | undefined,
      );
    }
    return data as T;
  }
}

/** act_123 from 123 or act_123. */
export const act = (adAccountId: string) => (adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`);

/** Links that open a Meta object in Ads Manager. */
export function adsManagerUrl(adAccountId: string, level: "campaigns" | "adsets" | "ads", ids: string[]) {
  const account = adAccountId.replace(/^act_/, "");
  const key = level === "campaigns" ? "selected_campaign_ids" : level === "adsets" ? "selected_adset_ids" : "selected_ad_ids";
  return `https://adsmanager.facebook.com/adsmanager/manage/${level}?act=${account}&${key}=${ids.join(",")}`;
}
