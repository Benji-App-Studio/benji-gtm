# Higgsfield API key

> **What this key does in the app:** Higgsfield makes the images and videos in Studio and
> Studio's Remix and Templates (Marketing Studio images and Seedance 2.5 videos). Without it, those buttons can't
> generate anything, unless you run the optional desktop runner.
>
> **Required or optional:** Optional (needed for image and video generation).
>
> **What it costs:** The API runs on its own prepaid balance in US dollars, added on the Higgsfield
> API console (minimum top-up $5; added funds expire after one year). It is **separate from a
> Higgsfield web plan**: plan credits and "Unlimited" don't work in the API, and you don't need a
> plan to use the API. Each image or video is charged by model and settings; failed or blocked
> generations are not charged. Checked on Higgsfield's help centre and docs.higgsfield.ai on
> 19 November 2026.

## Before you start

- A payment card.
- About 10 minutes.
- If you already use higgsfield.ai, you can sign in to the API console with the same account, but
  you still have to add API funds there.

## Steps

### Part 1. Sign in to the API console

1. Open https://open.higgsfield.ai (the old address, console.higgsfield.ai, takes you to the same
   place).
2. Sign in, or create an account.
   ✅ You see the console's **Explore** page with a list of models.

### Part 2. Add funds

1. Open https://open.higgsfield.ai/billing (or click **Billing** in the console menu).
2. Click **Add payment method** (or **Add card**) and enter your card. If it asks for billing
   details (name, email, country), fill them in and save.
3. Click **Add funds**.
4. Type an amount. The minimum is $5; $10 is a good start.
5. Finish the payment.
   ✅ **Balance** on the billing page shows the amount.
6. Optional: under **Auto top-up**, you can let it add money when the balance runs low. Leave it
   **Off** if you prefer to top up by hand.

### Part 3. Create the API key

1. Open https://open.higgsfield.ai/api-keys (or click **API Keys** in the console menu).
2. Click **Create API key**.
3. In **API key name**, type `Benji GTM`.
4. Leave **Set expiration date** switched off (or pick **1 year**). A key that expires stops
   generating without warning.
5. Click **Create key**.
   ✅ A box titled "Keep your API key safe" says "Your API key will only be shown once". The box
   labelled **Higgsfield API Key** holds your key: two parts joined by a colon, `ID:SECRET`.
6. Click **Copy API key**.
   ✅ You see "API key copied". That copied text is already the whole `ID:SECRET` the app needs.
7. Keep the box open until you have pasted the key (Part 4).

💡 You don't need to join anything yourself: the console copies the key ID, a colon and the secret
in one go. If you only have the **key ID** (for example from **Copy ID** in the key list), that is
not enough. The secret is shown only once, so create a new key.

### Part 4. Paste it into Benji GTM

1. Open **Settings > Your keys**.
2. In the **Higgsfield** row (under "Creative"), click **Add** (or **Replace**).
3. Paste the key into the box.
4. Click **Save and check**.
   ✅ The row says "Saved. The key was checked and works."

## What the key looks like

`ID:SECRET`: a key ID, then a colon `:`, then a longer secret, with no spaces. The app sends it to
Higgsfield as `Authorization: Key ID:SECRET`.

## If it doesn't work

- **"Higgsfield rejected this key."** The most common causes: you pasted only the key ID (no colon
  and secret), there is a space before or after it, or the key was disabled, deleted or has
  expired. Open https://open.higgsfield.ai/api-keys: check the key's **Status** is **Active** and
  its **Expiration** has not passed. If in doubt, create a new key and use **Replace**.
- **Generations fail with "insufficient balance" (403).** Your API balance is empty. Add funds
  (Part 2). Credits on a higgsfield.ai web plan don't count.
- **Generations wait or fail with "queue is full" (429).** Too many jobs at once for your account.
  The app waits and retries; you can also run fewer at a time.
- **"You do not have permission to manage API keys".** In a Higgsfield organisation, only admins
  can create keys. Ask an admin, or use your personal account.

## Keep it safe

- Never paste the key into a chat with an AI helper, an email, a screenshot or a file in your
  GitHub copy. Anyone with it can spend your Higgsfield balance.
- To delete or replace a key: open https://open.higgsfield.ai/api-keys, open the key's actions menu,
  and choose **Disable** (temporary) or **Delete** (permanent, can't be undone). Then create a new
  key and paste it into **Settings > Your keys > Higgsfield > Replace**.

---

Checked against (19 November 2026): https://docs.higgsfield.ai, https://docs.higgsfield.ai/docs/authentication,
https://docs.higgsfield.ai/docs/enterprise/access-control, https://docs.higgsfield.ai/docs/concepts/billing-and-retention,
https://docs.higgsfield.ai/docs/concepts/errors,
https://higgsfield.ai/creator-hub/help-center/integrations/what-is-the-higgsfield-api, and the
public page code of the console at https://open.higgsfield.ai (button and field names on the
**API Keys** and **Billing** pages, and the copied key format `ID:SECRET`). Matches the app's
`supabase/functions/creatives/core/hf_api.ts` (`HIGGSFIELD_API_KEY="<id>:<secret>"`).
