// Which app an analysis may be tied to: only one of the signed-in person's own (row-level security
// limits what the client can read, so a product another account owns is simply not found). No
// "server-only" import, so the Node tests (own-app.test.ts) can run it against a stand-in client.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reads one product by id with the person's own client (so row-level security applies). */
export type ProductLookup = (id: string) => PromiseLike<{ data: { id: string } | null; error: unknown }>;

/** The person's client as a lookup: `ownApp(productLookup(session.supabase), id)`. */
export const productLookup = (supabase: { from: (table: string) => unknown }): ProductLookup => (id) =>
  (supabase.from("products") as { select: (c: string) => { eq: (k: string, v: string) => { maybeSingle: <T>() => PromiseLike<{ data: T | null; error: unknown }> } } })
    .select("id").eq("id", id).maybeSingle<{ id: string }>();

/** The app's id when it is one of this person's; null for anything else (another account's, missing, malformed). */
export async function ownApp(find: ProductLookup, id: unknown): Promise<string | null> {
  if (typeof id !== "string" || !UUID.test(id)) return null;
  const { data, error } = await find(id);
  if (error || !data?.id) return null;
  return data.id;
}

/**
 * What an "Assign to app" request asks for: `productId` set to an id (checked with ownApp) or to null
 * (not tied to an app). `undefined` when the body doesn't mention it.
 */
export function requestedApp(body: unknown): { productId: string | null } | undefined {
  if (!body || typeof body !== "object" || !("productId" in body)) return undefined;
  const value = (body as { productId: unknown }).productId;
  return { productId: value === null || value === "" ? null : typeof value === "string" ? value : "invalid" };
}
