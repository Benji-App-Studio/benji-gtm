#!/usr/bin/env node
// Prepares a Supabase project for this app from a terminal: the same steps the /setup page runs
// (studio/src/lib/server/provision). Use it when the page can't finish, or to test a fresh project.
//
//   node scripts/provision.mjs --dry-run
//   SUPABASE_ACCESS_TOKEN=... node scripts/provision.mjs --list
//   SUPABASE_ACCESS_TOKEN=... node scripts/provision.mjs --project <ref> --owner-email you@example.com
//   SUPABASE_ACCESS_TOKEN=... node scripts/provision.mjs --adopt --project <ref> --dry-run     an existing install
//   node scripts/provision.mjs --reset-password --project <ref>      a forgotten password, no email needed
//
// The access token is read from SUPABASE_ACCESS_TOKEN (or asked for), used for this run and not saved.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
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
  --owner-password <text>  Its password. Better: set OWNER_PASSWORD. Left out, a strong password is
                           made up and saved on this computer for automatic sign-in (it is never
                           shown; choose your own later in Settings > Account).
  --app-origin <url>       Where the app runs. Default: http://localhost:3000
  --functions <a,b,c>      Install only these backend functions.
  --steps <a,b,c>          Run only these steps: project, keys, migrations, function-urls,
                           functions, owner, storage, jobs, config.
  --no-config              Don't save the connection on this computer (for testing).
  --dry-run                Print what would be done. Calls nothing and needs no token.
  --help                   Show this text.

A forgotten password (no email needed)
  npm run provision -- --reset-password --project <ref>

  --reset-password         Sets a new password for the install's owner. Asks for the access token
                           and the new password in Terminal, hidden. Never put them in the command.
                           Saves the new password on this computer, so the app signs in by itself.
                           If the owner's account is gone, it offers to create it again.

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
  const flags = new Set(["list", "dry-run", "no-config", "help", "adopt", "reset-password", "yes", "set-function-urls", "schedule-jobs", "deploy-functions", "no-assets", "write-config"]);
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
  if (options["reset-password"]) return resetPassword(options, lib, config);

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
  let generated = false;
  if (wantsOwner && options["owner-email"]) {
    let password = options["owner-password"] ?? process.env.OWNER_PASSWORD;
    if (!password) {
      // Nobody has to remember it: it is saved on this computer, and the app signs in with it by itself.
      if (options["no-config"]) throw new Error("With --no-config nothing is saved on this computer, so give the owner's password: set OWNER_PASSWORD.");
      password = randomBytes(18).toString("base64url");
      generated = true;
    }
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
  if (!options["no-config"] && result.completed.includes("config")) {
    if (owner) {
      config.writeStoredOwner(owner);
      if (generated) console.log("A password was generated for the owner and saved for automatic sign-in on this computer. It is not shown; choose your own any time in Settings > Account.");
      console.log(`The connection is saved in ${config.installConfigPath()}. Start the app: on this computer it signs you in by itself.`);
    } else {
      console.log(`The connection is saved in ${config.installConfigPath()}. Start the app.`);
    }
  }
  return 0;
}

/**
 * `--reset-password`: a new password for the install's owner, with an access token, no email. Both are
 * typed into hidden Terminal prompts, never taken from the command line, and never printed.
 */
async function resetPassword(options, lib, config) {
  const notHere = ["owner-email", "owner-password", "steps", "list", "dry-run", "functions", "no-config"].filter((name) => name in options);
  if (notHere.length) throw new Error(`--${notHere[0]} isn't used with --reset-password. It asks for the token and the new password in Terminal.`);
  if (!options.project) throw new Error("Say which project: --reset-password --project <ref> (the 20 letters in its dashboard address).");
  if (!process.stdin.isTTY) throw new Error("Run this in Terminal: it asks for the access token and the new password there, hidden.");
  const current = config.getInstallConfig();
  if (current?.source === "env") throw new Error("This copy takes its project from environment variables, so there is nothing to save here. Reset the password from the app on your Mac instead.");
  const connected = current ? config.projectRef(current.supabaseUrl) : null;
  if (connected && connected !== options.project) throw new Error(`This computer is connected to the project ${connected}, not ${options.project}. Use --project ${connected}.`);

  console.log("Create an access token at https://supabase.com/dashboard/account/tokens and paste it below. It is used once and not saved.");
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN?.trim() || await ask("Supabase access token (hidden): ", true);
  if (!accessToken) throw new Error("No access token was given.");
  const password = await ask("New password (hidden, at least 8 characters): ", true);
  if (password.length < 8) throw new Error("Use a password with at least 8 characters.");
  if ((await ask("Type the new password again (hidden): ", true)) !== password) throw new Error("The two passwords weren't the same. Run the command again.");

  const input = { accessToken, ref: options.project, password, storedEmail: config.readStoredOwner()?.email ?? null, appOrigin: options["app-origin"] ?? lib.DEFAULT_APP_ORIGIN };
  let result;
  try {
    result = await lib.localReset(input, { fetch });
  } catch (error) {
    if (error?.code !== "no_account") throw error;
    console.log("The owner's account is no longer in your Supabase project. It can be created again; your workspace and its data stay.");
    const email = await ask("Your email: ");
    if (!lib.isEmail(email)) throw new Error("That doesn't look like an email address. Run the command again.");
    result = await lib.localReset({ ...input, recreateEmail: email }, { fetch });
  }
  if (!current) {
    const api = lib.managementApi(fetch, accessToken);
    const project = (await lib.listProjects(api)).find((candidate) => candidate.ref === options.project);
    const { plan } = await lib.detectPlan(api, project);
    config.writeInstallConfig({ supabaseUrl: lib.projectUrl(options.project), publishableKey: result.publishableKey, publicOrigin: null, imageTransforms: plan === "paid" });
    console.log(`This computer is now connected to the project (saved in ${config.installConfigPath()}).`);
  }
  config.writeStoredOwner({ email: result.email, password });
  console.log(`\nDone. ${result.recreated ? "The owner's account was created again" : "The password is changed"} for ${result.email}, and saved on this computer so the app signs you in by itself. Start the app, or reload it.`);
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
