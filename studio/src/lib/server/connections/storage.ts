import "server-only";
import { storageLocation } from "@/lib/workspace";
import type { Verifier } from "./verifier";

/**
 * The Supabase Storage folder: the signed-in user can list it (so they can also write there, under
 * the same policies). A Google Drive folder isn't checked yet.
 */
export const verifyStorage: Verifier = async ({ workspace, supabase }) => {
  const { bucket, folder } = storageLocation(workspace);
  const { error } = await supabase.storage.from(bucket).list(folder, { limit: 1 });
  if (error) return { ok: false, message: `Can't open ${bucket}/${folder}: ${error.message}` };
  const drive = workspace.connections.storage?.driveFolderId ? " The Google Drive folder isn't checked yet." : "";
  return { ok: true, message: `Files go to ${bucket}/${folder}.${drive}` };
};
