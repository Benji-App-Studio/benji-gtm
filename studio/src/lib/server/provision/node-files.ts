// Reads the downloaded folder from disk (the injected file reading, for real runs).
import fs from "node:fs";
import path from "node:path";
import { ProvisionError, type RepoFiles } from "./types";

const hasMigrations = (root: string): boolean => {
  try { return fs.statSync(path.join(root, "supabase", "migrations")).isDirectory(); } catch { return false; }
};

/**
 * The folder that holds `supabase/` and `studio/`. The app runs from `studio/`, so it is the folder
 * above; `INSTALL_REPO_ROOT` overrides it.
 */
export function findRepoRoot(cwd: string = process.cwd()): string {
  const env = process.env;
  const override = env.INSTALL_REPO_ROOT?.trim();
  const candidates = override ? [path.resolve(override)] : [path.resolve(cwd, ".."), path.resolve(cwd)];
  const found = candidates.find(hasMigrations);
  if (found) return found;
  throw new ProvisionError("no_repo", override
    ? "The folder named in INSTALL_REPO_ROOT has no supabase/migrations folder inside it. Point it at the folder you downloaded."
    : "Couldn't find the supabase/migrations folder. Keep the downloaded folder in one piece and start the app from inside it.",
    { detail: `looked in: ${candidates.join(", ")}` });
}

export function nodeFiles(root: string): RepoFiles {
  const resolve = (relative: string): string => {
    const full = path.resolve(root, relative);
    if (full !== root && !full.startsWith(root + path.sep)) throw new ProvisionError("outside_root", "Setup tried to read a file outside the app's folder and stopped.", { detail: relative });
    return full;
  };
  return {
    async list(dir) {
      try {
        return (await fs.promises.readdir(resolve(dir), { withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
      } catch { return []; }
    },
    async exists(file) {
      try { return (await fs.promises.stat(resolve(file))).isFile(); } catch { return false; }
    },
    readText: (file) => fs.promises.readFile(resolve(file), "utf8"),
    readBytes: async (file) => new Uint8Array(await fs.promises.readFile(resolve(file))),
  };
}
