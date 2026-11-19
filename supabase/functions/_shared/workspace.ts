// The workspace contract for edge functions: a product's connections and brand kit. Twin of
// studio/src/lib/workspace.ts and lib/workspace-schema.ts (keep the shapes in step). Edge functions
// read with their own client, usually the service role, so this takes it as an argument:
//   const { connections, brandKit } = await getWorkspace(productId, db);

/** IDs only, never secrets. adAccountId is "act_<digits>"; supabasePrefix is "<bucket>/<folder>". */
export interface WorkspaceConnections {
  meta?: { adAccountId?: string; pageId?: string; instagramId?: string; pixelId?: string; appId?: string };
  revenuecat?: { projectId?: string };
  appstack?: { appId?: string };
  storage?: { supabasePrefix?: string; driveFolderId?: string };
}

export interface BrandKit {
  appName: string;
  tagline?: string;
  iconUrl?: string;
  /** "#RRGGBB", most important first. */
  colors: string[];
  screenshotUrls: string[];
  tone?: string;
  /** Claims a creative must never make, one per entry. */
  forbiddenClaims?: string[];
  appStoreUrl?: string;
}

export interface Workspace { id: string; name: string; connections: WorkspaceConnections; brandKit: BrandKit }

export const WORKSPACE_BUCKET = "workspace";

const FIELDS: Record<keyof WorkspaceConnections, string[]> = {
  meta: ["adAccountId", "pageId", "instagramId", "pixelId", "appId"],
  revenuecat: ["projectId"],
  appstack: ["appId"],
  storage: ["supabasePrefix", "driveFolderId"],
};

/** Any Supabase client (typed loosely so every supabase-js version fits). */
// deno-lint-ignore no-explicit-any
type Db = { from(table: string): any };

const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const list = (value: unknown) => (Array.isArray(value) ? value.map(str) : str(value).split("\n").map((v) => v.trim())).filter(Boolean);
const isUrl = (value: string) => { try { return new URL(value).protocol === "https:"; } catch { return false; } };

export function readConnections(raw: unknown): WorkspaceConnections {
  const source = (raw && typeof raw === "object" ? raw : {}) as Record<string, Record<string, unknown> | undefined>;
  const out: Record<string, Record<string, string>> = {};
  for (const [key, fields] of Object.entries(FIELDS)) {
    const section: Record<string, string> = {};
    for (const field of fields) {
      const value = str(source[key]?.[field]);
      if (value) section[field] = value;
    }
    if (Object.keys(section).length) out[key] = section;
  }
  return out as WorkspaceConnections;
}

export function readBrandKit(raw: unknown, productName: string): BrandKit {
  const source = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const kit: BrandKit = {
    appName: str(source.appName) || productName,
    colors: list(source.colors).filter((c) => /^#[0-9A-F]{6}$/i.test(c)).map((c) => c.toUpperCase()),
    screenshotUrls: list(source.screenshotUrls).filter(isUrl),
  };
  const claims = list(source.forbiddenClaims);
  if (str(source.tagline)) kit.tagline = str(source.tagline);
  if (isUrl(str(source.iconUrl))) kit.iconUrl = str(source.iconUrl);
  if (str(source.tone)) kit.tone = str(source.tone);
  if (claims.length) kit.forbiddenClaims = claims;
  if (isUrl(str(source.appStoreUrl))) kit.appStoreUrl = str(source.appStoreUrl);
  return kit;
}

/** A product's workspace. Throws when there's no such product (or the client can't see it). */
export async function getWorkspace(productId: string, db: Db): Promise<Workspace> {
  const { data, error } = await db.from("products").select("id, user_id, name, connections, brand_kit").eq("id", productId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`No workspace ${productId}.`);
  const row = data as { id: string; user_id: string; name: string; connections: unknown; brand_kit: unknown };
  const connections = readConnections(row.connections);
  connections.storage = { ...connections.storage, supabasePrefix: connections.storage?.supabasePrefix || `${WORKSPACE_BUCKET}/${row.user_id}/${row.id}` };
  return { id: row.id, name: row.name, connections, brandKit: readBrandKit(row.brand_kit, row.name) };
}
