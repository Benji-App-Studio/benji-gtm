// Deploys the edge functions through the Management API. A function is sent as its source files: the
// entry file, every file it reaches through relative imports (research imports ../radar/engine/*,
// several import ../_shared/*), and its deno.json import map. File names are the paths from the
// download's root, exactly as the Supabase CLI sends them, so the imports resolve on the platform.
import type { ManagementApi } from "./management-api";
import { ProvisionError, type Emit, type RepoFiles } from "./types";

export const FUNCTIONS_DIR = "supabase/functions";
export const FUNCTION_NAMES = ["radar", "research", "creatives", "launch", "metrics", "insight", "install"] as const;

export interface FunctionBundle {
  slug: string;
  entrypointPath: string;
  importMapPath: string;
  /** Source paths from the download's root, entry file first. */
  paths: string[];
  /** Relative imports that point at a file that isn't there (the platform reports these when it bundles). */
  missing: string[];
}

// `from "x"`, `import "x"` and `import("x")`. Only relative specifiers are followed; anything else
// (npm:, jsr:, a name from the import map) is resolved by the platform.
const SPECIFIER = /\b(?:from|import)\s*\(?\s*["']([^"'\n]+)["']/g;

/** Joins a relative import onto the importing file's folder, without ever leaving the root. */
export function resolveImport(fromPath: string, specifier: string): string | null {
  const parts = fromPath.split("/").slice(0, -1);
  for (const part of specifier.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(part);
  }
  return parts.join("/");
}

/** The relative imports written in one source file. */
export function relativeImports(source: string): string[] {
  const found = new Set<string>();
  for (const match of source.matchAll(SPECIFIER)) {
    const specifier = match[1].trim();
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && /\.[a-z]+$/i.test(specifier)) found.add(specifier);
  }
  return [...found];
}

/** Follows a function's relative imports and lists every file it needs. */
export async function collectFunctionFiles(files: RepoFiles, slug: string): Promise<FunctionBundle> {
  const entrypointPath = `${FUNCTIONS_DIR}/${slug}/index.ts`;
  if (!(await files.exists(entrypointPath))) {
    throw new ProvisionError("function_missing", `The "${slug}" backend function is missing from this download. Download the app again and keep the folder as it is.`, { detail: `${entrypointPath} not found` });
  }
  const importMap = `${FUNCTIONS_DIR}/${slug}/deno.json`;
  const importMapPath = (await files.exists(importMap)) ? importMap : "";
  const seen = new Set<string>([entrypointPath]);
  const paths = [entrypointPath];
  const missing: string[] = [];
  const queue = [entrypointPath];
  while (queue.length) {
    const current = queue.shift() as string;
    for (const specifier of relativeImports(await files.readText(current))) {
      const target = resolveImport(current, specifier);
      if (!target || !target.startsWith(`${FUNCTIONS_DIR}/`)) {
        throw new ProvisionError("import_outside", `The "${slug}" backend function uses a file outside the functions folder, so it can't be installed.`, { detail: `${current} imports ${specifier}` });
      }
      if (seen.has(target)) continue;
      seen.add(target);
      if (await files.exists(target)) { paths.push(target); queue.push(target); }
      else missing.push(`${current} imports ${specifier}`);
    }
  }
  return { slug, entrypointPath, importMapPath, paths, missing };
}

/**
 * Deploys the functions one after another with the gateway's JWT check off: each function checks its
 * caller itself, and the scheduled jobs call without a person's session. Deploying again replaces
 * the function, so this is safe to repeat.
 */
export async function deployFunctions(api: ManagementApi, files: RepoFiles, ref: string, emit: Emit, names: readonly string[] = FUNCTION_NAMES): Promise<string[]> {
  // Collect every function first, so a missing file stops the step before anything is deployed.
  const bundles: FunctionBundle[] = [];
  for (const slug of names) bundles.push(await collectFunctionFiles(files, slug));
  const deployed: string[] = [];
  for (const bundle of bundles) {
    emit({ step: "functions", status: "running", message: `Installing backend function ${deployed.length + 1} of ${bundles.length}.`, detail: `${bundle.slug}: ${bundle.paths.length} files`, progress: { done: deployed.length, total: bundles.length } });
    const sources = [...bundle.paths, ...(bundle.importMapPath ? [bundle.importMapPath] : [])];
    const uploads: { path: string; bytes: Uint8Array }[] = [];
    for (const path of sources) uploads.push({ path, bytes: await files.readBytes(path) });
    try {
      await api.deployFunction(ref, { slug: bundle.slug, entrypointPath: bundle.entrypointPath, importMapPath: bundle.importMapPath, verifyJwt: false, files: uploads });
    } catch (error) {
      if (error instanceof ProvisionError) {
        const hint = bundle.missing.length ? ` Missing: ${bundle.missing.join("; ")}.` : "";
        throw new ProvisionError(error.code, error.status === 400 ? `Supabase couldn't build the "${bundle.slug}" backend function. Press Retry; if it fails again, send us the technical detail below.` : error.message, { detail: `${error.detail ?? ""}${hint}`, status: error.status });
      }
      throw error;
    }
    deployed.push(bundle.slug);
  }
  emit({ step: "functions", status: "done", message: `Installed ${deployed.length} backend functions.`, detail: deployed.join(", "), progress: { done: deployed.length, total: bundles.length } });
  return deployed;
}
