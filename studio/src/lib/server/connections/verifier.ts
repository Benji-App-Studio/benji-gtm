import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Workspace } from "@/lib/workspace";

export interface VerifyContext {
  workspace: Workspace;
  /** Acting as the signed-in user (row-level security applies). */
  supabase: SupabaseClient;
  userId: string;
}

/**
 * ok: the IDs work (the connection becomes "verified"). Not ok: say what's wrong in a sentence the
 * user can act on. pending: this check isn't available yet, so nothing is recorded.
 */
export interface VerifyResult { ok: boolean; message: string; pending?: boolean }

export type Verifier = (context: VerifyContext) => Promise<VerifyResult>;
