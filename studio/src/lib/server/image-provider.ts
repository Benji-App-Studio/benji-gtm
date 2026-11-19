import "server-only";
// A product's remembered image provider (products.image_provider, 20261005900000_image_provider.sql):
// who makes its GPT Image 2.5 jobs unless a generation picks otherwise. Before that migration is
// applied the column doesn't exist: reads say Higgsfield and saves are skipped, so nothing breaks.
import { DEFAULT_IMAGE_PROVIDER, normalizeImageProvider, type ImageProvider } from "@/lib/image-provider";
import type { Session } from "./auth";

const missingColumn = (error: { code?: string; message?: string } | null) => Boolean(error && (error.code === "42703" || /image_provider/i.test(error.message ?? "")));

export async function readImageProvider(session: Session, productId: string): Promise<ImageProvider> {
  const { data, error } = await session.supabase.from("products").select("image_provider").eq("id", productId).maybeSingle<{ image_provider: string | null }>();
  if (error || !data) return DEFAULT_IMAGE_PROVIDER;
  return normalizeImageProvider(data.image_provider);
}

/** Remembers the choice; false when the product isn't the person's, or the column isn't there yet. */
export async function saveImageProvider(session: Session, productId: string, provider: ImageProvider): Promise<{ saved: boolean; error?: string }> {
  const { data, error } = await session.supabase.from("products").update({ image_provider: provider }).eq("id", productId).select("id");
  if (missingColumn(error)) return { saved: false, error: "The choice wasn't remembered: the database is behind this version. Open /setup and run the update." };
  if (error) return { saved: false, error: error.message };
  return { saved: Boolean(data?.length) };
}
