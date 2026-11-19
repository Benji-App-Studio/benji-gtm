#!/usr/bin/env node
// Prepares a Supabase project for this app from a terminal: the same steps the /setup page runs
// (studio/src/lib/server/provision). Use it when the page can't finish, or to test a fresh project.
//
//   node scripts/provision.mjs --dry-run
//   SUPABASE_ACCESS_TOKEN=... node scripts/provision.mjs --list
//   SUPABASE_ACCESS_TOKEN=... node scripts/provision.mjs --project <ref> --owner-email you@example.com
//   SUPABASE_ACCESS_TOKEN=... node scripts/provision.mjs --adopt --project <ref> --dry-run     an existing install
//
// The access token is read from SUPABASE_ACCESS_TOKEN (or asked for), used for this run and not saved.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const HELP = `Prepares a Supabase project for the app from Terminal: the same steps the setup page runs.
Most people never need it. Use it when the setup page can't finish.

Before the first use, run this once in the app's folder (the one that contains start.command):
  npm install

Usage
  node scripts/provision.mjs --dry-run
  SUPABASE_ACCESS_TOKEN=<token> node scripts/provision.mjs --list
  SUPABASE_ACCESS_TOKEN=<token> node scripts/provision.mjs --project <ref> --owner-email <email>

Options
  --project <ref>          The project to prepare: the 20 letters in its dashboard address.
  --list                   Show the projects the token can see, then stop.
  --owner-email <email>    The account that will own this install.
  --owner-password <text>  Its password. Better: set OWNER_PASSWORD, or leave it out to be asked.
  --app-origin <url>       Where the app runs. Default: http://localhost:3000
  --functions <a,b,c>      Install only these backend functions.
  --steps <a,b,c>          Run only these steps: project, keys, migrations, function-urls,
                           functions, owner, storage, jobs, config.
  --no-config              Don't save the connection on this computer (for testing).
  --dry-run                Print what would be done. Calls nothing and needs no token.
  --help                   Show this text.

Adopting an install that already exists (docs/ADOPTING-AN-EXISTING-INSTALL.md)
  SUPABASE_ACCESS_TOKEN=<token> node scripts/provision.mjs --adopt --project <ref> --dry-run
  SUPABASE_ACCESS_TOKEN=<token> node scripts/provision.mjs --adopt --project <ref> [--owner-email <email>]

  --adopt                  For a database built by hand from these migrations before the ledger
                           existed. Checks it is this app's database, records the migrations it
                           already has (without running them) and applies only newer ones.
                           With --dry-run it reads and reports, and changes nothing.
  --owner-email <email>    An account that already exists becomes the owner. No account is created
                           and no password is changed. Without it the install stays in its old mode.
  --members all            Every other existing account becomes a member.
  --yes                    Go on although other accounts will lose access.
  --set-function-urls      Rewrite the stored function addresses (they are left alone otherwise).
  --schedule-jobs          Turn on the optional scheduled jobs.
  --deploy-functions       Deploy the edge functions (all, or those named with --functions).
  --no-assets              Don't copy the Style Library images.
  --write-config           Save the connection on this computer.

The access token comes from SUPABASE_ACCESS_TOKEN, or you are asked for it. Create one at
https://supabase.com/dashboard/account/tokens and delete it there when you are done.
It is used for this run and is not saved.

Try --dry-run first: it only prints the plan. If a real run stops, run the same command again:
finished steps are skipped.`;

function parseArgs(argv) {
  const flags = new Set(["list", "dry-run", "no-config", "help", "adopt", "yes", "set-function-urls", "schedule-jobs", "deploy-functions", "no-assets", "write-config"]);
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) throw new Error(`Didn't understand "${arg}". Run with --help to see the options.`);
    const [name, inline] = arg.slice(2).split(/=(.*)/s, 2);
    if (flags.has(name)) { options[name] = true; continue; }
    const value = inline ?? argv[index + 1];
    if (value === undefined || (inline === undefined && value.startsWith("--"))) throw new Error(`--${name} needs a value.`);
    if (inline === undefined) index += 1;
    options[name] = value;
  }
  return options;
}

/** Asks a question on the terminal; a hidden answer isn't echoed. */
function ask(question, hidden = false) {
  if (!process.stdin.isTTY) return Promise.resolve("");
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;
    const write = rl._writeToOutput?.bind(rl);
    if (hidden && write) rl._writeToOutput = (text) => { if (!muted) write(text); };
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer.trim());
    });
    muted = hidden;
  });
}

