// The answer to GET /api/extension (lib/extension-zip.ts rewrites the zip). The address put into the
// extension is the install's configured public address, else the address Next.js parsed for the request
// (request.nextUrl): never a Host or X-Forwarded-Host header, so a spoofed header can't make a zip that
// points somewhere else. The zip itself is read from this build's files, or from the configured address;
// never from a header-derived host. Every answer, redirects included, is no-store. No Next.js imports:
// the route passes everything in, and extension-route.test.ts calls it directly.
import { EXTENSION_ZIP, EXTENSION_ZIP_NAME } from "../extension-download";
import { personalizeExtension } from "../extension-zip";

export interface ExtensionInputs {
  /** request.nextUrl.origin */
  requestOrigin: string;
  /** The install's public address (getInstallConfig().publicOrigin), when one is configured. */
  publicOrigin: string | null | undefined;
  /** This build's copy of public/downloads/<zip>, or null when it can't be read. */
  readBundled: () => Promise<Uint8Array | null>;
  /** GET an absolute address (only ever the configured public address). */
  fetchZip?: (url: string) => Promise<Uint8Array | null>;
}

const NO_STORE = { "Cache-Control": "no-store" };

/** The dashboard address the extension gets. */
export function extensionOrigin(publicOrigin: string | null | undefined, requestOrigin: string): string {
  for (const candidate of [publicOrigin, requestOrigin]) {
    if (!candidate) continue;
    try {
      const url = new URL(candidate);
      if (url.protocol === "http:" || url.protocol === "https:") return url.origin;
    } catch { /* next */ }
  }
  return requestOrigin;
}

export async function extensionResponse(inputs: ExtensionInputs): Promise<Response> {
  const origin = extensionOrigin(inputs.publicOrigin, inputs.requestOrigin);
  let bytes = await inputs.readBundled().catch(() => null);
  if (!bytes && inputs.publicOrigin && inputs.fetchZip) bytes = await inputs.fetchZip(new URL(EXTENSION_ZIP, extensionOrigin(inputs.publicOrigin, inputs.requestOrigin)).href).catch(() => null);
  // A relative address: the browser resolves it against the page it's on, whatever the headers said.
  if (!bytes) return new Response(null, { status: 302, headers: { Location: EXTENSION_ZIP, ...NO_STORE } });
  let body: Uint8Array = bytes;
  try { body = personalizeExtension(bytes, origin); } catch { /* the plain file still works: the address is set in its popup */ }
  return new Response(body as unknown as BodyInit, {
    headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${EXTENSION_ZIP_NAME}"`, ...NO_STORE },
  });
}
