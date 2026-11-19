// The part of this install's settings the browser may know: the Supabase project URL and its
// publishable key (both public by design). The root layout writes them into the page; on the server
// lib/install/config.ts sets the same global while a request is rendered. Safe to import anywhere.

export interface PublicInstall {
  url: string;
  key: string;
  /** Where this app is reachable from the internet; null on a local run. */
  origin: string | null;
  imageTransforms: boolean;
}

/** null until setup has connected a project. */
export function publicInstall(): PublicInstall | null {
  return (globalThis as { __INSTALL__?: PublicInstall | null }).__INSTALL__ ?? null;
}

/** For the root layout's <head>: makes the settings available before any client code runs. */
export const installScript = (install: PublicInstall | null): string =>
  `window.__INSTALL__=${JSON.stringify(install).replace(/</g, "\\u003c")};`;

/** `https://<project>.supabase.co/storage/v1`, or "" before setup. */
export const storageBase = (): string => {
  const install = publicInstall();
  return install ? `${install.url}/storage/v1` : "";
};

/** The public link of a file in a public bucket. */
export const publicObjectUrl = (bucket: string, objectPath: string): string =>
  `${storageBase()}/object/public/${bucket}/${objectPath.replace(/^\/+/, "")}`;
