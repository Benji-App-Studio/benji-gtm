// A page that only sends an old address to its new place (lib/nav-model.ts legacyRedirect), query kept.
import "server-only";
import { notFound, redirect } from "next/navigation";
import { legacyRedirect, searchString } from "@/lib/nav-model";

export function redirectLegacy(path: string, searchParams: Record<string, string | string[] | undefined>): never {
  const to = legacyRedirect(path, searchString(searchParams));
  if (!to) notFound();
  redirect(to);
}
