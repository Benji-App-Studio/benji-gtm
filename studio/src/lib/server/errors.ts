import "server-only";
// What an API route answers when the database (or storage) fails: a plain sentence for the page, the
// raw error in the server's log (lib/db-errors.ts). Never pass a raw database error to a page.
import { plainDbMessage, plainError } from "@/lib/db-errors";

/** Logs `error` with where it happened and answers `{ error: <plain sentence> }` with `status`. */
export function dbFailure(where: string, error: unknown, fallback: string, status = 500, extra: Record<string, unknown> = {}): Response {
  console.error(`[api] ${where}:`, error);
  return Response.json({ error: plainDbMessage(error, fallback), ...extra }, { status });
}

/** The same sentence without a response, for code that builds its own (thrown errors, partial results). */
export function logDbError(where: string, error: unknown, fallback: string): string {
  console.error(`[api] ${where}:`, error);
  return plainDbMessage(error, fallback);
}

/** A caught error (thrown by our own code or by the database) as `{ error }`: plain sentences pass, raw ones are logged and replaced. */
export function caughtFailure(where: string, error: unknown, fallback: string, status = 500, extra: Record<string, unknown> = {}): Response {
  console.error(`[api] ${where}:`, error);
  return Response.json({ error: plainError(error, fallback), ...extra }, { status });
}

/** caughtFailure's sentence without a response (for routes that build their own). */
export function logCaught(where: string, error: unknown, fallback: string): string {
  console.error(`[api] ${where}:`, error);
  return plainError(error, fallback);
}
