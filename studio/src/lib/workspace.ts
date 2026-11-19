import "server-only";
// The workspace contract every module codes against: a product's connections and brand kit.
//   const { connections, brandKit } = await getWorkspace(productId);
// Reads go through Supabase as the signed-in user (row-level security applies), unless a module
// passes its own client (e.g. a service-role client in a background job). Shapes and cleaning live in
// lib/workspace-schema.ts, which pages can import too.
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import {
  CONNECTION_KEYS, connectionStatus, readBrandKit, readConnections, UUID,
  type ConnectionChecks, type Workspace, type WorkspaceConnections, type WorkspaceSummary, type WorkspaceView,
} from "@/lib/workspace-schema";

export type { BrandKit, ConnectionKey, ConnectionState, Workspace, WorkspaceConnections, WorkspaceView } from "@/lib/workspace-schema";

export const WORKSPACE_BUCKET = "workspace";

export class WorkspaceNotFoundError extends Error {
  constructor(readonly productId: string) { super("That app doesn't exist, or isn't yours."); }
}

/** The columns a workspace is made of. */
export const WORKSPACE_COLUMNS = "id, user_id, name, is_primary, connections, brand_kit, connection_checks";
/** Before the workspaces migration is applied the extra columns don't exist; pages still load, with nothing connected. */
const BASE_COLUMNS = "id, user_id, name, is_primary";
const missingColumns = (error: { code?: string; message?: string } | null) => Boolean(error && (error.code === "42703" || /column .* does not exist/i.test(error.message ?? "")));
const asWorkspaceRow = (row: Omit<WorkspaceRow, "connections" | "brand_kit" | "connection_checks">): WorkspaceRow => ({ ...row, connections: {}, brand_kit: {}, connection_checks: null });

export interface WorkspaceRow {
  id: string; user_id: string; name: string; is_primary: boolean;
  connections: unknown; brand_kit: unknown; connection_checks: ConnectionChecks | null;
}

/** Fills what a workspace always has: the default storage folder for its files. */
function withDefaults(connections: WorkspaceConnections, row: Pick<WorkspaceRow, "id" | "user_id">): WorkspaceConnections {
  return { ...connections, storage: { ...connections.storage, supabasePrefix: connections.storage?.supabasePrefix || `${WORKSPACE_BUCKET}/${row.user_id}/${row.id}` } };
}

export function toWorkspace(row: WorkspaceRow): Workspace {
  return { id: row.id, name: row.name, connections: withDefaults(readConnections(row.connections), row), brandKit: readBrandKit(row.brand_kit, row.name) };
}

export function toWorkspaceView(row: WorkspaceRow): WorkspaceView {
  const workspace = toWorkspace(row);
  const checks = row.connection_checks ?? {};
  const status = Object.fromEntries(CONNECTION_KEYS.map((key) => [key, connectionStatus(workspace.connections, checks, key)])) as WorkspaceView["status"];
  return { ...workspace, isPrimary: row.is_primary, status };
}

export async function getWorkspaceRow(productId: string, client?: SupabaseClient): Promise<WorkspaceRow> {
  if (!UUID.test(productId)) throw new WorkspaceNotFoundError(productId);
  const supabase = client ?? await createClient();
  const { data, error } = await supabase.from("products").select(WORKSPACE_COLUMNS).eq("id", productId).maybeSingle<WorkspaceRow>();
  if (missingColumns(error)) {
    const base = await supabase.from("products").select(BASE_COLUMNS).eq("id", productId).maybeSingle<Omit<WorkspaceRow, "connections" | "brand_kit" | "connection_checks">>();
    if (base.error) throw new Error(base.error.message);
    if (!base.data) throw new WorkspaceNotFoundError(productId);
    return asWorkspaceRow(base.data);
  }
  if (error) throw new Error(error.message);
  if (!data) throw new WorkspaceNotFoundError(productId);
  return data;
}

/** A product's workspace: its connections and brand kit. Throws WorkspaceNotFoundError when there's none. */
export async function getWorkspace(productId: string, client?: SupabaseClient): Promise<Workspace> {
  return toWorkspace(await getWorkspaceRow(productId, client));
}

/** Every workspace of the signed-in user (or of all users, with a service-role client), main one first. */
export async function listWorkspaces(client?: SupabaseClient): Promise<WorkspaceSummary[]> {
  const supabase = client ?? await createClient();
  let { data, error } = await supabase.from("products").select(WORKSPACE_COLUMNS).order("is_primary", { ascending: false }).order("created_at").returns<WorkspaceRow[]>();
  if (missingColumns(error)) {
    const base = await supabase.from("products").select(BASE_COLUMNS).order("is_primary", { ascending: false }).order("created_at").returns<Omit<WorkspaceRow, "connections" | "brand_kit" | "connection_checks">[]>();
    ({ error } = base);
    data = (base.data ?? []).map(asWorkspaceRow);
  }
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const view = toWorkspaceView(row);
    const states = Object.values(view.status);
    return { id: view.id, name: view.name, appName: view.brandKit.appName, iconUrl: view.brandKit.iconUrl, isPrimary: view.isPrimary, ready: states.filter((s) => s.state !== "not_set").length, total: states.length };
  });
}

/** Splits a storage prefix into its bucket and folder: "workspace/u/p" → { bucket: "workspace", folder: "u/p" }. */
export function storageLocation(workspace: Workspace): { bucket: string; folder: string } {
  const [bucket, ...rest] = (workspace.connections.storage?.supabasePrefix ?? "").split("/");
  return { bucket, folder: rest.join("/") };
}
