# Setup, step by step

> **What this file is for:** getting Benji GTM running on your Mac, connected to your own Supabase
> project and your own API keys.
>
> **When to use it:** the first time you run the app, starting from a fresh fork or template copy.
> Allow about 20 minutes: a few minutes to copy and clone, a few for the first start, then about ten
> for the setup page.

## Before you start

You need:

- A Mac with an internet connection.
- A free **GitHub** account: https://github.com
- **Node.js 22 or newer.** If you are not sure, the start command checks for you and tells you what to install.
- A **Supabase** account (free). You create it in step 1 of the setup page.
- An **OpenAI** account with a payment method added under Billing: https://platform.openai.com

💡 **Beginner tip:** you never have to edit a file or a setting by hand. Everything is pasted into the setup page in your browser.

## Make your copy and clone it

1. Open https://github.com/Benji-App-Studio/benji-gtm and click **Fork** (a public copy, updated with one button) or
   **Use this template** (a private copy, updated with one command). "Which one should I pick?" in
   the [README](../README.md#which-one-should-i-pick) explains the difference.
2. Clone your copy to your Mac with GitHub Desktop, with `git clone` in Terminal, or by asking
   Claude Code or Codex to clone it. The README's "Clone it" section shows each way.

✅ **Checkpoint:** a folder named after your copy (for example `benji-gtm` in Documents) with
`start.command`, `studio` and `docs` inside.

💡 Nothing you set up below is written into this folder, so a public fork stays free of keys.

## Start the app

1. Open the **Terminal** app (press Command-Space, type `Terminal`, press Return).
2. Go to the folder you cloned. Change the path if it is not in Documents:

   ```bash
   cd ~/Documents/benji-gtm
   ```

3. Start the app:

   ```bash
   bash start.command
   ```

What it does: checks Node.js, installs what the app needs ("Step 1 of 2"), prepares the app
("Step 2 of 2"), then opens it in your browser. Each step shows a row of dots and takes about two
minutes. This happens the first time, and again the first time after an update. Other starts take a
few seconds.

✅ **Checkpoint:** Terminal says "Benji GTM 0.1.0 is starting at http://localhost:3000" and your
browser opens a page headed "Set up Benji GTM" with six numbered steps.

💡 Keep the Terminal window open. The app stops when you close it.

The six steps below have the same numbers and titles as the setup page.

## Step 1. Create your Supabase project

1. Click **supabase.com** on the setup page (it opens https://supabase.com/dashboard/sign-up) and
   create a free account. If you already have one, sign in.
2. Click **New project** on the setup page (it opens https://supabase.com/dashboard/new). Type any
   name. Choose a database password and keep it somewhere safe. The app never asks for it. Pick the
   region closest to you. Press **Create new project**.
3. Wait until Supabase has finished setting the project up (about two minutes).
4. Back on the setup page, click **My project is ready**.

✅ **Checkpoint:** step 1 shows "Done" and step 2 opens.

⚠️ Use a **new project made only for Benji GTM**. Setup refuses a project that already holds other data, so it can never overwrite another app's data.

## Step 2. Connect it with an access token

Setup needs to create tables and install the backend in your project. It does that with an access token.

1. Click **Access Tokens in Supabase** on the setup page (it opens https://supabase.com/dashboard/account/tokens).
2. Press **Generate new token**. Give it any name, for example "setup". If Supabase asks how long
   it should last, pick the shortest time.
3. Press **Copy**. The token starts with `sbp_`.
4. Paste it into the **Access token** box on the setup page and click **Check**.
5. Under "The token works. Pick your project:", choose your new project and click **Check this project**.
6. When the page says your project "is empty and ready to be prepared", click **Continue**.

What the token allows: it gives Benji GTM, on this computer, temporary access to your Supabase
account. It is used only while the setup page works and is **not saved anywhere**. The last step
reminds you to delete it.

✅ **Checkpoint:** step 2 shows "Done" and "Project:" with your project's name.

## Step 3. Prepare the project

Click **Prepare the project**. The page lists each part as it runs: the database tables, the backend
functions and the Style Library images. It takes about two minutes. Keep the page open.

✅ **Checkpoint:** every line shows a tick and the page says "Your project is ready." Click **Continue**.

If the page says "This step didn't finish", click **Retry**. Parts that already finished are skipped.

## Step 4. Create your account

1. Type your email and choose a password (at least 8 characters).
2. Click **Create my account**.

This account is the **owner** of your copy: the only one that can change keys and settings. Nobody
else can sign up afterwards. You can add people later in **Settings > Members**.

✅ **Checkpoint:** the page reloads and step 5, "Add your keys", is open. If it shows a sign-in page first, sign in with the email and password you just chose.

## Step 5. Add your keys

1. **OpenAI (Required).** Click **OpenAI** on the setup page (it opens
   https://platform.openai.com/api-keys). Choose **Create new secret key**, copy the key (it starts
   with `sk-`), paste it into the **OpenAI key** box and click **Check and save**.
2. **Apify (Recommended).** It collects competitors' posts and ads for you. Click **Apify** on the
   setup page (it opens https://console.apify.com/settings/integrations). Copy the personal API
   token (it starts with `apify_api_`), paste it into the **Apify key** box and click **Check and save**.
3. Click **Continue**.

Each key is checked the moment you save it, then stored in your own Supabase project, never on this
computer. The app never shows a saved key again, only its last four characters.

✅ **Checkpoint:** OpenAI shows a "Saved" badge and the line "This key works. It is saved in your project".

You can add the other keys later in **Settings > API keys**. Each one says what it unlocks and how to get it.

## Step 6. Create your first app

1. Delete the access token now: click **Access Tokens in Supabase** on the setup page and remove
   the token you made in step 2. It is no longer needed.
2. Click **Create your first app**.
3. On the page "Tell us about your product", answer the short questions (name, website, what it is,
   who it is for, your channels, competitors you already know) and click **Finish**.

✅ **Checkpoint:** your new app's page opens, with its name in the sidebar.

## Next time

Run the same two lines from "Start the app" (`cd` into the folder, then `bash start.command`). It starts in a few seconds and opens the app. If it asks, sign in
with the email and password from step 4.

## Troubleshooting

- The start command stops with a message: it says what to do. More in [TROUBLESHOOTING.md](TROUBLESHOOTING.md).
- The setup page says "Open this page on the computer that runs the app": open the address from the
  Terminal window (it begins with `http://localhost`) in a browser on the same Mac.
- A step says "This step didn't finish": read the sentence under it, fix that, then click **Retry**
  or repeat the step. See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for the common causes.
