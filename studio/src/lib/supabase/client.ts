"use client";
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { publicInstall } from "@/lib/install/public";

/**
 * The example app (components/example) has no database: every call answers "nothing" at once, and no
 * Realtime connection is ever opened (it would retry an unreachable address forever).
 */
function exampleClient(): SupabaseClient {
  const empty = { data: null, error: { message: "This is an example." }, count: null };
  const nothing: unknown = new Proxy(function () {}, {
    get: (_target, key) => {
      if (key === "then") return (resolve: (value: unknown) => unknown) => resolve(empty);
      if (key === "getSession" || key === "getUser") return async () => ({ data: { session: null, user: null }, error: null });
      if (key === "removeChannel" || key === "removeAllChannels" || key === "unsubscribe") return async () => "ok";
      return nothing;
    },
    apply: () => nothing,
  });
  return nothing as SupabaseClient;
}

/** Supabase in the browser: sign up, sign in, sign out. Data goes through the API routes. */
export function createClient(): SupabaseClient {
  if ((globalThis as { __EXAMPLE_MODE__?: boolean }).__EXAMPLE_MODE__) return exampleClient();
  const install = publicInstall();
  if (!install) throw new Error("This install isn't set up yet. Open /setup to connect a Supabase project.");
  return createBrowserClient(install.url, install.key);
}
