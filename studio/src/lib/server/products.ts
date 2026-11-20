import "server-only";
import type { ProductKind, ProductRow, Stage } from "@/lib/db";
import { PLATFORMS } from "@/lib/types";
import { m } from "@/lib/i18n/translate";
import { syncCompetitors } from "./competitors";
import type { Session } from "./auth";

const KINDS: ProductKind[] = ["saas", "mobile_app", "physical_product", "clothing", "food_beverage", "restaurant", "local_service", "creator_education", "other"];
const STAGES: Stage[] = ["idea", "pre_launch", "launched", "established"];
const text = (value: unknown, max = 300) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const handle = (value: unknown) => text(value, 200).replace(/^@/, "");

/** The product fields a user can set, cleaned and checked. Returns an error message instead when invalid. */
export function productInput(body: Record<string, unknown>, partial = false): Partial<ProductRow> | string {
  const out: Partial<ProductRow> = {};
  if (!partial || "name" in body) {
    const name = text(body.name, 120);
    if (!name) return m("Give your product a name.");
    out.name = name;
  }
  if (!partial || "kind" in body) {
    if (!KINDS.includes(body.kind as ProductKind)) return m("Choose what you're building.");
    out.kind = body.kind as ProductKind;
  }
  if (!partial || "description" in body) {
    const description = text(body.description, 2000);
    if (description.length < 15) return m("Describe your product in a sentence or two.");
    out.description = description;
  }
  if ("website" in body) out.website = text(body.website, 300) || null;
  if ("links" in body) {
    const raw = Array.isArray(body.links) ? body.links : String(body.links ?? "").split(/[\n,\s]+/);
    out.links = [...new Set(raw.map((l) => text(l, 300)).filter((l) => /^(https?:\/\/)?[^\s/]+\.[^\s]+$/i.test(l)))].slice(0, 10);
  }
  if ("stage" in body) out.stage = STAGES.includes(body.stage as Stage) ? (body.stage as Stage) : null;
  for (const key of ["audience", "price_tier", "sales_channel", "region", "category", "category_label"] as const) {
    if (key in body) out[key] = text(body[key], 300) || null;
  }
  if ("socials" in body && body.socials && typeof body.socials === "object") {
    const socials: Record<string, string> = {};
    for (const key of [...PLATFORMS, "facebook"]) {
      const value = handle((body.socials as Record<string, unknown>)[key]);
      if (value) socials[key] = value;
    }
    out.socials = socials;
  }
  if ("known_competitors" in body) {
    const list = Array.isArray(body.known_competitors) ? body.known_competitors : String(body.known_competitors ?? "").split(/[\n,]/);
    // The whole competitor list as the form shows it (the product row mirrors the list); the routes save
    // it through syncCompetitors (lib/server/competitors.ts), so the cap stays above any real list.
    out.known_competitors = list.map((c) => text(c, 120)).filter(Boolean).slice(0, 200);
  }
  if ("answers" in body && body.answers && typeof body.answers === "object") {
    out.answers = Object.fromEntries(Object.entries(body.answers as Record<string, unknown>).slice(0, 20).map(([k, v]) => [k.slice(0, 40), text(v, 600)]));
  }
  if ("platform_scores" in body && body.platform_scores && typeof body.platform_scores === "object") {
    out.platform_scores = Object.fromEntries(PLATFORMS.map((p) => [p, Number((body.platform_scores as Record<string, unknown>)[p]) || 0])) as ProductRow["platform_scores"];
  }
  if ("keywords" in body && Array.isArray(body.keywords)) out.keywords = body.keywords.map((k) => text(k, 80)).filter(Boolean).slice(0, 12);
  return out;
}

/**
 * Saves the product form's competitor names into the product's one list (lib/competitors.ts
 * planCompetitorSync): new names are added, names taken out leave the list unless they're followed or
 * have a Page. Returns the input without `known_competitors` when the list took it (a trigger keeps the
 * column in step), or unchanged when it couldn't (before the migration), so the column is written as before.
 */
export async function saveCompetitorField(session: Session, productId: string, input: Partial<ProductRow>): Promise<Partial<ProductRow>> {
  if (!input.known_competitors) return input;
  const synced = await syncCompetitors(session, productId, input.known_competitors, "product");
  if (!synced.ok) {
    console.warn(`competitor list not saved for ${productId}: ${synced.error}`);
    return input;
  }
  const rest = { ...input };
  delete rest.known_competitors;
  return rest;
}
