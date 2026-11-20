# Apify API token

> **What this key does in the app:** Apify collects your competitors' Instagram, TikTok, YouTube
> and X posts, and their Meta and Google ads (and, if you switch it on, TikTok ads shown in Europe)
> when you click **Collect ads**. Which ad sources run is set in Settings > Research sources; see
> [COLLECTING-ADS.md](../COLLECTING-ADS.md). Without it, you add competitors' posts and ads by hand.
>
> **Required or optional:** Recommended (optional).
>
> **What it costs:** The Free plan includes $5 of usage every month, with no card needed. Unused
> credit does not carry over. When you need more, the Starter plan is $19 a month ($17 a month paid
> yearly). Checked on apify.com/pricing on 19 November 2026.

## Before you start

- An email address, or a Google or GitHub account.
- About 5 minutes.

## Steps

### Part 1. Create your account

1. Open https://console.apify.com/sign-up.
2. Sign up with your email, or click **Google** or **GitHub**.
3. If Apify sends you a confirmation email, open it and click the link.
4. If Apify asks a few questions about how you'll use it, answer them or skip them.
   ✅ You see Apify Console, with a menu on the left.

### Part 2. Create the token

1. Open https://console.apify.com/settings/integrations (or click **Apify** on the setup page). It
   is the same as **Settings** (bottom left) > **API & Integrations**.
2. In the **Personal API tokens** section, click **Create a new token**.
3. In the description, type `Benji GTM`.
4. Leave **Limit token permissions** switched **off**. (A limited token can't run the collectors
   Benji GTM uses.)
5. Leave the expiration date empty, or pick a date far in the future.
6. Click **Create**.
   ✅ Apify shows the new token once. It starts with `apify_api_`.
7. Click the copy button next to the token.
8. Click **Done** only after you have pasted it (Part 3). Apify won't show it again.

### Part 3. Paste it into Benji GTM

During setup (step 5, "Add your keys"):

1. Paste the token into the **Apify key** box.
2. Click **Save and check**.
   ✅ The box shows a **Saved** badge and "This key works. It is saved in your project (ends in …)".

Later, in the app:

1. Open **Settings > Your keys**.
2. In the **Apify** row (under "Research"), click **Add** (or **Replace**).
3. Paste the token into the box.
4. Click **Save and check**.
   ✅ The row says "Saved. The key was checked and works."

## What the key looks like

`apify_api_` followed by about 36 letters and numbers (about 46 characters in all).

## If it doesn't work

- **"Apify rejected this token."** It was copied with a space or a missing piece, it was deleted,
  or its expiration date has passed. Create a new token (Part 2) and paste it again.
- **The token saves, but collecting fails with a permission error.** The token was made with
  **Limit token permissions** switched on. Create a new token with it switched off.
- **Collecting stops partway through the month.** The $5 free monthly credit is used up. Check
  **Billing** in Apify Console; wait for next month or upgrade.
- **You can't find the token you made earlier.** Apify shows a token's value only once. Create a new
  one, paste it, and delete the old one.

## Keep it safe

- Never paste the token into a chat with an AI helper, an email, a screenshot or a file in your
  GitHub copy. Anyone with it can use your Apify account and its credit.
- To delete or replace a token: open https://console.apify.com/settings/integrations, find it in
  **Personal API tokens**, and delete it (or use **Rotate**, which gives a new value). Then paste
  the new one into **Settings > Your keys > Apify > Replace**.

---

Checked against (19 November 2026): https://docs.apify.com/platform/integrations/api,
https://docs.apify.com/api/v2, https://apify.com/pricing.
