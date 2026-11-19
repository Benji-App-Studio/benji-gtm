import type { NextRequest } from "next/server";
import { isResponse, requireUser } from "@/lib/server/auth";
import { productInput, saveCompetitorField } from "@/lib/server/products";

export async function GET(_request: NextRequest, ctx: RouteContext<"/api/products/[id]">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { id } = await ctx.params;
  const { data } = await session.supabase.from("products").select("*").eq("id", id).maybeSingle();
  return data ? Response.json(data) : Response.json({ error: "Not found" }, { status: 404 });
}

export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/products/[id]">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { id } = await ctx.params;
  const parsed = productInput(await request.json().catch(() => ({})), true);
  if (typeof parsed === "string") return Response.json({ error: parsed }, { status: 400 });
  const { data: exists } = await session.supabase.from("products").select("id").eq("id", id).maybeSingle();
  if (!exists) return Response.json({ error: "Not found" }, { status: 404 });
  // Competitor names go to the product's one list first; the row's column follows it.
  const input = await saveCompetitorField(session, id, parsed);
  const query = Object.keys(input).length ? session.supabase.from("products").update(input).eq("id", id) : session.supabase.from("products").select("*").eq("id", id);
  const { data, error } = await query.select().maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return data ? Response.json(data) : Response.json({ error: "Not found" }, { status: 404 });
}

export async function DELETE(_request: NextRequest, ctx: RouteContext<"/api/products/[id]">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { id } = await ctx.params;
  const { data: product } = await session.supabase.from("products").select("is_primary").eq("id", id).maybeSingle();
  if (product?.is_primary) return Response.json({ error: "Your main product can't be deleted; edit it instead." }, { status: 400 });
  await session.supabase.from("products").delete().eq("id", id);
  return Response.json({ deleted: true });
}
