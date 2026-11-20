# Superwall API key

> **What this does in the app:** Measure reads your paywalls from Superwall: how often each paywall
> was shown, how many people bought or started a trial from it, the conversion rate per paywall and
> per placement, and the revenue Superwall tracked. Without it, Measure can't tell you which paywall
> converts.
>
> **Required or optional:** Optional. Only useful if your app's paywalls run on Superwall.
>
> **What it costs:** Free. API keys come with your Superwall account.

## Before you start

You need:

- A Superwall account with your app in it: https://superwall.com
- To be an **admin** of your Superwall organization. Only admins can create API keys. If you're not
  one, ask an admin to do Part 1 for you.
- About 5 minutes.

## Steps

### Part 1: Create an organization API key

1. Open https://superwall.com and sign in.
2. Open **Settings**, then **API Keys**.
3. Click **Create key** (it may say **New key**).
4. Type a name, for example `Benji GTM Measure`.
5. Scopes: give it **data:read** (this lets Benji GTM read paywall analytics) and **projects:read**
   (so it can find your app). Both are needed. Leave write scopes off.
6. Project access: choose **all projects**. Superwall's analytics queries refuse a key limited to
   some projects.
7. Create the key and copy it.

✅ **Checkpoint:** the key is listed under **API Keys** with the data:read and projects:read scopes.

### Part 2: Find your app's application ID

8. In Superwall, open your app.
9. Open the app's **Settings**. The **application ID** is a number, for example `9021`. The number in
   the app's address (`superwall.com/applications/9021/…`) is the same ID; pasting the whole address
   works too.

💡 iOS and Android are separate applications in Superwall, each with its own ID. Connect the one
you advertise (one per app in Benji GTM).

### Part 3: Connect in Benji GTM

10. In Benji GTM, open **Settings**. Under **Your apps** in the left menu, click your app.
11. Find the **Superwall** card in **Connections**.
12. Paste the key into **Superwall key** and the number into **Application ID**. (You can also add the
    key under **Settings > Your keys**, in the **Superwall** row.)
13. Click **Connect**. Benji GTM saves the key, finds your app in your Superwall organization, runs
    one small analytics query, then loads the last 90 days.

✅ **Checkpoint:** the card says *Connected* with your app's name and its paywall views, and **Open
Measure** shows the **Paywalls** section.

## What Benji GTM reads

- Superwall's SDK events per day, paywall and placement: `paywall_open` (views),
  `subscription_start` and `nonRecurringProduct_purchase` (paid purchases), `freeTrial_start` (trials)
  and `transaction_start`. Sandbox events are left out.
- Revenue per day from Superwall's revenue table (refunds count as negative amounts).
- Nothing is written to Superwall.

## If it doesn't work

| What you see | What to do |
| --- | --- |
| "Superwall rejected the key" | The key is wrong or was deleted. Make a new one (Part 1) and use **Replace**. |
| "The Superwall key can't read analytics" | The key lacks **data:read** or is limited to some projects. Make a new key with data:read, projects:read and all projects. |
| "The Superwall key can't list projects" | The key lacks **projects:read**. Make a new key with data:read and projects:read. |
| "Superwall has no application … in this key's organization" | The application ID is wrong, or belongs to another organization. Check Part 2. |
| "numbers only" | Paste the application ID (a number), not the app's name or its public key (`pk_…`). |
| "Superwall's rate limit was hit" | Wait a few minutes and sync again. |

## Keep it safe

- The key can read your revenue and paywall data. Never paste it into a chat with an AI helper, an
  email or a screenshot. Paste it only into Benji GTM.
- To cancel it: Superwall > **Settings > API Keys**, delete the key. Then make a new one and use
  **Replace** on the card.

Checked against: https://superwall.com/docs/agents/api ·
https://superwall.com/docs/dashboard/guides/query-clickhouse ·
https://superwall.com/docs/dashboard/dashboard-settings/overview-settings-access-controls ·
https://api.superwall.com/openapi.json (20 November 2026). The exact button labels in steps 3 and 5
and the location of the application ID in step 9 aren't shown in Superwall's docs; they follow its
dashboard as its docs describe it.
