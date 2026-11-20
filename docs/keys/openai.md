# OpenAI API key

> **What this key does in the app:** OpenAI is the AI that writes your product profile, reads
> competitors' ads and videos, writes the analysis and ad copy, and checks creatives. Without it,
> research and analysis don't work (unless you switch to TypeSafe for some jobs).
>
> **Required or optional:** Required.
>
> **What it costs:** Pay as you go, from prepaid credit (minimum purchase $5; $10 is filled in by
> default). The app's default text and vision model, `gpt-6.1-sol`, costs $2 per million input
> tokens and $10 per million output tokens; speech to text (`whisper-1`) costs $0.006 a minute.
> A typical competitor analysis costs cents, not dollars. Image generation with OpenAI
> (`gpt-image-2.5-flare` and `-sunburst`) costs more and may need organisation verification (see
> below). A ChatGPT Plus or Pro subscription does **not** include API credit. Checked on
> developers.openai.com/api/docs/pricing on 19 November 2026.

## Before you start

- An email address (or a Google, Microsoft or Apple account).
- A payment card. The API has no free credit.
- About 10 minutes.

## Steps

### Part 1. Create your account

1. Open https://platform.openai.com/signup.
2. Sign up with your email, or with Google, Microsoft or Apple. If you already use ChatGPT, you can
   sign in with the same account.
3. If OpenAI asks for your name, birthday or a phone number, fill them in and continue. If it asks
   for an organisation name, type your own name or your company's.
   ✅ You see the OpenAI Platform dashboard.

### Part 2. Add credit

1. Open https://platform.openai.com/settings/organization/billing/overview.
2. Click **Add payment details** (or **Add payment method**) and enter your card.
3. Click **Buy credits** (the button may say **Add to credit balance**).
4. Type an amount. $10 is plenty to start; the minimum is $5.
5. Decide on **auto recharge**: it is switched on by default and tops up your balance when it runs
   low. Turn it off if you prefer to top up by hand.
6. Click **Continue**, then confirm the payment.
   ✅ The billing page shows your **credit balance** (for example $10.00). It can take a few
   minutes to appear.

### Part 3. Create the secret key

1. Open https://platform.openai.com/api-keys (or click **OpenAI** on the setup page).
2. Click **Create new secret key**.
3. **Owned by:** leave **You** selected.
4. **Name:** type `Benji GTM`.
5. **Project:** leave **Default project** (or pick your own project if you made one).
6. **Permissions:** choose **All**.
7. Click **Create secret key**.
   ✅ A box shows the new key once. It starts with `sk-proj-`.
8. Click **Copy**. Don't close the box until you have pasted the key.

### Part 4. Paste it into Benji GTM

During setup (step 5, "Add your keys"):

1. Paste the key into the **OpenAI key** box.
2. Click **Save and check**.
   ✅ The box shows a **Saved** badge and "This key works. It is saved in your project (ends in …)".

Later, in the app:

1. Open **Settings > Your keys**.
2. In the **OpenAI** row, click **Add** (or **Replace** if a key is already there).
3. Paste the key into the box.
4. Click **Save and check**.
   ✅ The row says "Saved. The key was checked and works." and shows "Set, ending …, checked …".

## What the key looks like

`sk-proj-` followed by a long run of letters, numbers, `-` and `_` (well over 100 characters).
Older keys start with `sk-` only; they still work. A key that starts with `sk-admin-` is an admin
key and is the wrong kind.

## If it doesn't work

- **"OpenAI rejected this key."** The key was copied with a space or a missing piece, or it was
  deleted. Create a new secret key (Part 3) and paste it again.
- **"OpenAI accepted the key but it may not list models."** The key was made with **Restricted**
  or **Read Only** permissions. Create a new key with **Permissions: All**.
- **The key saved, but research or analysis fails with "insufficient quota" or "exceeded your
  current quota".** You have no credit. Add credit (Part 2). It can take a few minutes to count.
- **"Your organization must be verified to use the model …"** (403, "organization verification
  required"). OpenAI asks for this before its image models (GPT Image) can be used. Open
  https://platform.openai.com/settings/organization/general and click **Verify Organization**. You
  need a valid government ID; it can take up to 30 minutes to show as verified, and OpenAI does not
  allow retries if it fails. The rest of Benji GTM (text, reading ads, transcripts) works
  without it.
- **"Rate limit reached".** New accounts have lower limits. Wait a minute and try again; the limit
  rises on its own as you use the API.
- **You use several organisations or projects.** Make sure the key is created in the organisation
  that has the credit (the name at the top left of the dashboard).

## Keep it safe

- Never paste the key into a chat with an AI helper, an email, a screenshot or a file in your
  GitHub copy. Anyone with the key can spend your credit.
- To delete or replace a key: open https://platform.openai.com/api-keys, click the **trash** icon
  next to the key and confirm, then create a new one and paste it into **Settings > Your keys >
  OpenAI > Replace**.
- To cap spending, turn off auto recharge on the billing page. The balance is not a hard stop:
  OpenAI may let usage run slightly past zero and take it from your next purchase.

---

Checked against (19 November 2026): https://developers.openai.com/api/docs/quickstart,
https://developers.openai.com/api/docs/pricing,
https://developers.openai.com/api/docs/models/gpt-6.1-sol,
https://developers.openai.com/api/docs/guides/image-generation,
https://help.openai.com/en/articles/8264644-setting-up-and-managing-prepaid-api-billing,
https://help.openai.com/en/articles/8867743-assign-api-key-permissions,
https://help.openai.com/en/articles/10910291-api-organization-verification.
