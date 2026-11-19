# Desktop runner

A small program you keep running on a Mac. It makes the Studio's creatives with the Higgsfield CLI
logged in on that Mac, uploads them to your project and hands them to the app for checking.

You need it for **creator-style (UGC) videos** and **product cut-outs**: Higgsfield only offers those
through its CLI. Image ads and AI videos can run without it once a Higgsfield API key is saved in the
app's Settings.

| What makes the creative | Runs | Needs |
| --- | --- | --- |
| **The desktop runner** (this folder) | Every model: Marketing Studio videos (avatars, hooks, settings, products), Seedance 2.5 videos (with reference images when a job has them), image ads and product cut-outs | A Mac with the Higgsfield CLI logged in, and the runner secret from the app's Settings |
| **The Higgsfield API** (inside your project, every 30 seconds) | Image ads and Seedance 2.5 videos. An AI video is queued for both; whichever is up takes it | A Higgsfield API key, `<key id>:<secret>` from cloud.higgsfield.ai, saved in the app's Settings |

API credits are bought in cloud.higgsfield.ai. That may be a separate balance from the CLI's
subscription credits; check before relying on it.

Posts (Reddit- or tweet-style) need neither: the app renders them from templates as soon as a batch
starts, for free.

## What you need

- A Mac. The runner reads the text on each creative with macOS Vision.
- Node.js 22 or newer (the same one the app uses).
- `ffmpeg` (`brew install ffmpeg`), for poster frames and video sizes.
- Xcode's command-line tools (`xcode-select --install`). The first run compiles a small text-reading
  helper with them.
- The Higgsfield CLI, logged in: `higgsfield auth login`.

All commands below are run in Terminal from the app's folder (the one you cloned, which contains
`start.command`). To go there, type `cd` and a space, drag the folder onto the Terminal window, and
press Return. Then install what the runner needs. Do this once, and again after an update:

```bash
npm install
```

✅ **Checkpoint:** it ends with a line like "added 3 packages".

## Try it without spending anything

```bash
npm run creative-runner -- --dry-run --offline /tmp/creative-dry-run --once
```

This writes two sample jobs for a made-up app called Acme (an image and a UGC video) to
`/tmp/creative-dry-run/jobs.json` and runs them against stand-in results. It takes the poster frame,
reads the text, and writes the files to `storage/` and every outcome to `results.json` in that
folder. Nothing leaves the Mac and no Higgsfield credits are used. The very first run also builds
the text-reading helper, so it can sit at "waiting" for about a minute.

✅ **Checkpoint:** two lines end in "done", and the last line says "spent 76 credits this session"
(stand-in credits: nothing was charged).

## Set it up

1. **Get the secret.** In the app, open **Settings > Desktop runner** and click **Create secret**.
   It is shown once, so click **Copy secret** now. **Replace secret** later makes the old one stop
   working. The same page shows a ready-made start line with your project's address and the secret
   filled in; the settings file below saves you from pasting them every time.
2. **Save the settings** in `~/.config/creative-runner/runner.env`. Replace the two values first:
   the address is your Supabase project's address followed by `/functions/v1/creatives`.

   ```bash
   mkdir -p ~/.config/creative-runner
   cat > ~/.config/creative-runner/runner.env <<'EOF'
   CREATIVES_FUNCTION_URL=https://<your project ref>.supabase.co/functions/v1/creatives
   CREATIVES_RUNNER_SECRET=<the secret from Settings>
   EOF
   chmod 600 ~/.config/creative-runner/runner.env
   ```

   Both are required. The runner has no default project: when either is missing it stops and says
   what to set.
3. **Check the connection** with a run that uses your real queue but stand-in results (no Higgsfield
   calls, no credits). Start a small batch in the Studio first, then:

   ```bash
   npm run creative-runner -- --dry-run --once
   ```

   The jobs are claimed, the stand-in files are uploaded and checked, and you can watch the batch go
   through the Studio page.
4. **Run it for real** (this spends Higgsfield credits):

   ```bash
   npm run creative-runner
   ```

   Leave the window open. To keep it running after you close Terminal, start it in a `tmux` session or
   as a LaunchAgent. Press Control-C to stop. A job it was in the middle of is picked up again by
   the next run, within 30 minutes, and is not paid for a second time.

