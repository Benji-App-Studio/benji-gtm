// Where this install's Supabase project is. A hosted deployment sets environment variables; a copy
// run on someone's own machine has none, so the setup wizard writes a small local file instead.
// Environment variables win, so a deployment never depends on the file.
//
// Nothing secret lives here: the project URL and its publishable key are what the browser uses anyway.
// API keys are stored in the project's Vault (Settings > API keys), never on this machine.
//
// Node `fs` only (no next/headers), so proxy.ts can import it. The file lives outside the app folder,
// so the bundler is told not to trace these reads (the turbopackIgnore comments).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PublicInstall } from "./public";

export interface InstallConfig {
  supabaseUrl: string;
  publishableKey: string;
  /** Where this app is reachable from the internet (a deployed copy); null on a local run. */
  publicOrigin: string | null;
  /** Supabase resizes stored images only on paid plans; off, pages show the originals. */
  imageTransforms: boolean;
  source: "env" | "file";
}

/** Read by name at run time. `process.env.NEXT_PUBLIC_X` written out in full is replaced at build time. */
const readEnv = (name: string): string | undefined => {
  const env = process.env;
  const value = env[name];
  return value && value.trim() ? value.trim() : undefined;
};

const trimSlash = (value: string) => value.replace(/\/+$/, "");

/** The local file: outside the app folder, so updating or re-cloning the code keeps it. */
export const installConfigPath = (): string =>
  readEnv("INSTALL_CONFIG_PATH") ?? path.join(os.homedir(), ".gtm-install", "config.json");

const isSupabaseUrl = (value: unknown): value is string => typeof value === "string" && /^https?:\/\/[^\s/]+$/.test(trimSlash(value));

function fromEnv(): InstallConfig | null {
  const supabaseUrl = readEnv("NEXT_PUBLIC_SUPABASE_URL") ?? readEnv("SUPABASE_URL");
  const publishableKey = readEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") ?? readEnv("SUPABASE_PUBLISHABLE_KEY");
  if (!supabaseUrl || !publishableKey || !isSupabaseUrl(supabaseUrl)) return null;
  // On Vercel the production address is known without setting anything.
  const vercel = readEnv("VERCEL_PROJECT_PRODUCTION_URL");
  const origin = readEnv("NEXT_PUBLIC_PUBLIC_ORIGIN") ?? readEnv("PUBLIC_ORIGIN") ?? (vercel ? `https://${vercel}` : undefined);
  return {
    supabaseUrl: trimSlash(supabaseUrl),
    publishableKey,
    publicOrigin: origin ? trimSlash(origin) : null,
    imageTransforms: readEnv("SUPABASE_IMAGE_TRANSFORMS") !== "0",
    source: "env",
  };
}

let cached: { mtimeMs: number; file: string; config: InstallConfig | null } | null = null;

function fromFile(): InstallConfig | null {
  const file = installConfigPath();
  let mtimeMs: number;
  try { mtimeMs = fs.statSync(/*turbopackIgnore: true*/ file).mtimeMs; } catch { cached = null; return null; }
  if (cached && cached.file === file && cached.mtimeMs === mtimeMs) return cached.config;
  let config: InstallConfig | null = null;
  try {
    const raw = JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ file, "utf8")) as Record<string, unknown>;
    if (isSupabaseUrl(raw.supabaseUrl) && typeof raw.publishableKey === "string" && raw.publishableKey) {
      config = {
        supabaseUrl: trimSlash(raw.supabaseUrl),
        publishableKey: raw.publishableKey,
        publicOrigin: typeof raw.publicOrigin === "string" && raw.publicOrigin ? trimSlash(raw.publicOrigin) : null,
        imageTransforms: raw.imageTransforms === true,
        source: "file",
      };
    }
  } catch { config = null; }
  cached = { mtimeMs, file, config };
  return config;
}

/** This install's Supabase project, or null when setup hasn't been done yet. */
export function getInstallConfig(): InstallConfig | null {
  const config = fromEnv() ?? fromFile();
  // Shared code that also runs in the browser (lib/install/public.ts) reads this while rendering.
  (globalThis as { __INSTALL__?: PublicInstall | null }).__INSTALL__ = config ? toPublic(config) : null;
  return config;
}

/** The same, for code that can't do anything without it. */
export function requireInstallConfig(): InstallConfig {
  const config = getInstallConfig();
  if (!config) throw new NotSetUpError();
  return config;
}

export class NotSetUpError extends Error {
  constructor() { super("This install isn't set up yet. Open /setup to connect a Supabase project."); }
}

export const toPublic = (config: InstallConfig): PublicInstall => ({
  url: config.supabaseUrl,
  key: config.publishableKey,
  origin: config.publicOrigin,
  imageTransforms: config.imageTransforms,
});

/** Written by the setup wizard once a project is connected and provisioned. Owner-readable only. */
export function writeInstallConfig(input: { supabaseUrl: string; publishableKey: string; publicOrigin?: string | null; imageTransforms?: boolean }): void {
  if (!isSupabaseUrl(input.supabaseUrl) || !input.publishableKey) throw new Error("A project URL and its publishable key are both needed.");
  const file = installConfigPath();
  fs.mkdirSync(/*turbopackIgnore: true*/ path.dirname(file), { recursive: true, mode: 0o700 });
  const body = {
    supabaseUrl: trimSlash(input.supabaseUrl),
    publishableKey: input.publishableKey,
    publicOrigin: input.publicOrigin ? trimSlash(input.publicOrigin) : null,
    imageTransforms: input.imageTransforms === true,
  };
  fs.writeFileSync(/*turbopackIgnore: true*/ file, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
  cached = null;
}

/** The project's reference (the first label of its URL), e.g. "abcdefghijklmnopqrst". */
export const projectRef = (supabaseUrl: string): string | null => /^https:\/\/([a-z0-9]{15,30})\.supabase\.co$/.exec(trimSlash(supabaseUrl))?.[1] ?? null;
