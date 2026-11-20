import "server-only";
// The brand on the server: one reader (brandFor) every generator and overview uses, and one writer
// (saveBrand) the Brand page and "Use this" go through, so products.brand_kit and products.brand_system
// always change together. The rules themselves are in lib/brand.ts (pure, tested).
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applySuggestion, brandDraft, brandSuggestions, mergeBrand, prepareBrandSave,
  type BrandBasics, type BrandColumns, type BrandOverview, type MergedBrand, type SuggestionKey,
} from "@/lib/brand";
import { requireInstallConfig } from "@/lib/install/config";
import { m } from "@/lib/i18n/translate";
import type { ProductInsight } from "@/lib/product-insight";
import { WORKSPACE_BUCKET, WorkspaceNotFoundError } from "@/lib/workspace";
import { readBrandKit, UUID } from "@/lib/workspace-schema";
import type { Session } from "./auth";

type Row = BrandColumns & { id: string; insight: ProductInsight | null };
const COLUMNS = "id, name, brand_kit, brand_system, insight";

async function loadBrandRow(supabase: SupabaseClient, productId: string): Promise<Row> {
  if (!UUID.test(productId)) throw new WorkspaceNotFoundError(productId);
  const { data, error } = await supabase.from("products").select(COLUMNS).eq("id", productId).maybeSingle<Row>();
  if (error) throw new Error(error.message);
  if (!data) throw new WorkspaceNotFoundError(productId);
  return data;
}

/**
 * A product's brand as every generator should read it: the kit's basics, the brand system and the AI
 * profile merged (lib/brand.ts mergeBrand). Forbidden claims are the kit's ∪ the voice's ∪ the
 * profile's claims to avoid. Throws WorkspaceNotFoundError when the product isn't there (or isn't yours).
 */
export async function brandFor(session: Pick<Session, "supabase">, productId: string): Promise<MergedBrand> {
  return mergeBrand(await loadBrandRow(session.supabase, productId));
}

function overviewOf(row: Row): BrandOverview {
  const draft = brandDraft(row);
  return { name: row.name, appName: draft.basics.appName, stored: Boolean(row.brand_system), draft, suggestions: brandSuggestions(row.insight, draft), hasProfile: Boolean(row.insight) };
}

export async function brandOverview(session: Session, productId: string): Promise<BrandOverview> {
  return overviewOf(await loadBrandRow(session.supabase, productId));
}

export class BrandSaveError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

/**
 * Saves the brand: the basics into the kit, the system whole, and the kit's colours, tone and forbidden
 * claims from the system, in one update. Brand images the kit no longer uses are deleted from storage.
 */
export async function saveBrand(session: Session, productId: string, input: { basics?: Partial<BrandBasics> | null; system?: unknown }): Promise<BrandOverview> {
  const row = await loadBrandRow(session.supabase, productId);
  const next = prepareBrandSave(row, input);
  if ("error" in next) throw new BrandSaveError(next.error);
  const { data, error } = await session.supabase.from("products").update(next).eq("id", row.id).select(COLUMNS).single<Row>();
  if (error) throw new BrandSaveError(error.message, 500);
  await removeDroppedBrandImages(session, row.id, row, data);
  return overviewOf(data);
}

/** "Use this" on one AI profile suggestion: applies it to what's saved and saves (the Product page). */
export async function applyBrandSuggestion(session: Session, productId: string, key: SuggestionKey): Promise<BrandOverview> {
  const row = await loadBrandRow(session.supabase, productId);
  const draft = brandDraft(row);
  const suggestion = brandSuggestions(row.insight, draft).find((s) => s.key === key);
  if (!suggestion) throw new BrandSaveError(m("That suggestion is already in your brand."));
  const next = applySuggestion(draft, suggestion);
  return saveBrand(session, productId, { basics: next.basics, system: next.system });
}

/** Deletes brand images this workspace uploaded (…/<product>/brand/) that the kit no longer uses. */
export async function removeDroppedBrandImages(session: Session, productId: string, before: Pick<BrandColumns, "name" | "brand_kit">, after: Pick<BrandColumns, "name" | "brand_kit">) {
  const images = (row: Pick<BrandColumns, "name" | "brand_kit">) => {
    const kit = readBrandKit(row.brand_kit, row.name);
    return [kit.iconUrl, ...kit.screenshotUrls].filter((url): url is string => Boolean(url));
  };
  const kept = new Set(images(after));
  const base = `${requireInstallConfig().supabaseUrl}/storage/v1/object/public/${WORKSPACE_BUCKET}/`;
  const folder = `${session.user.id}/${productId}/brand/`;
  const dropped = images(before).filter((url) => !kept.has(url) && url.startsWith(base + folder)).map((url) => decodeURIComponent(url.slice(base.length)));
  if (dropped.length) await session.supabase.storage.from(WORKSPACE_BUCKET).remove(dropped);
}
