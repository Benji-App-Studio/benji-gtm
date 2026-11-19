# Supabase: account, project and access token

> **What this key does in the app:** Supabase is where Benji GTM keeps all your data. The access
> token lets the setup page build your project for you (tables, backend, starter images). Without a
> project and a token, setup cannot start.
>
> **Required or optional:** Required. You need it once, during setup (and again for some updates).
> The token is never saved by Benji GTM; you delete it when setup is done.
>
> **What it costs:** The Free plan is enough to start: 2 active projects, 500 MB database, 1 GB file
> storage, 5 GB data transfer a month, 500,000 backend calls a month. A free project pauses after
> 7 days without use (see "If it doesn't work"). The Pro plan starts at $25 a month and never
> pauses. Checked on supabase.com/pricing on 19 November 2026.

## Before you start

- An email address, or a GitHub account (Supabase lets you sign up with either).
- The Benji GTM setup page open in your browser (it opens by itself when you start the app).

## Part 1. Create your account and your project

1. Open https://supabase.com/dashboard/sign-up (or click **supabase.com** on the setup page).
2. Sign up with your email and a password, or click **Continue with GitHub**. If you already have
   an account, sign in instead.
3. If Supabase sends you a confirmation email, open it and click the link.
   ✅ You see the Supabase dashboard.
4. Open https://supabase.com/dashboard/new (or click **New project** on the setup page).
5. If Supabase asks you to create an **organization** first, type any name (your own name is fine),
   keep the **Free** plan, and click **Create organization**.
6. In **Project name**, type a name, for example `benji-gtm`.
7. In **Database password**, type a strong password (or click **Generate a password** if you see
   it), then save it in your password manager. Benji GTM never asks for it, but keep it.
8. In **Region**, pick the one closest to you.
9. If you see an option called **Automatically expose new tables** (it may say "and functions"),
   turn it **on**. Leave every other option as it is.
10. Click **Create new project**.
11. Wait about two minutes while Supabase sets the project up.
    ✅ The project's home page shows your project name and no "Setting up project" message.
12. Go back to the setup page and click **My project is ready**.

⚠️ Use a **new project made only for Benji GTM**. Setup refuses a project that already has
other data in it.

## Part 2. Create the access token

Supabase changed this page in October 2026: new tokens are now **scoped** (limited to the
projects and permissions you pick). Setup needs broad access to your new project, so follow these
choices exactly.

1. Open https://supabase.com/dashboard/account/tokens (or click **Access Tokens in Supabase** on
   the setup page).
2. Click **Generate new token**.
3. Name: type `setup`.
4. Which projects: choose your **new Benji GTM project** (or the organization it is in).
5. Permissions: choose the preset **Full access**. (Not "Read-only": setup creates tables and
   installs the backend, so it needs to write.)
6. Expiry: choose the **shortest** time offered (for example 1 day or 7 days). Setup takes about
   ten minutes.
7. Click through the review step. A red or orange "High" risk banner is normal for a Full access
   token.
8. Click the button that creates the token.
   ✅ Supabase shows the token once. It starts with `sbp_`.
9. Click **Copy**. Do not close that page until you have pasted the token.
10. On the setup page, paste it into the **Access token** box and click **Check**.
    ✅ The setup page says "The token works. Pick your project:" and lists your project.
11. Choose your project and click **Check this project**.
    ✅ The page says your project "is empty and ready to be prepared".

💡 If the page only offers **Create legacy token**, that works too: it gives full access to your
whole account. Delete it as soon as setup is finished.

## Part 3. Delete the token when setup is done

1. Open https://supabase.com/dashboard/account/tokens again.
2. Find the token named `setup`.
3. Click the **⋯** (or trash) button next to it and choose **Delete**, then confirm.
   ✅ The token is no longer in the list. Benji GTM keeps working: it never needed the token
   after setup.

## The project URL and publishable key (only for the Vercel guide)

You need these only if you put Benji GTM online with Vercel ([DEPLOY-VERCEL.md](../DEPLOY-VERCEL.md)).

1. Open https://supabase.com/dashboard and click your project.
2. Click **Connect** at the top of the page.
   ✅ It shows the **project URL** (`https://` + about 20 letters + `.supabase.co`) and the
   **publishable key** (starts with `sb_publishable_`). Each has a copy button.
3. If you don't see **Connect**: the publishable key is in **Settings > API Keys** (the
   "Publishable key" section), and the project URL is in **Integrations > Data API**.

⚠️ Never copy the **secret** key (it starts with `sb_secret_`) or the old `service_role` key into
Vercel, GitHub or a chat. Benji GTM never asks for them.

## What the key looks like

| What | Looks like |
| --- | --- |
| Access token | `sbp_` then about 40 letters and numbers (scoped tokens start with `sbp_fc`) |
| Project URL | `https://abcdefghijklmnopqrst.supabase.co` |
| Publishable key | `sb_publishable_` then a long run of letters and numbers |

## If it doesn't work

- **"This access token isn't allowed to do that."** The token was made with too few permissions
  (for example "Read-only", or "No access" plus a few switches). Delete it and make a new one with
  the **Full access** preset, for your new project.
- **"The token works, but this account has no project yet."** The token doesn't cover the project.
  Either the project is in another Supabase account, or you picked another project or organization
  when making the token. Make a new token and pick the right project.
- **The token is rejected straight away.** It was copied with a space or a missing character, or it
  has expired. Supabase shows a token only once, so make a new one and paste the whole thing.
- **"… is paused."** Free projects pause after 7 days without use. Open
  https://supabase.com/dashboard, click your organization, then the paused project, click
  **Resume project** and confirm. Wait about two minutes, then try again. Your data comes back as
  it was. Supabase's current guide says a paused project can be resumed for up to a year (older
  pages say 90 days), so don't leave it paused.
- **"This project already has data."** Create a new, empty project (Part 1) and use that one.
- **You reached the 2-project limit.** The Free plan allows 2 active projects. Pause or delete a
  project you don't need (in that project: **Settings > General**), or upgrade to Pro.

## Keep it safe

- Never paste the access token, the database password or the secret key into a chat with an AI
  helper, an email or a screenshot. The access token can change everything in your Supabase account.
- Delete the access token when setup is done (Part 3). If you think a token leaked, delete it at
  https://supabase.com/dashboard/account/tokens right away.
- You can make a new token at any time, for example when an update asks for one.

---

Checked against (19 November 2026): https://supabase.com/docs/guides/platform/personal-access-tokens,
https://supabase.com/blog/scope-your-personal-access-tokens,
https://supabase.com/changelog/scoped-personal-access-tokens-ga,
https://supabase.com/docs/guides/api/api-keys,
https://supabase.com/docs/guides/platform/free-project-pausing,
https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically,
https://supabase.com/pricing.
