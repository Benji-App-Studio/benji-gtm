# Mixpanel service account

> **What this does in the app:** Measure reads your own funnel from Mixpanel (install, sign-up,
> paywall view, trial start, purchase), the retention curve of each day's installs, your daily active
> users and, with a saved funnel, how long people take from install to purchase. Without it, Measure
> has no funnel or retention numbers.
>
> **Required or optional:** Optional. Only useful if your app sends its events to Mixpanel.
>
> **What it costs:** Free. Service accounts come with every Mixpanel plan. Benji GTM makes at most
> eight read queries per sync, well inside Mixpanel's limit of 60 an hour per project.

## Before you start

You need:

- A Mixpanel account with your app's **project** in it: https://mixpanel.com
- The **Owner** or **Admin** role in your Mixpanel organization (or on the project). Only they can
  create service accounts. If you're not one, ask an admin to do Part 1 for you.
- About 5 minutes.

## Steps

### Part 1: Create a service account

1. Open https://mixpanel.com and sign in.
2. Click the gear icon (top right), then **Organization settings**. (Or go straight to
   https://mixpanel.com/settings/org#serviceaccounts.)
3. In the left menu, open **Service accounts**.
4. Click **Add service account**.
5. Type a name, for example `Benji GTM Measure`.
6. For the role, choose **Analyst** (read access is all Benji GTM needs; **Consumer** also works if
   your plan has it).
7. Under projects, add your app's project.
8. Leave the expiry empty (never), or pick a date if your team rotates keys.
9. Click **Add**.
10. Mixpanel shows the **username** and the **secret**. Copy both now: the secret is shown only once.

✅ **Checkpoint:** the new service account is listed under **Service accounts** with your project.

💡 If you only want this account to see one project, create it from **Project settings > Service
accounts** instead: it gets access to that project only.

### Part 2: Paste it into Benji GTM

11. In Benji GTM, open **Settings**. Under **Your apps** in the left menu, click your app.
12. Find the **Mixpanel** card in **Connections**.
13. In **Mixpanel key**, paste the username, a colon, then the secret, with no spaces:
    `username:secret`. (You can also add it under **Settings > Your keys**, in the **Mixpanel** row.)

### Part 3: Add the project ID and where its data lives

14. Back in Mixpanel, click the gear icon, then **Project settings**. On **Overview**, copy the
    **Project ID** (a number, for example `3141592`). The number in the project's address
    (`mixpanel.com/project/3141592/…`) is the same ID; pasting the whole address works too.
15. On the same page, check **Data residency**: **US**, **EU** or **India**.
16. In Benji GTM's Mixpanel card, paste the ID into **Project ID** and type `us`, `eu` or `in`
    into **Data residency** (empty means `us`).

### Part 4: Map your events (only if your names differ)

17. Open **Event names (optional)** on the card. Each field shows the name Benji GTM uses when it
    is left empty:

    | Field | Default | What to put there |
    | --- | --- | --- |
    | Install event | `$ae_first_open` | The event a new install sends. `$ae_first_open` only arrives if Mixpanel's automatic events are on, and they're off by default in Mixpanel's current SDKs, so most apps enter their own first-open event here. |
    | Sign-up event | `Sign Up` | Your sign-up or account-created event. |
    | Paywall view event | `Paywall Viewed` | Sent when the paywall shows. Superwall's Mixpanel integration sends `paywall_open`. |
    | Trial start event | `Trial Started` | Sent when a free trial starts. |
    | Purchase event | `Purchase` | Sent on a first paid purchase. |
    | Active user event | `$ae_session` | What counts as using the app that day. `$ae_session` is also an automatic event, so most apps enter their own here. |

    Not sure of your event names? Click **Connect**: when the install event finds nobody, the card lists
    the project's most common events from the last 31 days.

    **Data view ID (optional):** only if your Mixpanel project uses Data Views. Enter the data view's ID
    so Benji GTM reads the same data you see in Mixpanel.

    Names must match Mixpanel exactly, capitals included. To see yours: Mixpanel > **Data
    management > Lexicon** (or **Events**), and copy each name.
18. **Saved funnel ID (optional)**, for time to convert: in Mixpanel, build a **Funnels** report from
    your install event to your purchase event, save it, and copy the number from its address. The
    Query API can only read a saved funnel's time to convert.

### Part 5: Connect

19. Click **Connect**. Benji GTM saves the key and the IDs, checks them with a real query, then
    loads the last 90 days.

✅ **Checkpoint:** the card says *Connected* with the number of installs it found, and **Open
Measure** shows the **Funnel and retention** section.

## What it looks like

- **Username:** something like `measure.a1b2c3.mp-service-account`.
- **Secret:** about 32 letters and numbers. No spaces.
- **Project ID:** numbers only.

## If it doesn't work

| What you see | What to do |
| --- | --- |
| "Mixpanel rejected the service account" | The username or secret is wrong, or the account expired. Paste `username:secret` again, or make a new service account (Part 1). |
| "Paste the service account as username:secret" | The colon is missing. Paste the username, a colon, then the secret. |
| "The Mixpanel service account can't read this project" | Add the project to the service account (Organization settings > Service accounts > the account > Projects). |
| "Mixpanel doesn't know this project here" or "refused the query" | The project ID is wrong, or the data residency is (an EU project needs `eu`). |
| "nobody did "$ae_first_open"…" / "No one did …" | That event name isn't in your project. Fix it under **Event names** (Part 4). |
| "Mixpanel's rate limit was hit" | Mixpanel allows 60 queries an hour per project. Wait an hour and sync again. |

## Keep it safe

- The secret can read all your Mixpanel data. Never paste it into a chat with an AI helper, an email
  or a screenshot. Paste it only into Benji GTM.
- To cancel it: Mixpanel > **Organization settings > Service accounts**, delete the account. Then
  make a new one and use **Replace** on the card.

Checked against: https://docs.mixpanel.com/reference/service-accounts ·
https://docs.mixpanel.com/reference/segmentation-query · https://docs.mixpanel.com/reference/retention-query ·
https://docs.mixpanel.com/reference/funnels-query · https://docs.mixpanel.com/reference/rate-limits
(20 November 2026). The role names in step 6 and the location of **Data residency** in step 15 come
from Mixpanel's settings pages as described by its docs, not from screenshots.
