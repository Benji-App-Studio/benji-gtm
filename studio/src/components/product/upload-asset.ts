"use client";
// Uploads one product image: a one-time ticket from the API, the file straight to Storage, then the
// row (with its size, read in the browser). Used by the Product page and Recreate's "Your images".
import type { AssetKind, ProductAsset } from "@/lib/product-assets";
import { createClient } from "@/lib/supabase/client";
import { uploadErrorText } from "@/lib/storage-usage";

export const ASSET_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
export const ASSET_MAX_BYTES = 15 * 1024 * 1024;

function measure(file: File): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { resolve({ width: img.naturalWidth, height: img.naturalHeight }); URL.revokeObjectURL(url); };
    img.onerror = () => { resolve(null); URL.revokeObjectURL(url); };
    img.src = url;
  });
}

/** Uploads `file` as one of the product's images; `kind` when the user chose one (the AI then keeps it). */
export async function uploadProductAsset(productId: string, file: File, o: { kind?: AssetKind; label?: string } = {}): Promise<ProductAsset> {
  if (!ASSET_IMAGE_TYPES.includes(file.type)) throw new Error(`${file.name} isn't a PNG, JPEG or WebP image.`);
  if (file.size > ASSET_MAX_BYTES) throw new Error(`${file.name} is over 15 MB.`);
  const post = (body: unknown) => fetch(`/api/products/${productId}/assets`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    .then(async (r) => ({ ok: r.ok, data: await r.json().catch(() => ({ error: "Couldn't reach the server. Try again." })) }));
  const ticket = await post({ action: "ticket", contentType: file.type, size: file.size });
  if (!ticket.ok) throw new Error(ticket.data.error);
  const { error } = await createClient().storage.from(ticket.data.bucket).uploadToSignedUrl(ticket.data.path, ticket.data.token, file, { contentType: file.type });
  if (error) throw new Error(`${file.name}: ${uploadErrorText(error)}`);
  const size = await measure(file);
  const added = await post({ action: "add", path: ticket.data.path, kind: o.kind, label: o.label ?? file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").slice(0, 80), width: size?.width, height: size?.height });
  if (!added.ok) throw new Error(added.data.error);
  return added.data.asset as ProductAsset;
}
