// A database or storage error as a sentence a person can act on. The raw error (table names, SQL,
// constraint names) is for the server log only: routes log it and answer with this (lib/server/errors.ts).
// Pure: the tests load it.

export interface DbErrorLike { code?: string | null; message?: string | null; details?: string | null; hint?: string | null; status?: number | string | null; statusCode?: number | string | null }

/** Errors that mean this copy's database is behind the code: a table, column or function is missing. */
const MISSING_SCHEMA = new Set(["42P01", "42703", "42883", "PGRST202", "PGRST204", "PGRST205"]);

/**
 * The plain sentence for a database error. `fallback` says what failed ("Couldn't save the competitor.");
 * a few well-known causes get their own sentence instead.
 */
export function plainDbMessage(error: unknown, fallback: string): string {
  const e = (error && typeof error === "object" ? error : {}) as DbErrorLike;
  const code = String(e.code ?? "");
  const text = String(e.message ?? "");
  if (MISSING_SCHEMA.has(code) || /does not exist|could not find the (table|function|column)|schema cache/i.test(text)) {
    return "The database is missing a recent update. Open /setup, paste an access token and press Apply the update.";
  }
  if (code === "23505" || /duplicate key/i.test(text)) return "That already exists.";
  if (code === "23503" || /foreign key/i.test(text)) return "Something this refers to was deleted. Reload the page and try again.";
  if (code === "42501" || /row-level security|permission denied/i.test(text)) return "You don't have access to change that. Ask the owner of this install.";
  if (code === "PGRST116") return "That wasn't found. Reload the page and try again.";
  if (code === "57014" || /statement timeout|canceling statement/i.test(text)) return "The database took too long to answer. Try again in a moment.";
  if (/fetch failed|network|ECONNREFUSED|ENOTFOUND|timed? ?out/i.test(text)) return "Couldn't reach your Supabase project. Check that it isn't paused, then try again.";
  return fallback;
}

/** Words only a raw database, storage or PostgREST error carries (table, column, constraint, policy names). */
const RAW = /duplicate key|violates|relation "|column "|syntax error|PGRST\d|JWT|row-level security|permission denied|schema cache|does not exist|null value in column|invalid input syntax|could not find the|function [a-z_.]+\(|fetch failed|ECONNREFUSED|ENOTFOUND|unexpected token|internal server error/i;

/**
 * A caught error as a sentence for the page: our own messages (already plain) pass through; anything
 * that reads like a raw database or network error becomes plainDbMessage's sentence, or `fallback`.
 */
export function plainError(error: unknown, fallback: string): string {
  const e = (error && typeof error === "object" ? error : {}) as DbErrorLike;
  const message = error instanceof Error || typeof e.message === "string" ? String(e.message ?? "") : typeof error === "string" ? error : "";
  if (!message.trim() || RAW.test(message) || (typeof e.code === "string" && /^(\d{5}|PGRST\d+)$/.test(e.code))) return plainDbMessage(error, fallback);
  return message.slice(0, 400);
}
