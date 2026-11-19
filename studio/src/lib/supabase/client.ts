"use client";
import { createBrowserClient } from "@supabase/ssr";
import { publicInstall } from "@/lib/install/public";

/** Supabase in the browser: sign up, sign in, sign out. Data goes through the API routes. */
export function createClient() {
  const install = publicInstall();
  if (!install) throw new Error("This install isn't set up yet. Open /setup to connect a Supabase project.");
  return createBrowserClient(install.url, install.key);
}
