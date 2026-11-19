import "server-only";
// A creative's file and `copy`, written as the signed-in user. The browser may only update review
// columns on `creatives`, so these go through the owner-checked `creatives_set_file` function
// (migration 20261005300000): the file (storage_path, url, mime, size, dimensions), `copy`, and the ad
// copy columns. The review trigger then sends the creative back to QA and any decision back to pending.
import type { SupabaseClient } from "@supabase/supabase-js";

export interface CreativeFilePatch {
  storage_path?: string; url?: string; mime?: string; size_bytes?: number | null; width?: number | null; height?: number | null;
  copy?: Record<string, unknown>; headline?: string | null; primary_text?: string | null; cta?: string | null;
}

export interface SavedCreative { id: string; url: string; storage_path: string; size_bytes: number | null; copy: Record<string, unknown>; approval: string; qa_status: string }

export async function setCreativeFile(supabase: SupabaseClient, id: string, patch: CreativeFilePatch): Promise<{ creative: SavedCreative } | { error: string }> {
  const { data, error } = await supabase.rpc("creatives_set_file", { p_id: id, p_patch: patch }).single<SavedCreative>();
  if (error || !data) {
    const message = error?.message ?? "no row";
    return { error: /creatives_set_file|does not exist|schema cache/i.test(message) ? `The database can't save the new file yet: apply migration 20261005300000_creatives_set_file.sql (${message}).` : message };
  }
  const { id: savedId, url, storage_path, size_bytes, copy, approval, qa_status } = data;
  return { creative: { id: savedId, url, storage_path, size_bytes, copy, approval, qa_status } };
}
