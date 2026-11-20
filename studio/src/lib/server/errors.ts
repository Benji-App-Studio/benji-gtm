import "server-only";
// What an API route answers when the database (or storage) fails: a plain sentence for the page, the
// raw error in the server's log (lib/db-errors.ts). Never pass a raw database error to a page.
// Each takes the route's `t` (getTranslator) last, to say the sentence in the viewer's language; the
// fallback is the route's own (translate it there). Without `t` the well-known causes are said in English.
import { plainDbMessage, plainError } from "@/lib/db-errors";
import type { Translator } from "@/lib/i18n/translate";

type Say = Translator["t"];

/** Logs `error` with where it happened and answers `{ error: <plain sentence> }` with `status`. */
export function dbFailure(where: string, error: unknown, fallback: string, status = 500, extra: Record<string, unknown> = {}, t?: Say): Response {
  console.error(`[api] ${where}:`, error);
  return Response.json({ error: t ? plainDbMessage(error, fallback, t) : plainDbMessage(error, fallback), ...extra }, { status });
}

/** The same sentence without a response, for code that builds its own (thrown errors, partial results). */
export function logDbError(where: string, error: unknown, fallback: string, t?: Say): string {
  console.error(`[api] ${where}:`, error);
  return t ? plainDbMessage(error, fallback, t) : plainDbMessage(error, fallback);
}

/** A caught error (thrown by our own code or by the database) as `{ error }`: plain sentences pass, raw ones are logged and replaced. */
export function caughtFailure(where: string, error: unknown, fallback: string, status = 500, extra: Record<string, unknown> = {}, t?: Say): Response {
  console.error(`[api] ${where}:`, error);
  return Response.json({ error: t ? plainError(error, fallback, t) : plainError(error, fallback), ...extra }, { status });
}

/** caughtFailure's sentence without a response (for routes that build their own). */
export function logCaught(where: string, error: unknown, fallback: string, t?: Say): string {
  console.error(`[api] ${where}:`, error);
  return t ? plainError(error, fallback, t) : plainError(error, fallback);
}