## Options

Options go after `--`, for example `npm run creative-runner -- --max-credits 150 --once`.

| Option | What it does |
| --- | --- |
| `--max-credits 150` | Stops taking jobs once this many credits are spent in the session (default 300). |
| `--concurrency 2` | Jobs at once, 1 to 4 (default 4, Higgsfield's pro-plan limit). |
| `--models gpt_image_2_5,seedance_2_5` | Only take these models. |
| `--poll 30` | Seconds between looks at the queue (default 15). |
| `--no-ocr` | Skip reading the on-screen text. |
| `--once` | Work through what is queued now, then stop. |
| `--dry-run` | Stand-in results instead of Higgsfield (see above). |
| `--offline <folder>` | A queue in a local folder instead of your project (always a dry run). |

`SUPABASE_PUBLISHABLE_KEY` can be added to the settings file; it is sent with each request when set.
`HIGGSFIELD_BIN` points at the CLI when it isn't on your `PATH`.

## What it does with each job

It runs up to 4 jobs at once. For each one it checks the live price with `higgsfield generate cost`
(free) and refuses a job that costs more than 1.5× the estimate confirmed in the Studio (or 2 credits
more, whichever is higher). Busy and rate-limited jobs go back to the queue for later. When it starts
it copies Marketing Studio's avatars, hooks and settings to the Studio's pickers. It holds a job for
30 minutes at a time; if the runner dies, the queue hands the job to the next runner. When the
Higgsfield login expires, the runner stops and says so: run `higgsfield auth login` again.

**It never pays twice.** Each job is submitted with `generate create --json` (no `--wait`) and its
Higgsfield job id is saved to the queue at once; then the runner waits with `generate wait <id>`. A
dropped or timed-out wait puts the job back in the queue *with* its id, and the next claim only
collects it. A job claimed again without an id (the runner died between submit and save), or a submit
that failed in a way that may still have created the job (a 5xx answer, a timeout), is first looked
for in `generate list --json`: a job from the last 30 minutes with the same model, prompt and
settings, not already another job's, is collected instead of submitting again. If the list can't be
read, nothing is submitted until it can. When Higgsfield itself ends a job (failed, nsfw, canceled),
the job fails with Higgsfield's status and reason. It is marked not charged, and its credits go back
to the session budget, only then or when Higgsfield refused the submit outright.

Every finished file goes to your project's `creatives` storage bucket at
`<app id>/<yyyy-mm-dd>/<job id>/<file>` (videos also get a `-poster.jpg`).

The runner keeps two things in `~/.cache/creative-runner`: the compiled text-reading helper (`ocr`)
and the Marketing Studio products it has already made (`products.json`), so a product is made once.
Deleting the folder is safe; both are rebuilt.

## What happens after: the check and the review

Your project checks each creative as soon as it is uploaded, then it waits in the Studio for a
person to approve or reject it. Only approved creatives can be sent to Meta.

- **App name:** on screen and spelled right. Names the Brand page says never to use fail.
- **Competitors:** a competitor's name on screen fails; in the brief it warns. The AI also judges
  allusions.
- **Readability:** from the size and contrast of the text the runner read.
- **The AI's read:** the right app, personal attributes, fake testimonials or credentials, fake
  interfaces or news, the risky claims of the app's category (guaranteed outcomes, advice, medical
  claims, before/after), and every claim the Brand page forbids.
- The report lists what failed and what a person should look at (for example: listen to the
  voice-over, which isn't transcribed).

A creative can be approved when the check passed, or warned and the reviewer left a note. A failed
one can't be approved. Running the check again resets the decision. Videos need a poster frame.

## Google Drive export (optional)

The Studio can copy approved creatives to a Google Drive folder. It needs a Google Cloud service
account with the Drive API enabled (its JSON key saved in the app's Settings), a folder (ideally in a
Shared Drive) shared with the service account as Editor, and that folder's id in the app's storage
settings. Until all three are in place the export answers with these steps.

## For developers

The tests are in the full source repository only: there, `npm run test:creatives` runs the planner,
runner, check, Higgsfield API and Drive tests against fixtures.