/**
 * The library is TypeScript, so this script starts itself once more with the `tsx` loader (already
 * installed by `npm install`) and does the work there.
 */
function restartWithTypeScript() {
  try {
    createRequire(import.meta.url).resolve("tsx");
  } catch {
    throw new Error("One-time setup is missing. Run `npm install` in this folder, then try again.");
  }
  const child = spawnSync(process.execPath, ["--import", "tsx", fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    stdio: "inherit", cwd: ROOT, env: { ...process.env, PROVISION_WITH_TSX: "1" },
  });
  return child.status ?? 1;
}

async function loadLibrary() {
  // The studio's TypeScript files load as CommonJS, so each arrives as a default export.
  const load = async (file) => {
    const module = await import(pathToFileURL(path.join(ROOT, file)).href);
    return module.default ?? module;
  };
  return { lib: await load("studio/src/lib/server/provision/index.ts"), config: await load("studio/src/lib/install/config.ts") };
}

const list = (value) => (value ? String(value).split(",").map((item) => item.trim()).filter(Boolean) : undefined);

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { console.log(HELP); return 0; }
  if (process.env.PROVISION_WITH_TSX !== "1") return restartWithTypeScript();
  const { lib, config } = await loadLibrary();
  const files = lib.nodeFiles(lib.findRepoRoot(path.join(ROOT, "studio")));
  const steps = list(options.steps);
  const functions = list(options.functions);
  const unknown = (steps ?? []).filter((step) => !lib.STEP_IDS.includes(step));
  if (unknown.length) throw new Error(`Unknown step: ${unknown.join(", ")}. The steps are: ${lib.STEP_IDS.join(", ")}.`);

  const adoptOnly = ["members", "yes", "set-function-urls", "schedule-jobs", "deploy-functions", "no-assets", "write-config"].filter((name) => name in options);
  if (!options.adopt && adoptOnly.length) throw new Error(`--${adoptOnly[0]} only works together with --adopt. Run with --help to see the options.`);
  if (options.adopt) return adoptInstall(options, lib, config, files, functions);

  if (options["dry-run"]) {
    const plan = await lib.planProvision(files, { steps, functions, ref: options.project });
    const target = options.project ? `https://${options.project}.supabase.co` : "https://<your project>.supabase.co";
    console.log(`Dry run. Nothing is called and nothing is changed.\n\nTarget: ${target}\n`);
    console.log(`Steps, in order:\n${plan.steps.map((step, index) => `  ${index + 1}. ${lib.STEP_LABELS[step]} (${step})`).join("\n")}\n`);
    console.log(`Database changes: ${plan.migrations.length} files, each applied once and recorded in public.install_migrations.`);
    for (const migration of plan.migrations) console.log(`  ${migration.file}${migration.retargeted ? "   (its stored function address is replaced with the target's)" : ""}`);
    console.log(`\nBackend functions (JWT check off; each function checks its caller itself):`);
    for (const fn of plan.functions) {
      console.log(fn.error ? `  ${fn.slug}: NOT READY. ${fn.error}` : `  ${fn.slug}: ${fn.files.length} files`);
      for (const file of fn.files) console.log(`      ${file}`);
      for (const missing of fn.missing) console.log(`      missing: ${missing}`);
    }
    console.log(`\nStyle Library images copied to the app-assets bucket: ${plan.assets.length}`);
    console.log(`\nOwner: ${options["owner-email"] ?? "(none given: the owner step would be skipped)"}`);
    console.log(`Local config: ${options["no-config"] ? "not written (--no-config)" : config.installConfigPath()}`);
    return plan.functions.some((fn) => fn.error) ? 1 : 0;
  }

  const accessToken = process.env.SUPABASE_ACCESS_TOKEN?.trim() || await ask("Supabase access token (hidden): ", true);
  if (!accessToken) throw new Error("Set SUPABASE_ACCESS_TOKEN to a Supabase access token (https://supabase.com/dashboard/account/tokens).");

  if (options.list) {
    const projects = await lib.listProjects(lib.managementApi(fetch, accessToken));
    if (!projects.length) console.log("This token can't see any project. Create one at https://supabase.com/dashboard/new");
    for (const project of projects) console.log(`${project.ref}  ${project.name}  (${project.region}, ${project.status})`);
    return 0;
  }

  if (!options.project) throw new Error("Say which project: --project <ref>. Run with --list to see your projects.");
  const wantsOwner = !steps || steps.includes("owner");
  let owner;
  if (wantsOwner && options["owner-email"]) {
    const password = options["owner-password"] ?? process.env.OWNER_PASSWORD ?? await ask(`Password for ${options["owner-email"]} (hidden, at least 8 characters): `, true);
    if (!password) throw new Error("A password is needed for the owner account. Set OWNER_PASSWORD, or run this in a terminal to be asked.");
    owner = { email: options["owner-email"], password };
  } else if (wantsOwner && steps) {
    throw new Error("The owner step needs --owner-email.");
  }

  const marks = { running: "..", done: "ok", skipped: "--", failed: "!!" };
  const result = await lib.provision(
    { accessToken, ref: options.project, steps, owner, functions, appOrigin: options["app-origin"] },
    { fetch, files, writeConfig: options["no-config"] ? undefined : config.writeInstallConfig },
    (event) => {
      console.log(`[${marks[event.status]}] ${event.step}: ${event.message}`);
      if (event.detail && event.status !== "running") console.log(`     ${event.detail}`);
    },
  );
  if (!result.ok) {
    console.error(`\nStopped at "${result.failed.step}". ${result.failed.message}\nIt is safe to run the same command again: finished steps are skipped.`);
    return 1;
  }
  console.log(`\nDone. ${result.project.name} (${result.supabaseUrl}) is ready on the ${result.plan} plan.`);
  if (!owner) console.log("No owner account was created. Run again with --owner-email to create it.");
  if (!options["no-config"] && result.completed.includes("config")) console.log(`The connection is saved in ${config.installConfigPath()}. Start the app and sign in.`);
  return 0;
}

