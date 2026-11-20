import { readFile } from "node:fs/promises";
import path from "node:path";
import type { NextRequest } from "next/server";
import { EXTENSION_ZIP } from "@/lib/extension-download";
import { getInstallConfig } from "@/lib/install/config";
import { extensionResponse } from "@/lib/server/extension";

/**
 * The Chrome extension's zip with this dashboard's address already set (lib/server/extension.ts), so
 * nobody has to paste it into the extension. next.config.ts traces public/downloads into this route.
 */
export async function GET(request: NextRequest) {
  const publicOrigin = getInstallConfig()?.publicOrigin ?? null;
  return extensionResponse({
    requestOrigin: request.nextUrl.origin,
    publicOrigin,
    readBundled: async () => new Uint8Array(await readFile(path.join(process.cwd(), "public", EXTENSION_ZIP))),
    fetchZip: async (url) => {
      const response = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000) }).catch(() => null);
      return response?.ok ? new Uint8Array(await response.arrayBuffer()) : null;
    },
  });
}
