import "server-only";
// Tab titles for an app's pages: "Research · Trailmix · Benji GTM", in the viewer's language. The pages
// are client components, so each section's layout.tsx (app/app/w/[productId]/…) asks for its title here.
// The title is absolute: a nested template would be reset by a child's plain title, and a page without
// its own title keeps its section's (Research's tabs all read "Research · …").
import type { Metadata } from "next";
import { cache } from "react";
import { APP_NAME } from "@/lib/brand-config";
import { getTranslator } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { UUID } from "@/lib/workspace-schema";

/** The app's name as the sidebar shows it (row-level security: only the person's own apps). Once per request. */
const appName = cache(async (productId: string): Promise<string> => {
  if (!UUID.test(productId)) return "";
  const supabase = await createClient();
  const { data } = await supabase.from("products").select("name").eq("id", productId).maybeSingle<{ name: string | null }>();
  return data?.name?.trim() ?? "";
});

/** The parts of a title, joined: the page, the app, the product. Empty parts are left out. */
export const titleParts = (...parts: (string | null | undefined)[]) => parts.map((p) => p?.trim()).filter(Boolean).join(" · ");

/**
 * Metadata for one of an app's pages. `page` is the page's English name marked with m() (shown with t()),
 * or null for the app alone.
 */
export async function appPageMetadata(productId: string, page: string | null): Promise<Metadata> {
  const [{ t }, name] = await Promise.all([getTranslator(), appName(productId)]);
  return { title: { absolute: titleParts(page ? t(page) : null, name, APP_NAME) } };
}