/** `--adopt`: an install that already exists is brought under the ledger, changing as little as asked. */
async function adoptInstall(options, lib, config, files, functions) {
  const notHere = ["owner-password", "steps", "no-config", "app-origin", "list"].filter((name) => name in options);
  if (notHere.length) throw new Error(`--${notHere[0]} isn't used with --adopt. Adoption never creates an account, and it writes the local config only with --write-config.`);
  if (!options.project) throw new Error("Say which project to adopt: --adopt --project <ref>.");
  if ("members" in options && options.members !== "all") throw new Error("--members takes one value: all.");
  const dryRun = Boolean(options["dry-run"]);
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN?.trim() || await ask("Supabase access token (hidden): ", true);
  if (!accessToken) throw new Error("Set SUPABASE_ACCESS_TOKEN to a Supabase access token (https://supabase.com/dashboard/account/tokens). A dry run needs it too: it reads the project.");

  console.log(dryRun
    ? `Dry run of adopting ${options.project}. It reads the project and changes nothing.\n`
    : `Adopting ${options.project}.\n`);
  const marks = { running: "..", done: "ok", skipped: "--", failed: "!!", planned: "->" };
  const result = await lib.adopt(
    {
      accessToken, ref: options.project, dryRun,
      ownerEmail: options["owner-email"], members: options.members, yes: Boolean(options.yes),
      setFunctionUrls: Boolean(options["set-function-urls"]), scheduleJobs: Boolean(options["schedule-jobs"]),
      deployFunctions: Boolean(options["deploy-functions"]), functions,
      assets: !options["no-assets"], writeConfig: Boolean(options["write-config"]),
    },
    { fetch, files, writeConfig: config.writeInstallConfig },
    (event) => {
      console.log(`[${marks[event.status]}] ${lib.ADOPT_STEP_LABELS[event.step]}: ${event.message}`);
      if (event.detail && event.status !== "running") console.log(`     ${event.detail}`);
    },
  );
  if (!result.ok) {
    console.error(`\nStopped at "${lib.ADOPT_STEP_LABELS[result.failed.step]}". ${result.failed.message}`);
    if (result.failed.code === "confirm_members") console.error(`These accounts would lose access:\n${result.losingAccess.map((account) => `  ${account.email ?? account.id}`).join("\n")}`);
    if (!dryRun) console.error("Steps that finished stay done. It is safe to run the same command again.");
    return 1;
  }
  console.log(dryRun
    ? "\nDry run finished. Nothing was changed. Run the same command without --dry-run to do the steps marked ->."
    : `\nDone. ${result.recorded.length ? `${result.recorded.length} migrations recorded as already applied, ` : ""}${result.applied.length} newer ${result.applied.length === 1 ? "migration" : "migrations"} applied.`);
  if (result.oldMode) console.log("The install has no owner, so it works as before: keys from edge function secrets, allow-lists for Launch and Measure.");
  return 0;
}

main().then((code) => { process.exitCode = code; }, (error) => {
  console.error(error?.message ?? String(error));
  process.exitCode = 1;
});
