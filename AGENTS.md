# Guide for coding agents

This file is for the coding agent (Claude Code, Codex or similar) that a person opens in their copy
of Benji GTM. The person is usually not a programmer. Explain what you do in plain words, one step
at a time, and prefer the commands below over anything clever.

## What this project is

Benji GTM is a dashboard a person runs on their own Mac (and optionally on Vercel). It tracks their
competitors, shows which of their ads and posts work, and turns that into the person's own ad
creatives. It is a Next.js app in `studio/` backed by the person's **own Supabase project**: the
database, file storage and backend functions (`supabase/`) all live in their project.

This repository is a copy of https://github.com/Benji-App-Studio/benji-gtm (a fork, or a copy made with "Use this template").

## Rules that matter most

- **Never ask the person to paste a Supabase access token, an API key or a password into the chat.**
  Not even "just to check it". Those go only into the app's own pages, or a hidden Terminal prompt:
  - the Supabase access token into the setup page (`/setup`), Settings > Updates > Open setup, or the
    "Forgot your password?" page;
  - API keys (OpenAI, Apify, Higgsfield, Meta, …) into **Settings > API keys** in the app.
  The app checks each key and stores it encrypted in the person's own Supabase project. If the
  person pastes a secret into the chat anyway, tell them to delete that token or key at the provider
  and make a new one.
- **Never put a key, token or password in a file in this repository.** Nothing in this repository is
  secret, and a fork is public on GitHub. The link to the person's Supabase project is saved outside
  the repository, in `~/.gtm-install/config.json`.
- **Setup happens in the browser, at `/setup`.** Don't set up Supabase by hand, don't create `.env`
  files and don't run SQL against the person's project to "help": the setup page does all of it.
- **Never edit a file in `supabase/migrations/`.** Each install records a fingerprint of every
  migration it applied, so a changed migration breaks updates. To change the database, add a new
  migration file with a later timestamp.
- **The product's name lives in one place:** `studio/src/lib/brand-config.ts` (`APP_NAME`,
  `APP_SLUG`). Never write the name into a string anywhere else.
- **Don't push, force-push or rewrite git history** unless the person asks for it.

## Start it

```bash
npm start
```

That runs `start.command`: it checks Node.js 22+, installs what the app needs (`studio/`), prepares
it, and opens http://localhost:3000. The first start, and the first start after an update, take a
few minutes. The app listens on this Mac only (127.0.0.1); that is on purpose, because first-run
setup must happen on the computer that runs the app. Press Control-C in its Terminal window to stop.

For work on the app's code there is a development server with live reload (see "For developers" at the end).

## Signing in

On the person's own Mac the app has **no login page**: it signs the owner in by itself with the email
and password chosen in setup, which it keeps in `~/.gtm-install/config.json` (owner-only, outside the
repository). Never read that file out, print it or copy it anywhere. A copy put online (Vercel)
shows a login page, with the same email and password.

If the person forgot their password or the app shows a login page on their Mac, don't look for a
reset email (there is none) and never ask for the password or token in chat. In order:

1. The app opens: **Settings > Account > Change password** (the old one isn't needed).
2. It shows a login page: press **Forgot your password?** there, and follow the page (a new Supabase
   access token, then a new password). If the page says the account is gone, it offers to create it
   again; the data stays. If it says the project can't be reached, the project is probably paused:
   press **Resume project** in the Supabase dashboard, then **Try again**.
3. A new Mac (the app shows `/setup`): go through setup with the same project; step 4,
   "Connect this computer", sets a new password.
4. If the pages don't help, have the person run this in the app's folder, and type the token and the
   password **into the Terminal prompts** (hidden), never into the chat or the command line:

   ```bash
   npm run provision -- --reset-password --project <ref>
   ```

   `<ref>` is the 20 letters in their project's Supabase address. It sets the password, saves it for
   automatic sign-in, and (if the account was deleted) offers to create it again.

## Folder map

| Path | What it is |
| --- | --- |
| `start.command` | The start script (`npm start` runs it). |
| `studio/` | The Next.js app: pages in `studio/src/app`, components in `studio/src/components`, logic in `studio/src/lib`. |
| `studio/src/app/setup/` | The setup page (`/setup`) and the Updates card. |
| `studio/src/lib/brand-config.ts` | The product's name. |
| `studio/public/downloads/ad-library-extension.zip` | The Chrome extension, built. |
| `studio/public/guides/extension/` | The extension guide's pictures (Settings → Ad Library extension and `docs/CHROME-EXTENSION.md`). |
| `supabase/migrations/` | Database changes, applied in order by setup. Add new ones; never edit old ones. |
| `supabase/functions/` | The backend (Supabase edge functions, Deno). Setup deploys them. |
| `scripts/provision.mjs` | The setup steps from Terminal, for when the setup page can't finish. |
| `scripts/creative-runner/` | The optional desktop runner (creator-style videos, product cut-outs). |
| `scripts/update.mjs` | `npm run update`: brings this copy up to date with the original. |
| `chrome-extension/README.md` | The Chrome extension's full guide. |
| `docs/` | The guides for people: setup, updating, Vercel, the extension, the runner, troubleshooting. |

## Commands

| Command | What it does |
| --- | --- |
| `npm start` | Starts the app. |
| `npm install` | Once, at the top of the repository: installs what the two terminal tools below need. |
| `npm run provision -- --dry-run` | Shows what setup would do. Calls nothing and needs no token. |
| `npm run provision -- --help` | All of setup's terminal options. A real run asks for the access token itself; never pass it through the chat. |
| `npm run provision -- --reset-password --project <ref>` | A new password for the owner, no email. The person types the token and password into the hidden Terminal prompts. See "Signing in". |
| `npm run creative-runner -- --dry-run --offline /tmp/creative-dry-run --once` | Tries the desktop runner without spending anything. See docs/DESKTOP-RUNNER.md. |
| `npm run update` | Updates this copy from the original (below). |

## Updating from the original

- **A fork:** the person clicks **Sync fork** on their fork's GitHub page, then runs `git pull` here.
- **Any copy (fork, template copy, clone):** `npm run update`. It adds the original as the
  `upstream` remote, fetches it and merges. A template copy has unrelated history; the script
  connects it on the first run. It never pushes: afterwards run `git push` if the copy is on GitHub.

After either: restart the app (`npm start`), then in the app **Settings > Updates > Open setup** and
**Apply the update** (the person pastes a new access token there).

If the merge clashes with the person's own changes, resolve the conflicts keeping their changes
where they still make sense, or undo with `git merge --abort`. Never resolve a conflict in
`supabase/migrations/` by keeping the person's version of an existing migration: take the original's.

## When something fails

1. **The start command** writes everything to `start-log.txt` in the repository's top folder. Read
   its last lines. `docs/TROUBLESHOOTING.md` lists the usual causes.
2. **The setup page** shows "This step didn't finish" with a sentence on what to do, and a
   **Technical detail** section with the real error. Ask the person to copy that text to you.
3. **The backend** (functions, database): the person's Supabase dashboard, **Logs** (Edge Functions,
   Postgres). They can copy log lines to you; log lines don't contain their keys.
4. A page that says "Connect … to use …" or "Add the key" is missing a key: the person adds it in
   **Settings > API keys**.

## For developers

- Development server with live reload: in `studio/`, `npm run dev` (after `npm start` has installed
  what it needs once). It reads the same saved link to the person's Supabase project.
- Type check: in `studio/`, `npx tsc --noEmit`. Lint: `npm run lint` there.
- Backend functions are Deno. A changed function reaches the person's project when they apply an
  update (Settings > Updates > Open setup > Apply the update), which redeploys every function.
