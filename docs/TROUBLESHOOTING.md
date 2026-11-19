# If something goes wrong

> **What this file is for:** the problems people hit most, and the fix for each.
>
> **When to use it:** when a step in another guide does not give the result its checkpoint describes.

## The start command

**"Node.js is not installed" or "is too old".** Open https://nodejs.org, download the LTS version,
open the downloaded file and click through it. Then open a new Terminal window and run the start
line again.

**"No such file or directory".** Terminal is not in the folder you cloned. Type `cd` and a space,
drag the folder from Finder onto the Terminal window, press Return, then run `bash start.command`
again. The folder is the one with `start.command`, `studio` and `docs` inside.

**"permission denied", or macOS says the file "cannot be opened" after a double-click.** Run it
from Terminal with `bash` in front, inside the app's folder:

```bash
bash start.command
```

**"part of the app's folder is missing".** You ran it from somewhere else, or the clone did not
finish. Check that the folder has `studio` and `supabase` inside. If not, clone your copy again (see
"Clone it" in the [README](../README.md#clone-it-put-your-copy-on-your-mac)).

**"The install did not finish" or "Preparing the app did not finish".** The first start, and the
first start after an update, fetch the app's parts, so the Mac must be online. Check the connection and run the start line again:
it carries on where it stopped. If it stops the same way again, delete the folders
`studio/node_modules` and `studio/.next` inside the app folder and run it once more. The details of
the last start are in the file `start-log.txt` in the app folder.

**The dots keep going for more than ten minutes.** Press Control-C, check the internet connection,
and run the start line again.

**The browser did not open.** Look in the Terminal window for the line
"Benji GTM 0.1.0 is starting at http://localhost:3000" and open that address yourself.

**The address ends in 3001 (or higher) instead of 3000.** Something on the Mac already uses 3000,
most often the app itself in another Terminal window. Use that window's address and close the new
one, or carry on with the new address: both work.

**Terminal also shows `http://127.0.0.1:3000`.** That is the same app. Keep using the `localhost`
address so you stay signed in.

**I want to open it from my phone or another computer.** The copy on your Mac can only be opened on
that Mac: no other device on your network can reach it. To use it from anywhere, see
[DEPLOY-VERCEL.md](DEPLOY-VERCEL.md).

**Every start says "Step 2 of 2: preparing the app".** That happens after any change to the files in
`studio`, for example an update or an edit by your coding agent. If you changed nothing, check
`git status` in the app's folder: something keeps changing a file there.

**After `git pull` or `npm run update` the start command fails.** Read the last lines it shows. If
they mention a file you changed yourself, see "If you changed files yourself" in
[UPDATING.md](UPDATING.md). Otherwise delete `studio/node_modules` and `studio/.next` and start again.

**"This site can't be reached" in the browser.** The app is not running. It stops when its Terminal
window is closed or the Mac restarts. Run the start line again.

## Setup

**"Open this page on the computer that runs the app".** Setup only works in a browser on the same
Mac the app runs on. Open the address the Terminal window shows. It begins with `http://localhost`.

**The token is rejected.** Create a new token at https://supabase.com/dashboard/account/tokens and
paste the whole thing. It starts with `sbp_` and Supabase shows it only once.

**Check says the token isn't allowed.** Create it again with the **Full access** preset, for your
project. A "Read-only" token fails with this message. See [keys/supabase.md](keys/supabase.md).

**"The token works, but this account has no project yet."** Go back to step 1, create the project,
then click **Check** again.

**"This project already has data".** Setup only works on a new, empty Supabase project. Create a new
project and pick that one.

**"… is paused."** Supabase can pause a free project. A paused free project can be resumed from the
dashboard: open the project in your Supabase dashboard, press **Resume project**, wait until it is
running again, then check again.

**"This step didn't finish" in "Prepare the project".** Click **Retry**: finished parts are skipped.
If the same part keeps failing, open **Technical detail** under the message, copy the text, and
check that your project is not paused in the Supabase dashboard.

**I reloaded the page and the token is gone.** That is by design: the token is never saved. Paste it
again, or make a new one. Finished parts are skipped.

## Keys

**"Check failed" on a key.** The message under the box says why. The usual causes: a missing
character when pasting, no payment method under Billing (OpenAI), or the key was deleted at the
provider. A Restricted OpenAI key also fails: create one with **Permissions: All**. Paste a new key
and click **Save and check**. Each key has a step-by-step guide:
[OpenAI](keys/openai.md), [Apify](keys/apify.md), [Supabase](keys/supabase.md),
[Typesafe](keys/typesafe.md), [Higgsfield](keys/higgsfield.md),
[Meta Ad Library](keys/meta-ad-library.md), [Meta ads](keys/meta-ads.md),
[RevenueCat](keys/revenuecat.md), [AppStack](keys/appstack.md),
[Google Drive](keys/google-drive.md), [TikTok](keys/tiktok.md).

**A page says "Connect … to use …" or shows "Add the key".** That feature needs a key you have not
added yet. The button takes you to **Settings > API keys**.

## Signing in

On your own Mac the app signs you in by itself: there is no login page. Your password is needed only
on an online copy (Vercel).

**I forgot my password.** You don't need email for this.
- If the app opens on your Mac: go to **Settings > Account** and change the password there. You don't
  need the old one. The box **Your sign-in details** shows the new one once: save it.
- If it shows a page asking you to sign in: press **Forgot your password?**. Make a new Supabase
  access token (the page shows how, like setup did), paste it, choose a new password and press
  **Set my new password**. You are signed in, and the app keeps signing you in on this Mac.
- On a new Mac (the app shows the setup page): follow it and pick the same project. In step 4,
  "Connect this computer", choose a new password. All your data is kept.
- From Terminal, if the pages don't help: in the app's folder run
  `npm run provision -- --reset-password --project <ref>` (the 20 letters in your project's Supabase
  address). It asks for the access token and the new password in Terminal, hidden. Type them there,
  never into a chat.

**The app shows a login page on my own Mac.** It couldn't sign you in by itself, and the page says why,
with a button for the next step:
- **"Sign in once on this computer"**: your copy was set up before the app could sign you in by
  itself. Sign in once with your email and password; from then on it signs in by itself. Forgot the
  password? Press **Forgot your password?**.
- **"Sign in again"**: the password the app saved no longer works (it was changed somewhere else, or
  your account was removed). Sign in with your current password, or press **Forgot your password?**.
  If your account was removed, that page offers to create it again with your email; your workspace
  and data stay.
- **"Can't reach your Supabase project"**: Supabase paused the project, or this Mac is offline. Press
  **Open your Supabase dashboard**, press **Resume project** if the project says it is paused, wait
  until it is running again, then press **Try again**.

**It asks me to set up again.** See "If the app asks you to set up again" in [UPDATING.md](UPDATING.md).

## Limits on the free Supabase plan

- Videos larger than 50 MB are not stored when saving competitors' ads. The ad and its poster image still are.
- Storage is limited to 1 GB. **Settings > Storage** shows how much is used, by app and by kind (see "Running out of space" below).
- Long background jobs are split into shorter runs, so large imports take longer.
- A project pauses after about a week without use (see "… is paused." above).

Upgrading the Supabase project lifts these limits. Afterwards follow steps 4 to 6 of
[UPDATING.md](UPDATING.md) once. **Apply the update** looks at your plan again and, in the line
"Copy the Style Library images", says "Limits now match your paid plan: 400 s per function run,
300 MB per file, 100 GB of storage." From then on long jobs run in fewer, longer pieces and bigger
videos are stored. It also raises the project's upload limit to 300 MB per file.

The app changes the limits only while they are still the free plan's starting values. If they were
changed by hand, they are kept, and the same line says "the ones in Settings > Limits were changed by
hand, so they were kept." The same happens the other way round: after moving back to the free plan,
the next update lowers the paid plan's starting values to the free plan's.

## Running out of space

Your Supabase plan includes a fixed amount of file storage (1 GB on the free plan). Benji GTM keeps an
eye on it so nothing breaks halfway.

**What fills it**

| What | Where it comes from | Typical size |
| --- | --- | --- |
| Competitors' ad media | Saved copies of competitors' ad images and videos, made when you collect or import ads, so they don't expire | Images 0.1–0.5 MB, videos 5–50 MB each |
| Generated creatives | Images and videos made in Studio, Playground and "Make this for your app" | Images 2–5 MB, videos 5–30 MB |
| Uploads and brand files | Your product images, logo, screenshots, fonts and Playground uploads | Under 1 MB each |

Videos are almost always what fills a free plan: 20 competitor videos can be a third of 1 GB.

**What you'll see**

- **At 80%:** a quiet card at the bottom of the sidebar, and a note on **Settings > Storage**. Nothing is blocked.
- **At 95%:** a warning before anything that adds files (collecting ads, importing, generating, uploading),
  with a **Free up space** link.
- **At 100%:** those actions are refused with a plain message, and nothing half-saves. Ads you collect
  while it's full are still saved as text; their images and videos are left out and can be saved later
  by importing the same file again.
- **A file bigger than your plan allows** (50 MB on the free plan) is refused before it uploads, with the limit stated.

**How to free space** (open **Settings > Storage**; each one shows exactly what it deletes and how much it frees before anything goes):

1. **Delete rejected creatives.** Creatives you marked rejected in Studio. Anything sent to Meta is kept.
2. **Delete unused creatives** older than a number of days you pick (never approved, never sent to Meta).
3. **Delete old saved media** older than a number of days you pick. The ads stay in Research with their
   text and links; only the saved copies of their images and videos go, so old links may stop showing a picture.
4. **Delete one app's competitor media** from its row under **By app**.
5. **Delete an app you no longer need** (its settings, **Danger zone**). Its files go with it.
6. **Files of a deleted app** show under **By app** when an app was deleted before this cleanup existed: **Remove** them.

✅ **Checkpoint:** the bar on **Settings > Storage** drops by the amount the confirm said.

**When to upgrade the Supabase plan.** Upgrade when you keep landing above 80% after cleaning up, or when
you want to keep competitors' videos for months: Supabase's Pro plan includes 100 GB of storage and lets you
raise the per-file limit (in the Supabase dashboard under Storage > Settings). After upgrading, follow
steps 4 to 6 of [UPDATING.md](UPDATING.md) once, so Benji GTM picks up the new limits.

**"Storage is full" on a generation that already started.** The job fails with that message and nothing
is charged after it: free space, then press **Retry** (the price is shown first).

**"The finished file is larger than your Supabase plan allows".** A video came back bigger than one file
may be on your plan. It failed once (no retries spending again); the job keeps a link to download it from
Higgsfield. Upgrade the plan to store such files here.

## Updating and git

**`git pull` says "Your local changes would be overwritten".** You changed files without saving them
in git. Save them first (`git add -A`, then `git commit -m "My changes"`), then pull again. Or see
"If you changed files yourself" in [UPDATING.md](UPDATING.md).

**"CONFLICT" during an update.** The safe way out is `git merge --abort`, which puts everything back
as it was. See [UPDATING.md](UPDATING.md).

**"git: command not found", or a window asks to install the "command line developer tools".**
Accept it, wait for it to finish, then run the command again. Git comes with those tools.

**I can't push to my copy, or GitHub asks for a password in Terminal and refuses it.** GitHub does not
accept your account password in Terminal. Use GitHub Desktop, or search GitHub's help for "Caching
your GitHub credentials in Git".

💡 **Beginner tip:** when you ask someone for help, send them the exact message you see and the file
`start-log.txt` from the app folder. Neither contains your keys. Never send an access token, an API
key or a password, not even to your coding agent. When a step needs one, type it into the app's page
or into the Terminal prompt that asks for it.
