import "server-only";
// Whether the signed-in person's account is being deleted (Settings > Account > Delete my account was
// started and hasn't finished). Such an account is locked: its own rows are closed to it, so the app
// layouts can't read its profile and would send it to onboarding. They ask this first, only when the
// profile came back empty, and send it to /delete-account to finish (the sweeper finishes it anyway).
import type { SupabaseClient } from "@supabase/supabase-js";

/** account_deletion_pending() answers for the caller only; a database from before it reads as "no". */
export async function deletionPending(supabase: SupabaseClient): Promise<boolean> {
  const { data, error } = await supabase.rpc("account_deletion_pending");
  return !error && data === true;
}

/** Where a locked account is sent (the redirect rules: lib/auth/session-gate.ts). */
export { FINISH_DELETION_PATH } from "@/lib/auth/session-gate";
