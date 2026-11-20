// A database or storage error as a sentence a person can act on. The raw error (table names, SQL,
// constraint names) is for the server log only: routes log it and answer with this (lib/server/errors.ts).
// Pure: the tests load it. Pass a page's `t` to get the sentence in the viewer's language; without it the
// sentence is English (and a page can still say it with t(), since each is in the dictionaries).
import { fill, type Vars } from "./i18n/translate";

type Say = (text: string, vars?: Vars) => string;
const english: Say = (text, vars) => fill(text, vars, "en");

export interface DbErrorLike { code?: string | null; message?: string | null; details?: string | null; hint?: string | null; status?: number | string | null; statusCode?: number | string | null }

/** Errors that mean this copy's database is behind the code: a table, column or function is missing. */
const MISSING_SCHEMA = new Set(["42P01", "42703", "42883", "PGRST202", "PGRST204", "PGRST205"]);

/**
 * The plan guards of accounts mode (20261120130000_account_guards.sql) raise their own plain sentence,
 * told apart by DETAIL. Each one with the HTTP status a route answers with.
 */
const PLAN_LIMITS: Record<string, number> = { app_limit: 403, generation_limit: 403, open_jobs_limit: 429, runner_staff_only: 403, account_suspended: 403 };

/**
 * A plan guard's refusal: its kind, the sentence the database wrote, and the status to answer with. Null for
 * anything else. With a page's `t` the sentence is said in the viewer's language (the number comes from the
 * database's own sentence).
 */
export function planLimitError(error: unknown, t?: Say): { kind: string; message: string; status: number } | null {
  const e = (error && typeof error === "object" ? error : {}) as DbErrorLike;
  const kind = String(e.details ?? "");
  const message = String(e.message ?? "").trim();
  if (!(kind in PLAN_LIMITS) || !message) return null;
  return { kind, message: t ? planLimitText(kind, message, t) : message.slice(0, 300), status: PLAN_LIMITS[kind] };
}

/** The database's plan-guard sentence (20261120130000_account_guards.sql) in the viewer's language. */
function planLimitText(kind: string, raw: string, t: Say): string {
  const n = Number(raw.match(/\d+/)?.[0] ?? NaN);
  const has = Number.isFinite(n);
  if (kind === "account_suspended") return t("This account is suspended.");
  if (kind === "runner_staff_only") return t("The desktop runner isn't available on this account.");
  if (kind === "app_limit" && has) return t("Your plan allows {n} apps. Delete an app you no longer need to add another.", { n });
  if (kind === "open_jobs_limit" && has) return t("You have {n} generations waiting already. Let them finish (or cancel some), then try again.", { n });
  if (kind === "generation_limit" && has) return t("Your plan allows {n} generations a month, and this month's are used up.", { n });
  return raw.slice(0, 300);
}

/**
 * The plain sentence for a database error. `fallback` says what failed ("Couldn't save the competitor.");
 * a few well-known causes get their own sentence instead.
 */
export function plainDbMessage(error: unknown, fallback: string, t: Say = english): string {
  const e = (error && typeof error === "object" ? error : {}) as DbErrorLike;
  const code = String(e.code ?? "");
  const text = String(e.message ?? "");
  const limit = planLimitError(error, t === english ? undefined : t);
  if (limit) return limit.message;
  if (MISSING_SCHEMA.has(code) || /does not exist|could not find the (table|function|column)|schema cache/i.test(text)) {
    return t("The database is missing a recent update. Open /setup, paste an access token and press Apply the update.");
  }
  if (code === "23505" || /duplicate key/i.test(text)) return t("That already exists.");
  if (code === "23503" || /foreign key/i.test(text)) return t("Something this refers to was deleted. Reload the page and try again.");
  if (code === "42501" || /row-level security|permission denied/i.test(text)) return t("You don't have access to change that. Ask the owner of this install.");
  if (code === "PGRST116") return t("That wasn't found. Reload the page and try again.");
  if (code === "57014" || /statement timeout|canceling statement/i.test(text)) return t("The database took too long to answer. Try again in a moment.");
  if (/fetch failed|network|ECONNREFUSED|ENOTFOUND|timed? ?out/i.test(text)) return t("Couldn't reach your Supabase project. Check that it isn't paused, then try again.");
  return fallback;
}

/** Words only a raw database, storage or PostgREST error carries (table, column, constraint, policy names). */
const RAW = /duplicate key|violates|relation "|column "|syntax error|PGRST\d|JWT|row-level security|permission denied|schema cache|does not exist|null value in column|invalid input syntax|could not find the|function [a-z_.]+\(|fetch failed|ECONNREFUSED|ENOTFOUND|unexpected token|internal server error/i;

/**
 * A caught error as a sentence for the page: our own messages (already plain) pass through; anything
 * that reads like a raw database or network error becomes plainDbMessage's sentence, or `fallback`.
 */
export function plainError(error: unknown, fallback: string, t: Say = english): string {
  const e = (error && typeof error === "object" ? error : {}) as DbErrorLike;
  const message = error instanceof Error || typeof e.message === "string" ? String(e.message ?? "") : typeof error === "string" ? error : "";
  if (!message.trim() || RAW.test(message) || (typeof e.code === "string" && /^(\d{5}|PGRST\d+)$/.test(e.code))) return plainDbMessage(error, fallback, t);
  return message.slice(0, 400);
}
