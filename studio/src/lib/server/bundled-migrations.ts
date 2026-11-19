import "server-only";
// The newest migration this copy of the app carries: read from supabase/migrations next to the studio
// when the app runs from its folder (so a `git pull` that only adds a migration is seen without a
// rebuild), else the version next.config.ts read at build time (a hosted deployment has no folder).
import fs from "node:fs";
import path from "node:path";
import { newestMigration } from "@/lib/install/update-needed";

export function bundledMigration(cwd: string = process.cwd()): string | null {
  const override = process.env.INSTALL_REPO_ROOT?.trim();
  const roots = override ? [path.resolve(override)] : [path.resolve(cwd, ".."), path.resolve(cwd)];
  for (const root of roots) {
    try {
      const found = newestMigration(fs.readdirSync(path.join(root, "supabase", "migrations")));
      if (found) return found;
    } catch { /* not this folder */ }
  }
  const built = process.env.BUNDLED_MIGRATION_VERSION;
  return built && /^\d{14}$/.test(built) ? built : null;
}
