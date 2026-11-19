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

**"The token works, but this account has no project yet."** Go back to step 1, create the project,
then click **Check** again.

**"This project already has data".** Setup only works on a new, empty Supabase project. Create a new
project and pick that one.

**"… is paused."** Free Supabase projects pause after about a week without use. Open the project in
your Supabase dashboard, press **Restore**, wait about two minutes, then check again.

**"This step didn't finish" in "Prepare the project".** Click **Retry**: finished parts are skipped.
If the same part keeps failing, open **Technical detail** under the message, copy the text, and
check that your project is not paused in the Supabase dashboard.

**I reloaded the page and the token is gone.** That is by design: the token is never saved. Paste it
again, or make a new one. Finished parts are skipped.

## Keys

**"Check failed" on a key.** The message under the box says why. The usual causes: a missing
character when pasting, no payment method under Billing (OpenAI), or the key was deleted at the
provider. Paste a new key and click **Check and save**.

**A page says "Connect … to use …" or shows "Add the key".** That feature needs a key you have not
added yet. The button takes you to **Settings > API keys**.

## Signing in

**I forgot my password.** The app has no reset link. In your Supabase dashboard open your project,
then **Authentication > Users**, find your email, open the menu at the end of its row and choose
**Send password recovery**.

**It asks me to set up again.** See "If the app asks you to set up again" in [UPDATING.md](UPDATING.md).

## Limits on the free Supabase plan

- Videos larger than 50 MB are not stored when saving competitors' ads. The ad and its poster image still are.
- Storage is limited to 1 GB. The **Research** page shows how much is used, under "How to get ads in, and stored media".
- Long background jobs are split into shorter runs, so large imports take longer.
- A project pauses after about a week without use (see "… is paused." above).

Upgrading the Supabase project lifts these limits. Afterwards follow steps 4 to 6 of
[UPDATING.md](UPDATING.md) once, so the app picks up the new limits.

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
key or a password, not even to your coding agent.
