import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { requireInstallConfig } from "@/lib/install/config";

/** Supabase on the server, acting as the signed-in user (row-level security applies). */
export async function createClient() {
  const config = requireInstallConfig();
  const store = await cookies();
  return createServerClient(config.supabaseUrl, config.publishableKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        // Server Components can't set cookies; the proxy refreshes the session for them.
        try { list.forEach(({ name, value, options }) => store.set(name, value, options)); } catch {}
      },
    },
  });
}
