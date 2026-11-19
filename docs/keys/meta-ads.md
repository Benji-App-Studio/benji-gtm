# Meta system user token and app secret (and your Meta IDs)

> **What this does in the app:** Launch sends your ads to your Meta ad account as **paused** drafts, and
> Measure reads your Meta spend. Without both of these keys, Launch and Meta spend in Measure don't work.
>
> **Required or optional:** Optional for research. Required for Launch and Meta numbers in Measure.
> You need **both**: the system user token and the app secret, from the **same** Meta app.
>
> **What it costs:** Free. Benji GTM only creates paused ads; nothing spends money until you turn
> an ad on yourself in Ads Manager.

## Before you start

You need:

- A **business portfolio** in Meta Business Suite (the new name for Business Manager) where you are
  an **admin**. Check at https://business.facebook.com/settings/ — if you can open it and see
  **Users** and **Accounts** in the left menu, you're fine.
- Your **ad account** and your **Facebook Page** inside that business portfolio.
- A Meta **developer account**. If you don't have one, open https://developers.facebook.com, click
  **Get Started** and follow the prompts.
- About 30 minutes.

💡 **Beginner tip:** this guide has three parts that happen in two places: the Meta developer site
(the app and its secret) and Business settings (the system user and its token). Keep both tabs open.

## Steps

### Part 1: Create a Meta app in your business portfolio

1. Open https://developers.facebook.com/apps/creation/
2. **App details:** type an app name (for example `Benji GTM launch`) and your contact email.
   Click **Next**.
3. **Use cases:** select **Create & manage ads with Marketing API**. Click **Next**.
4. **Business:** choose the business portfolio that owns your ad account. Click **Next**.
5. **Requirements:** click **Next**.
6. **Overview:** click **Go to dashboard**.

✅ **Checkpoint:** you see your app's dashboard. The **App ID** (a number) is shown at the top. Write
it down: you need it in Part 6.

### Part 2: Copy the app secret

7. In the app dashboard's left menu, open **App settings > Basic**.
8. Next to **App secret**, click **Show**. Enter your Facebook password if asked.
9. Leave this tab open. You will paste the secret in Part 5.

💡 Optional but recommended: in the left menu open **App settings > Advanced**, scroll to
**Security** and turn on **Require App Secret**. Benji GTM signs every call, so nothing breaks.

### Part 3: Create a system user

A system user is a robot account inside your business. Its token doesn't depend on your personal
login, so it keeps working.

10. Open https://business.facebook.com/settings/ (Business settings). At the top left, make sure the
    right business portfolio is selected.
11. In the left menu, open **Users > System users**.
12. Click **+ Add**.
13. Type a name (for example `Benji GTM launcher`) and choose the role **Employee**. Click
    **Create system user**.

✅ **Checkpoint:** the new system user appears in the list.

💡 Choose **Employee**, not **Admin**. An admin system user can reach everything in the business;
an employee only reaches what you give it in Part 4.

### Part 4: Give the system user your app, ad account and Page

14. Click the system user's name, then click **Assign assets**.
15. Choose **Apps**, tick your app from Part 1, turn on **Manage app** (full control) and click
    **Assign assets**.
16. Click **Assign assets** again. Choose **Ad accounts**, tick your ad account, turn on full control
    (**Manage ad account**) and click **Assign assets**.
17. Click **Assign assets** again. Choose **Pages**, tick your Facebook Page, turn on full control and
    click **Assign assets**.
18. Optional: repeat for **Datasets** (pixels) if you want Benji GTM to list your pixel. Viewing is
    enough.
19. Reload the page and click the system user again.

✅ **Checkpoint:** under the system user's assigned assets you see your app, your ad account and your
Page.

### Part 5: Generate the token and paste both keys

20. With the system user selected, click **Generate token** (it may say **Generate new token**).
21. Choose the app from Part 1.
22. For **Token expiration**, choose **Never**. If Meta only offers **60 days** for your business,
    choose that and set a calendar reminder to make a new token in 55 days.
23. Tick these permissions: **ads_management**, **ads_read**, **business_management**,
    **pages_read_engagement** and **pages_show_list**. If **pages_manage_ads** is in the list, tick it
    too. Leave everything else unticked.
24. Click **Generate token**.
25. Click **Copy**. Meta shows the token only once.

✅ **Checkpoint:** the token starts with `EAA`.

26. In Benji GTM, open **Settings > API keys**.
27. Find **Meta system user token**, click **Add**, paste the token and click **Save and check**. It
    says Meta accepted the token and asks for the app secret too. That's expected.
