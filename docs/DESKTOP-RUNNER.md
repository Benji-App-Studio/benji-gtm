# The desktop runner (optional)

> **What this file is for:** setting up the small program that makes creator-style (UGC) videos and
> product cut-outs on your Mac with your Higgsfield account.
>
> **When to use it:** only if you want those two kinds of creatives. Images and AI videos run on your
> Higgsfield or OpenAI key and never need the runner; posts need nothing at all. Allow about 15 minutes.

The full reference (every option, how it avoids paying twice, the checks after each creative) is in
[scripts/creative-runner/README.md](../scripts/creative-runner/README.md).

## Before you start

- Benji GTM set up and working on your Mac.
- Node.js 22 or newer (the same one the app uses).
- `ffmpeg`, for poster frames and video sizes. With Homebrew: `brew install ffmpeg`.
- Xcode's command-line tools: `xcode-select --install`. The first run builds a small text-reading
  helper with them.
- The Higgsfield command-line app, signed in to your Higgsfield account.

All commands below run in Terminal **in the app's folder** (the one you cloned, which contains
`start.command`). To go there: `cd ~/Documents/benji-gtm` (or type `cd`, a space, drag the folder onto
Terminal and press Return).

## Steps

1. **Install what it needs.** Once, and again after an update:

   ```bash
   npm install
   ```

   ✅ **Checkpoint:** it ends with a line like "added 3 packages".

2. **Try it without spending anything:**

   ```bash
   npm run creative-runner -- --dry-run --offline /tmp/creative-dry-run --once
   ```

   It runs two made-up jobs against stand-in results. Nothing leaves your Mac and no credits are used.
   The very first run builds the text-reading helper, so it can sit at "waiting" for about a minute.

   ✅ **Checkpoint:** two lines end in "done", and the last line says "spent 76 credits this session"
   (stand-in credits: nothing was charged).

3. **Create the runner's secret.** In the app: click the name at the top of the sidebar, then
   **Settings**, then **Desktop runner**. Click **Create secret**, then **Copy secret**. It is shown
   only once. (If you lose it, **Replace secret** makes a new one and the old one stops working.)

   ✅ **Checkpoint:** "Runner secret" shows a **Created** badge.

4. **Sign in to Higgsfield:**

   ```bash
   higgsfield auth login
   ```

5. **Start the runner.** The **Desktop runner** page shows the start line under "Start it", step 3,
   with your project's address filled in (and your new secret, if you just created it). Click
   **Copy** next to it, paste it into Terminal and press Return.

   ✅ **Checkpoint:** its first line starts with "LIVE (spends Higgsfield credits)", then "catalog: …"
   lines follow. Start a small batch of creator-style videos in Studio and watch it pick them up.

6. **Keep the window open** while it works. Press Control-C to stop it. A job it was in the middle of
   is picked up again by the next run, and is not paid for twice.

💡 **Beginner tip:** the secret is like a password for the runner. Paste it only into Terminal on your
own Mac, never into a chat or a file in the repository. To avoid pasting it every time, the full
reference shows how to keep it in a settings file in your home folder (`~/.config/creative-runner/runner.env`).

## Troubleshooting

- **It stops and says the Higgsfield sign-in expired:** run `higgsfield auth login` again, then start it again.
- **It stops and says what to set:** the start line was cut off. Copy it again from **Settings > Desktop runner**.
- **"command not found: ffmpeg":** install ffmpeg (see "Before you start").
- **Jobs are refused for price:** the live price was more than 1.5 times the estimate you confirmed in
  Studio. Check the price in Studio and start the batch again.
- More in [scripts/creative-runner/README.md](../scripts/creative-runner/README.md).
