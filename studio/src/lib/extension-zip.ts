// The Chrome extension's zip with this dashboard's address already in it: the extension's "Open your
// dashboard" link points at http://localhost:3000 until someone changes it in its popup, so the copy
// downloaded from Research (app/api/extension/route.ts) has that default replaced by the address it was
// downloaded from. Nothing else in the extension changes. Node only (zlib); tested in extension-zip.test.ts.
import { inflateRawSync } from "node:zlib";
import { zip, type ZipEntry } from "./zip";

/** The default the extension is built with (chrome-extension/src/protocol.ts DEFAULT_DASHBOARD_URL). */
export const BUILT_IN_DASHBOARD = "http://localhost:3000";

/** The files of a zip (folders skipped). Stored and deflated entries only, which is what `zip -r` writes. */
export function readZip(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end-of-central-directory record: the last 0x06054b50 within the final 64 KB.
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error("Not a zip file.");
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const out: ZipEntry[] = [];
  const names = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error("Broken zip directory.");
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const path = names.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;
    if (path.endsWith("/")) continue;
    if (view.getUint32(local, true) !== 0x04034b50) throw new Error("Broken zip entry.");
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + size);
    if (method === 0) out.push({ path, bytes: data.slice() });
    else if (method === 8) out.push({ path, bytes: new Uint8Array(inflateRawSync(data)) });
    else throw new Error(`Unsupported zip method ${method} for ${path}.`);
  }
  return out;
}

/** The zip again, with the built-in dashboard address in its scripts replaced by `origin`. Unchanged for that same address. */
export function personalizeExtension(bytes: Uint8Array, origin: string): Uint8Array {
  const clean = new URL(origin).origin;
  if (clean === BUILT_IN_DASHBOARD) return bytes;
  const encode = new TextEncoder();
  const decode = new TextDecoder();
  const entries = readZip(bytes).map((entry) => {
    if (!entry.path.endsWith(".js")) return entry;
    const text = decode.decode(entry.bytes);
    return text.includes(BUILT_IN_DASHBOARD) ? { ...entry, bytes: encode.encode(text.split(BUILT_IN_DASHBOARD).join(clean)) } : entry;
  });
  return zip(entries);
}
