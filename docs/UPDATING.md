# Updating to a new version

> **What this file is for:** bringing your copy of Benji GTM up to date with the original
> (https://github.com/Benji-App-Studio/benji-gtm) without losing anything.
>
> **When to use it:** when you hear that a new version is out. Allow about ten minutes.

Your data, keys and settings live in your Supabase project, and the link to that project is saved in
your home folder, outside the app's folder. Updating changes only the code: you bring in the new code,
restart the app, then let the app update your Supabase project.

## Steps

1. **Stop the app** if it is running: click its Terminal window and press Control-C.

2. **Bring in the new code.** Pick the way that matches how you made your copy.

   **You made a fork:**

   1. Open your fork's page on GitHub. Under the green **Code** button it says "This branch is …
      commits behind". Click **Sync fork**, then **Update branch**.
   2. Get the new code onto your Mac. In GitHub Desktop: click **Fetch origin**, then
      **Pull origin**. Or in Terminal, in the app's folder:

      ```bash
      git pull
      ```

   **You used "Use this template"** (or you are not sure): in Terminal, in the app's folder, run

   ```bash
   npm run update
   ```

   It connects your copy to the original the first time (it adds it as `upstream`), brings in what
   changed and says what to do next. It works for a fork too. It never deletes your own changes.

   ✅ **Checkpoint:** `git pull` lists changed files, or `npm run update` ends with "Updated: … new
   changes from the original". "Already up to date" means there was nothing new.

3. **Start the app again:**

   ```bash
   bash start.command
   ```

   The first start after an update installs and prepares the app again ("Step 1 of 2" and/or
   "Step 2 of 2", about two minutes each). That is normal.

   ✅ **Checkpoint:** the app opens, already signed in or asking you to sign in. Your apps and data are there.

4. **Open the update page.** In the app, click the name at the top of the sidebar, then **Settings**,
   then **Updates**, then **Open setup**.

   ✅ **Checkpoint:** a page headed "Setup" with a card called "Updates".

5. **Make an access token.** Click **Access Tokens in Supabase** on that card (it opens
   https://supabase.com/dashboard/account/tokens), press **Generate new token**, give it any name,
   and press **Copy**.
6. **Apply the update.** Paste the token into the **Access token** box and click
   **Check for updates**. The page says how many database changes are new. Click **Apply the update**
   and keep the page open (about two minutes).

   ✅ **Checkpoint:** every line shows a tick and the page says "Your project is up to date."

7. **Tidy up.** Delete the access token on the Supabase tokens page.

8. **Only if your copy is a template copy and you deployed it on Vercel:** save the update on GitHub
   too, in Terminal in the app's folder:

   ```bash
   git push
   ```

   A fork updated with **Sync fork** is already up to date on GitHub. Either way, Vercel redeploys by
   itself when your copy on GitHub changes.

💡 **Beginner tip:** apply the update even when the page says the database "is up to date". A new
version usually changes the backend too, and **Apply the update** reinstalls it.

## If you changed files yourself

If you (or your coding agent) changed the app's files, an update can touch the same lines. Then git
can't choose between your version and the new one by itself. That is called a **merge conflict**.
Nothing is lost when it happens.

- **Before updating**, save your changes in git: in GitHub Desktop, write a summary and click
  **Commit to main**; or in Terminal run `git add -A`, then `git commit -m "My changes"`.
  `npm run update` asks you to do this if you forgot.
- **Sync fork says it can't update because of conflicts:** choose **Discard commits** only if you
  don't need your own changes any more. Otherwise update on your Mac with `npm run update` instead.
- **`git pull` or `npm run update` says "conflict"** and lists files: the update is half done.
  The safe way out puts everything back exactly as it was before:

  ```bash
  git merge --abort
  ```

  Then either keep using the version you have, or ask your coding agent: "Resolve the merge conflicts
  from the update, keeping my changes where they still make sense, then commit." Afterwards start the
  app and continue at step 3.

⚠️ Never change files in `supabase/migrations/`. Add a new file there instead. Changed migrations stop
updates from applying.

## If the app asks you to set up again

That means the saved link to your project was not found (for example on a new Mac). Go through the
setup page again and pick the **same** Supabase project:

1. In step 2 the page says your project "was prepared for Benji GTM before. Setup will add only what is missing." Click **Continue**.
2. In step 3 click **Prepare the project**.
3. Step 4 is now called "Connect this computer". Click **Connect this computer**, then sign in with
   the same email and password as before.

All your data is kept.

## Troubleshooting

- "This step didn't finish" while applying: click **Retry**. Finished parts are skipped.
- `npm run update` says "some files have changes that are not saved in git yet": save them as in
  "If you changed files yourself", then run it again.
- `git pull` says "There is no tracking information": you are not in the folder you cloned. `cd` into it and try again.
- Something else: see [TROUBLESHOOTING.md](TROUBLESHOOTING.md).
