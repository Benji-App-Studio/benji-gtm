import fs from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

/** The newest migration this build carries, for GET /api/install's updateNeeded where the folder isn't there at run time (a hosted deployment). */
function newestMigration(): string {
  try {
    return fs.readdirSync(path.join(__dirname, "..", "supabase", "migrations")).map((file) => /^(\d{14})_[a-z0-9_]+\.sql$/.exec(file)?.[1] ?? "").filter(Boolean).sort().at(-1) ?? "";
  } catch {
    return "";
  }
}

const nextConfig: NextConfig = {
  // This folder is the whole app. Saying so stops Next guessing a wider root (and warning) when a
  // parent folder also has a package-lock.json, as the download's root does after `npm install` there.
  turbopack: { root: __dirname },
  outputFileTracingRoot: __dirname,
  env: { BUNDLED_MIGRATION_VERSION: newestMigration() },
  experimental: {
    // Pages in the app fetch their own data on the client (kept live over Realtime), so their server
    // part can be reused when switching back to them: no round trip on every click.
    staleTimes: { dynamic: 60 },
  },
};

export default nextConfig;
