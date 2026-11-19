# RevenueCat secret key

> **What this does in the app:** Measure reads your trials, purchases, refunds and revenue from RevenueCat,
> so it can work out what each customer is worth and when ads pay back. Without it, Measure has no revenue numbers.
>
> **Required or optional:** Optional. Only useful if your app's subscriptions run through RevenueCat.
>
> **What it costs:** The key is free. RevenueCat's own plan is whatever you already pay.

## Before you start

You need:

- A RevenueCat account with your app's **project** in it: https://app.revenuecat.com
- The **Admin** role on that project. Only admins can create secret keys. If you're not one, ask the
  project owner to do steps 1 to 9 for you, or to make you an admin.
- About 5 minutes.

## Steps

### Part 1: Create a secret key (v2)

1. Open https://app.revenuecat.com and sign in.
2. At the top left, pick your app's project.
3. In the left menu, open **Project settings**, then **API keys**.
4. Under **Secret API keys**, click **+ New secret API key** (it may just say **+ New**).
5. Type a name, for example `Benji GTM Measure`.
6. For the version, choose **V2**. (Older V1 keys don't work with the API Benji GTM uses.)
7. Set the permissions. Give **Charts & metrics** read access. This covers
   `charts_metrics:overview:read` and `charts_metrics:charts:read`, the two Benji GTM needs.
   Also give **Project configuration** read access (`project_configuration:projects:read`) so
   Benji GTM can check the key the moment you save it. Leave everything else at no access.
8. Click **Generate** (top right).
9. Copy the key.

✅ **Checkpoint:** the key starts with `sk_` and is listed under **Secret API keys**.

### Part 2: Paste the key into Benji GTM

10. In Benji GTM, open **Settings > API keys**.
11. Find the **RevenueCat** row and click **Add**.
12. Paste the key and click **Save and check**.

✅ **Checkpoint:** the row says **Saved. The key was checked and works.**

If you skipped **Project configuration** in step 7, the row says RevenueCat knows the key but it may
not list projects. That's fine: Part 3's **Verify** checks it properly.

### Part 3: Add the project ID to your app

13. Back in RevenueCat, open **Project settings**, then **General**, and copy the **Project ID**. It
    starts with `proj`, for example `proj1ab2c3d4`.

    💡 The address bar shows a shorter version without `proj` (for example
    `app.revenuecat.com/projects/1ab2c3d4/…`). If that's all you can find, type `proj` in front of it.

14. In Benji GTM, open **Settings**. Under **Your apps** in the left menu, click your app.
15. In **Connections**, find the **RevenueCat** card, paste the ID into **Project ID** and click
    **Save**.
16. Click **Verify**.

✅ **Checkpoint:** the card says *RevenueCat project proj… is readable* with a number of overview
metrics.

## What it looks like

- **Secret key:** starts with `sk_`, then about 30 letters and numbers. No spaces.
- **Project ID:** starts with `proj`, then a few letters and numbers.

## If it doesn't work

| What you see | What to do |
| --- | --- |
| "RevenueCat rejected this key" / "rejected the key" | It's a V1 key, a public key (`appl_`, `goog_`) or it was revoked. Make a new **V2 secret** key (Part 1). |
| "The RevenueCat key can't read charts" | The key lacks Charts & metrics read access. Make a new key with it (step 7) and use **Replace**. |
| "RevenueCat doesn't know this project" | The project ID is wrong. Most often `proj` is missing at the start. Fix it in Part 3. |
| "RevenueCat's rate limit was hit" | RevenueCat allows 25 chart requests a minute. Wait a minute and sync again. |
| You don't see **+ New secret API key** | You're not an admin of the project. Ask the owner. |

## Keep it safe

- A secret key can read your revenue data. Never paste it into a chat with an AI helper, an email or
  a screenshot. Paste it only into Benji GTM's Settings.
- To cancel it: RevenueCat > **Project settings > API keys**, find the key under **Secret API keys**
  and revoke it. Then make a new one and use **Replace**.

Checked against: https://www.revenuecat.com/docs/projects/authentication ·
https://www.revenuecat.com/docs/api-v2 · https://www.revenuecat.com/docs/api-v2/charts-and-metrics ·
https://www.revenuecat.com/docs/api-v2/project (19 November 2026). The exact labels of the
permission picker in step 7 and the **Project settings > General** location in step 13 aren't shown
in RevenueCat's docs; they come from RevenueCat's dashboard as described by setup guides.
