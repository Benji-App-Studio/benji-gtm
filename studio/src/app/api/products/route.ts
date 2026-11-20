import { getTranslator } from "@/lib/i18n/server";
import { isResponse, requireUser } from "@/lib/server/auth";
import { productInput, saveCompetitorField } from "@/lib/server/products";
import { planLimitError } from "@/lib/db-errors";
import { dbFailure } from "@/lib/server/errors";

export async function GET() {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { t } = await getTranslator();
  const { data, error } = await session.supabase.from("products").select("*").order("is_primary", { ascending: false }).order("created_at");
  if (error) return dbFailure("products list", error, t("Couldn't load your products. Try again."), 500, {}, t);
  return Response.json(data);
}

/** Saves a product. The first one (from onboarding) is the primary product and finishes onboarding. */
export async function POST(request: Request) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { t } = await getTranslator();
  const input = productInput(await request.json().catch(() => ({})));
  if (typeof input === "string") return Response.json({ error: t(input) }, { status: 400 });
  const { supabase, user } = session;
  const { count } = await supabase.from("products").select("id", { count: "exact", head: true });
  const { data: inserted, error } = await supabase.from("products").insert({ ...input, is_primary: !count }).select().single();
  if (error) {
    // Accounts mode: the plan's app cap (or a suspended account), refused by the database's guard.
    const limit = planLimitError(error, t);
    if (limit) return Response.json({ error: limit.message, limit: limit.kind }, { status: limit.status });
    return dbFailure("product create", error, t("Couldn't save the product. Try again."), 500, {}, t);
  }
  // The typed competitors start the product's one list (the row's column already holds them).
  let data = inserted;
  if (input.known_competitors?.length) {
    const rest = await saveCompetitorField(session, inserted.id, input);
    if (!("known_competitors" in rest)) data = (await supabase.from("products").select("*").eq("id", inserted.id).single()).data ?? inserted;
  }
  await supabase.from("profiles").update({ onboarded_at: new Date().toISOString() }).eq("id", user.id).is("onboarded_at", null);
  return Response.json(data);
}