28. Find **Meta app secret**, click **Add**, paste the secret from step 8 and click **Save and check**.

✅ **Checkpoint:** the app secret row says **Saved. The key was checked and works.** and both rows show
as set.

### Part 6: Add your Meta IDs to your app

These IDs aren't secret. They tell Benji GTM which ad account and Page to use for one app.

29. In Benji GTM, open **Settings**. Under **Your apps** in the left menu, click your app.
30. In **Connections**, find the **Meta** card and fill in the fields below. Each one comes from a
    different place:

| Field | Where to find it |
| --- | --- |
| **Ad account ID** | Open https://adsmanager.facebook.com. Click the account name at the top left: the drop-down lists each ad account with its ID (a long number). You can paste it with or without `act_`. Also in Business settings > **Accounts > Ad accounts**. |
| **Facebook Page ID** | Open your Facebook Page, click **About** (under the cover photo), then **Page transparency**. The Page ID is shown there. Also in Business settings > **Accounts > Pages**. |
| **Instagram account ID** | Business settings > **Accounts > Instagram accounts** > click the account. Use the number, not the @handle. |
| **Pixel / dataset ID** | Open Events Manager at https://business.facebook.com/events_manager2 > **Data sources** > click your dataset > **Settings** tab. Copy the **Dataset ID** (it is the same number as the old pixel ID). |
| **Meta app ID** | The **App ID** at the top of your app's dashboard (Part 1), also under **App settings > Basic**. |

31. Click **Save**.
32. Click **Verify**.

✅ **Checkpoint:** the card says something like *Ad account "Your account" (USD) is readable. Page
"Your Page" is readable.*

## What it looks like

- **System user token:** starts with `EAA`, letters and numbers, no spaces, usually 150 to 250
  characters.
- **App secret:** exactly 32 characters, made of the digits 0–9 and the letters a–f.
- **IDs:** numbers only (the ad account ID may start with `act_`).

## If it doesn't work

| What you see | What to do |
| --- | --- |
| "Meta rejected this token (wrong, expired or revoked)" | Make a new token (Part 5, steps 20–25) and use **Replace** on the token row. |
| "Meta rejected the app secret for this token. Both must come from the same Meta app" | The token was made for a different app than the secret. In step 21 pick the same app the secret comes from, or copy the secret from the app you picked. |
| "The system user can't read this ad account" | The ad account isn't assigned to the system user, or the token lacks **ads_read**. Redo Part 4 step 16, then **Verify**. If the token was made without ads_read, make a new one. |
| "The ad account is readable, but the Page isn't" | Assign the Page to the system user (Part 4 step 17) and check the Page ID. |
| You don't see **System users** in Business settings | You're not an admin of that business portfolio. Ask an admin to make you one, or to do Parts 3 to 5. |
| You can't add a system user | The business must have an app connected. Make sure Part 1 step 4 picked this business (or add the app under Business settings > **Accounts > Apps**). |
| **Never** isn't offered in step 22 | Some businesses must use 60-day tokens. Use 60 days and renew it before it runs out. |
| "Meta's rate limit was hit" | Wait a few minutes and try again. |

## Keep it safe

- Never paste the token or the app secret into a chat with an AI helper, an email or a screenshot.
  Paste them only into Benji GTM's Settings.
- To cancel the token: Business settings > **Users > System users** > click the system user >
  **Revoke tokens**. Then make a new one.
- To change the app secret: app dashboard > **App settings > Basic** > **Reset** next to App secret.
  Then paste the new one with **Replace**.

Checked against: https://developers.facebook.com/docs/development/create-an-app/ ·
https://developers.facebook.com/documentation/development/create-an-app/marketing-api-use-cases ·
https://developers.facebook.com/docs/marketing-api/get-started/authorization ·
https://developers.facebook.com/documentation/ads-commerce/marketing-api/get-started/authentication ·
https://developers.facebook.com/docs/marketing-api/businessmanager/systemuser/types ·
https://developers.facebook.com/docs/marketing-api/businessmanager/systemuser/install-apps-and-generate-tokens ·
https://developers.facebook.com/documentation/business-messaging/whatsapp/access-tokens ·
https://developers.facebook.com/docs/graph-api/securing-requests/ ·
https://www.facebook.com/business/help/150420221693110 · https://www.facebook.com/help/1503421039731588
(19 November 2026). The Instagram account ID and dataset ID locations come from Meta's interface as
described by several setup guides; Meta's own help pages for them could not be read.
