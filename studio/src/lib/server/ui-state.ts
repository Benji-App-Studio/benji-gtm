import "server-only";
// profiles.ui_state on the server (lib/ui-state.ts has the rules). Reads and writes run as the signed-in
// user: the profile's own-row policies apply. Before the migration the column is missing: reads answer
// an empty state and writes say they weren't stored (the browser's copy still works).
import type { SupabaseClient } from "@supabase/supabase-js";
import { applyUiChange, cleanUiState, type UiState } from "@/lib/ui-state";

type Db = { supabase: SupabaseClient; user: { id: string } };

export async function readUiState({ supabase, user }: Db): Promise<{ state: UiState; stored: boolean }> {
  const { data, error } = await supabase.from("profiles").select("ui_state").eq("id", user.id).maybeSingle<{ ui_state: unknown }>();
  if (error) return { state: {}, stored: false };
  return { state: cleanUiState(data?.ui_state), stored: true };
}

export async function writeUiState(session: Db, key: string, value: string | null): Promise<{ state: UiState; stored: boolean }> {
  const { state, stored } = await readUiState(session);
  const next = applyUiChange(state, key, value);
  if (!stored) return { state: next, stored: false };
  const { error } = await session.supabase.from("profiles").update({ ui_state: next }).eq("id", session.user.id);
  return { state: error ? state : next, stored: !error };
}
