#!/usr/bin/env node
// npm run update: brings this copy of Benji GTM up to date with the original repository,
// https://github.com/Benji-App-Studio/benji-gtm.
//
// It works for every kind of copy:
//   - a fork (the same history as the original): a normal merge;
//   - a copy made with "Use this template" (GitHub gives it one fresh commit, unrelated to the
//     original's history): the first run finds the original's version that copy was made from (the
//     one with exactly the same files) and records it as already merged, so only what changed since
//     is brought in, and every later run is a normal merge;
//   - a plain clone of the original.
//
// It never pushes and never throws your work away. When an update can't be merged by itself it stops,
// says which files clash, and `git merge --abort` puts everything back as it was.
//
//   npm run update
//   npm run update -- --from <address or folder>   pull from somewhere else (the tests use a folder)
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ORIGINAL = "https://github.com/Benji-App-Studio/benji-gtm";
const BRANCH = "main";
const TRACKING = "refs/remotes/upstream/main";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const fromFlag = argv.indexOf("--from");
const from = fromFlag >= 0 ? argv[fromFlag + 1] : null;
if (fromFlag >= 0 && !from) stop("--from needs an address or a folder.");

/** Runs git in the app's folder. Merge commits get a stand-in author when git has none set up. */
function git(args) {
  const env = { ...process.env };
  if (!gitConfig("user.email")) Object.assign(env, { GIT_AUTHOR_NAME: "Update", GIT_AUTHOR_EMAIL: "update@localhost", GIT_COMMITTER_NAME: "Update", GIT_COMMITTER_EMAIL: "update@localhost" });
  const run = spawnSync("git", args, { cwd: ROOT, encoding: "utf8", env, stdio: "pipe" });
  if (run.error) stop("Git is not installed on this Mac.\nWhat to do: run  xcode-select --install  in Terminal, accept the window that opens, wait for it to finish, then run  npm run update  again.");
  return { ok: run.status === 0, out: (run.stdout ?? "").trimEnd(), err: (run.stderr ?? "").trim() };
}
function gitConfig(name) {
  const run = spawnSync("git", ["config", "--get", name], { cwd: ROOT, encoding: "utf8" });
  return run.status === 0 ? run.stdout.trim() : "";
}
function stop(message) {
  console.error(`\nThe update did not run: ${message}\n`);
  process.exit(1);
}
/** "git@github.com:Owner/Repo.git", "https://github.com/Owner/Repo" -> "owner/repo". */
const sameRepo = (a, b) => {
  const norm = (url) => url.trim().replace(/\/+$/, "").replace(/\.git$/, "")
    .replace(/^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?[^/]+\//i, "").replace(/^[^@/]+@[^:/]+:/, "").toLowerCase();
  return norm(a) === norm(b);
};

// 1. A git copy with nothing unsaved
if (!git(["rev-parse", "--is-inside-work-tree"]).ok) {
  stop(`this folder is not a git copy, so there is nothing to update with git.
What to do: make your copy on GitHub and clone it as README.md describes ("Make your own copy"), then start that folder instead.`);
}
if (git(["rev-parse", "-q", "--verify", "MERGE_HEAD"]).ok) {
  stop(`an earlier update is still half done.
What to do: either finish it (ask your coding agent to resolve the clashing files and commit), or undo it with
  git merge --abort
then run  npm run update  again.`);
}
const unsaved = git(["status", "--porcelain", "--untracked-files=no"]).out;
if (unsaved) {
  stop(`some files have changes that are not saved in git yet:
${unsaved.split("\n").map((line) => `  ${line.slice(3)}`).join("\n")}
What to do: save them first with these two commands (or ask your coding agent to commit them):
  git add -A
  git commit -m "My changes"
then run  npm run update  again.`);
}

// 2. Fetch the original's latest version
let source = from;
if (!source) {
  const remotes = git(["remote", "-v"]).out.split("\n").map((line) => line.split(/\s+/)).filter((parts) => parts[2] === "(fetch)");
  const known = remotes.find(([, url]) => sameRepo(url, ORIGINAL));
  if (known) source = known[0];
  else if (remotes.some(([name]) => name === "upstream")) {
    stop(`this copy already has a remote called "upstream" that points somewhere else.
What to do: check it with  git remote -v . If it should be the original, run
  git remote set-url upstream ${ORIGINAL}.git
then run  npm run update  again.`);
  } else {
    git(["remote", "add", "upstream", `${ORIGINAL}.git`]);
    source = "upstream";
    console.log(`Added the original as "upstream": ${ORIGINAL}`);
  }
}
console.log(`Getting the latest version of Benji GTM…`);
const fetched = git(["fetch", "--no-tags", source, `+refs/heads/${BRANCH}:${TRACKING}`]);
if (!fetched.ok) stop(`the original could not be reached.\nWhat to do: check that this Mac is online, then run  npm run update  again.\n\nGit said: ${fetched.err}`);

if (git(["merge-base", "--is-ancestor", TRACKING, "HEAD"]).ok) {
  console.log("\nAlready up to date. Nothing to do.\n");
  process.exit(0);
}

// 3. A template copy: connect it to the original's history once
if (!git(["merge-base", "HEAD", TRACKING]).ok) {
  const firstTrees = git(["rev-list", "--max-parents=0", "HEAD"]).out.split("\n").filter(Boolean)
    .map((commit) => git(["rev-parse", `${commit}^{tree}`]).out);
  const match = git(["log", "--format=%H %T", TRACKING]).out.split("\n").map((line) => line.split(" "))
    .find(([, tree]) => firstTrees.includes(tree));
  if (!match) {
    stop(`this copy's first version does not match any version of the original, so it can't be updated automatically.
This happens when files were changed in the very first commit of the copy.
What to do: ask your coding agent to merge ${ORIGINAL} into this copy, or ask the course team for help.`);
  }
  const joined = git(["merge", "-s", "ours", "--allow-unrelated-histories", "--no-edit", "-m", "Connect this copy to the original's history", match[0]]);
  if (!joined.ok) stop(`connecting this copy to the original's history did not work.\n\nGit said: ${joined.err || joined.out}`);
  console.log("Connected this copy to the original's history (first update only).");
}

// 4. Merge
const before = git(["rev-parse", "HEAD"]).out;
const merged = git(["merge", "--no-edit", "-m", "Update from the original", TRACKING]);
if (!merged.ok) {
  const clashes = git(["diff", "--name-only", "--diff-filter=U"]).out;
  if (!clashes) {
    git(["merge", "--abort"]);
    stop(`git could not merge the update.\n\nGit said: ${merged.err || merged.out}`);
  }
  console.error(`
The update is half done: these files were changed both by you and in the original, and git can't
choose between the two versions by itself:
${clashes.split("\n").map((file) => `  ${file}`).join("\n")}

Nothing is lost. Choose one:
  - Undo the update and put everything back as it was:
      git merge --abort
  - Or let your coding agent finish it: ask it to "resolve the merge conflicts from npm run update,
    keeping my changes where they still make sense, then commit".
See "If you changed files yourself" in docs/UPDATING.md.
`);
  process.exit(1);
}

const count = git(["rev-list", "--count", `${before}..${TRACKING}`]).out;
console.log(`
Updated: ${count} new change${count === "1" ? "" : "s"} from the original.

Next:
  1. Start the app again:  npm start   (the first start after an update prepares the app, about 2 minutes)
  2. In the app: Settings > Updates > Open setup, then Check for updates and Apply the update.
  3. If your copy is on GitHub, save the update there too:  git push
     (a copy deployed on Vercel redeploys by itself).
`);
