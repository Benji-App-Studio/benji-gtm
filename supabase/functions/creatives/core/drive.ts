// Optional copy of approved creatives to a Google Drive folder, filed in subfolders the studio plans
// (<awareness level or format>/<creative>/, studio/src/lib/export-paths.ts): `folder` finds or creates
// each level once per client, and files get the studio's readable names.
//
// What it needs (not set up yet):
//   1. A Google Cloud project with the Drive API enabled, and a service account in it
//      (IAM → Service accounts → Keys → JSON key). Store the whole JSON as the edge function secret
//      GOOGLE_SERVICE_ACCOUNT_JSON.
//   2. A Drive folder shared with the service account's email as Editor (a folder in a Shared Drive
//      works best: files a service account creates in someone's My Drive count against the
//      service account, which has no storage of its own).
//   3. The folder's id (the last part of its URL) in the workspace's connections:
//      connections.storage.driveFolderId. The studio copies it onto each batch.
// OAuth on behalf of a person would also work, but needs a consent screen and refresh-token
// storage; the service account is simpler for an internal tool.
//
// The token exchange is the standard service-account JWT grant (RS256), scope drive: a service
// account only ever sees what is shared with it, and drive.file would hide a shared folder it didn't create.

export interface ServiceAccount { client_email: string; private_key: string; token_uri?: string }

const b64url = (bytes: Uint8Array | string) => {
  const raw = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  let s = "";
  for (const b of raw) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

function pemToDer(pem: string): ArrayBuffer {
  const body = atob(pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""));
  const out = new Uint8Array(new ArrayBuffer(body.length));
  for (let i = 0; i < body.length; i++) out[i] = body.charCodeAt(i);
  return out.buffer;
}

/** A signed JWT asking for a Drive token (exported for tests). */
export async function signedAssertion(account: ServiceAccount, now = Math.floor(Date.now() / 1000)): Promise<string> {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({
    iss: account.client_email, scope: "https://www.googleapis.com/auth/drive",
    aud: account.token_uri ?? "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  }));
  const key = await crypto.subtle.importKey("pkcs8", pemToDer(account.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claims}`)));
  return `${header}.${claims}.${b64url(signature)}`;
}

const FOLDER_MIME = "application/vnd.google-apps.folder";
/** A value inside a Drive query's single quotes. */
export const driveQuote = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

export function driveClient(account: ServiceAccount, fetchImpl: typeof fetch = fetch) {
  let token: { value: string; until: number } | null = null;
  async function accessToken() {
    if (token && token.until > Date.now() + 60_000) return token.value;
    const response = await fetchImpl(account.token_uri ?? "https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: await signedAssertion(account) }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(`Google token: ${data.error_description ?? data.error ?? response.status}`);
    token = { value: data.access_token, until: Date.now() + (data.expires_in ?? 3600) * 1000 };
    return token.value;
  }
  const authed = async () => ({ Authorization: `Bearer ${await accessToken()}` });
  const folders = new Map<string, Promise<string>>();
  async function folderIn(parentId: string, name: string): Promise<string> {
    const q = `name = '${driveQuote(name)}' and '${driveQuote(parentId)}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`;
    const found = await fetchImpl(`https://www.googleapis.com/drive/v3/files?${new URLSearchParams({ q, fields: "files(id)", pageSize: "1", supportsAllDrives: "true", includeItemsFromAllDrives: "true" })}`, { headers: await authed() });
    const list = await found.json();
    if (!found.ok) throw new Error(`Drive folder lookup: ${list.error?.message ?? found.status}`);
    if (list.files?.[0]?.id) return list.files[0].id as string;
    const made = await fetchImpl("https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id", {
      method: "POST",
      headers: { ...(await authed()), "Content-Type": "application/json" },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
    });
    const data = await made.json();
    if (!made.ok) throw new Error(`Drive folder: ${data.error?.message ?? made.status}`);
    return data.id as string;
  }
  return {
    /**
     * The folder at `path` under `rootId` (["L2-problem-aware", "ten-products-v01"]), each level found
     * by name or created; remembered for this client, so a batch of files makes each folder once.
     */
    folder(rootId: string, path: string[]): Promise<string> {
      let parent: Promise<string> = Promise.resolve(rootId);
      for (let i = 0; i < path.length; i++) {
        const key = `${rootId}/${path.slice(0, i + 1).join("/")}`;
        const before = parent;
        const next = folders.get(key) ?? before.then((id) => folderIn(id, path[i]));
        folders.set(key, next);
        next.catch(() => folders.delete(key));
        parent = next;
      }
      return parent;
    },
    /** Uploads one file into `folderId`; returns the Drive file id. */
    async upload(folderId: string, name: string, mime: string, bytes: Uint8Array): Promise<string> {
      const boundary = `radar-${crypto.randomUUID()}`;
      const meta = JSON.stringify({ name, parents: [folderId] });
      const head = new TextEncoder().encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`);
      const tail = new TextEncoder().encode(`\r\n--${boundary}--`);
      const payload = new Uint8Array(new ArrayBuffer(head.length + bytes.length + tail.length));
      payload.set(head, 0); payload.set(bytes, head.length); payload.set(tail, head.length + bytes.length);
      const response = await fetchImpl("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id", {
        method: "POST",
        headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": `multipart/related; boundary=${boundary}` },
        body: payload,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(`Drive upload: ${data.error?.message ?? response.status}`);
      return data.id as string;
    },
  };
}
