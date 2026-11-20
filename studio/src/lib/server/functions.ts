import "server-only";
// The studio holds no API keys: everything that needs one runs in a Supabase edge function. API
// routes call the function as the signed-in user, through this one helper.
import { translateServerMessage } from "@/lib/i18n/server-messages";
import { getLocale, getTranslator } from "@/lib/i18n/server";
import { getInstallConfig } from "@/lib/install/config";
import type { Session } from "./auth";

/** The header that tells a function the page's language, so AI-written text comes back in it (supabase/functions/_shared/language.ts). */
export const LOCALE_HEADER = "x-ui-locale";

/** The page's language, or null outside a request (a background task has no cookies to read). */
async function requestLocale(): Promise<string | null> {
  try { return await getLocale(); } catch { return null; }
}

export type FunctionName = "radar" | "research" | "creatives" | "launch" | "metrics" | "insight" | "install";

export interface FunctionResult<T> { ok: boolean; status: number; data: T & { error?: string } }

export interface CallOptions {
  /** Sent as JSON. With no body the call is a GET, unless `method` says otherwise. */
  body?: unknown;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  timeoutMs?: number;
  /** What to tell the person when the function can't be reached, isn't deployed, or answers without JSON. */
  messages?: { unreachable?: string; notDeployed?: string; badAnswer?: (status: number) => string };
}

/** The function's address. FUNCTION_URL_<NAME> (e.g. a locally served function while developing) wins. */
export function functionUrl(name: FunctionName): string | null {
  const env = process.env;
  const override = env[`${name.toUpperCase()}_FUNCTION_URL`];
  if (override) return override.replace(/\/+$/, "");
  const config = getInstallConfig();
  return config ? `${config.supabaseUrl}/functions/v1/${name}` : null;
}

export async function callFunction<T = Record<string, unknown>>(name: FunctionName, session: Session | null, route: string, options: CallOptions = {}): Promise<FunctionResult<T>> {
  const config = getInstallConfig();
  const base = functionUrl(name);
  const fail = (status: number, error: string): FunctionResult<T> => ({ ok: false, status, data: { error } as T & { error: string } });
  if (!config || !base) return fail(503, "This install isn't set up yet. Open /setup to connect a Supabase project.");
  const token = session ? (await session.supabase.auth.getSession()).data.session?.access_token : undefined;
  const messages = options.messages ?? {};
  const locale = await requestLocale();
  try {
    const response = await fetch(`${base}/${route}`, {
      method: options.method ?? (options.body === undefined ? "GET" : "POST"),
      headers: {
        "Content-Type": "application/json",
        apikey: config.publishableKey,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(locale ? { [LOCALE_HEADER]: locale } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: "no-store",
      signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
    });
    const data = await response.json().catch(() => ({
      error: response.status === 404 && messages.notDeployed
        ? messages.notDeployed
        : messages.badAnswer?.(response.status) ?? `The backend answered ${response.status}. Try again in a moment.`,
    }));
    return { ok: response.ok, status: response.status, data };
  } catch {
    return fail(502, messages.unreachable ?? "Couldn't reach the backend. Try again in a moment.");
  }
}

/**
 * Passes the edge function's answer (or its error) back to the page, with a known English `error` in the
 * page's language (lib/i18n/server-messages.ts). Everything else is passed through unchanged.
 */
export async function relay<T>(result: FunctionResult<T>): Promise<Response> {
  const data = result.data as (T & { error?: unknown }) | null;
  const error = data && typeof data === "object" && typeof data.error === "string" ? data.error : null;
  if (!error) return Response.json(result.data, { status: result.ok ? 200 : result.status });
  const tr = await getTranslator().catch(() => null);
  const shown = tr ? translateServerMessage(error, tr) : error;
  return Response.json(shown === error ? result.data : { ...data, error: shown }, { status: result.ok ? 200 : result.status });
}
