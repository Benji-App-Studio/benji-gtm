# Meta Ad Library token

> **What this does in the app:** Research pulls competitors' ads from Meta's official Ad Library API, for free.
> Without it, Meta ads come only from the paid Apify scraper or from a file you import by hand.
>
> **Required or optional:** Optional.
>
> **What it costs:** Free. Meta doesn't charge for the Ad Library API.

## Read this first: it only covers ads shown in Europe and the UK

Meta's Ad Library API returns normal (commercial) ads **only if they were shown to people in the
European Union, Iceland, Liechtenstein, Norway or the United Kingdom**. For every other country it
returns only political and social-issue ads.

What that means for you:

- A competitor that advertises only in the US returns **nothing** through this token. That is normal,
  not a broken token.
- The API returns the ad's text, dates and Page, but **no images or videos**.
- Benji GTM uses this token only for competitors whose countries include an EU or UK country. For
  every other country it uses Apify (paid, and only after you confirm the cost).

If your competitors don't advertise in Europe or the UK, you can skip this key.

## Before you start

You need:

- Your own **personal Facebook account**. The token is tied to you as a person.
- A **government ID**: passport, national ID card or driving licence.
- Your **phone**, for a text-message code.
- A computer with a browser. About 20 minutes of clicking, plus waiting time while Meta checks your
  ID (usually one to two days, sometimes longer).

💡 **Beginner tip:** do Part 1 today. The rest only works after Meta has confirmed your identity.

## Steps

### Part 1: Confirm your identity with Meta

1. Open https://www.facebook.com/ID and sign in with your Facebook account.
2. Follow Meta's prompts to confirm your identity and the country you live in. Use your real details;
   the ID must match the country you choose.
3. Wait for Meta's notification or email saying your identity is confirmed.

✅ **Checkpoint:** Meta tells you your identity is confirmed. Don't continue until it does.

### Part 2: Open the Ad Library API page

4. Open https://www.facebook.com/ads/library/api while signed in.
5. If the page asks you to accept terms or start access, do it.

### Part 3: Create a Meta developer account and an app

6. Open https://developers.facebook.com and click **Get Started** (top right). Agree to the Platform
   Policy and confirm your phone or email when asked. If you already see **My Apps** at the top, you
   have a developer account: skip to the next step.
7. Open https://developers.facebook.com/apps/creation/
8. **App details:** type an app name (for example `Benji GTM research`) and your contact email.
   Click **Next**.
9. **Use cases:** select **Other**. Click **Next**. If Meta then asks for an app type, choose
   **Business** and click **Next**.
10. **Business:** choose **I don't want to connect a business portfolio yet.** (or pick your business
    if you prefer). Click **Next**.
11. **Requirements:** click **Next**.
12. **Overview:** click **Go to dashboard**.

✅ **Checkpoint:** you see your app's dashboard, with the app name and an **App ID** at the top.

### Part 4: Get a token

13. Open the Graph API Explorer: https://developers.facebook.com/tools/explorer/
14. On the right, in **Meta App**, choose the app you just made.
15. In **User or Page**, choose **User Token**.
16. Don't add any permissions. Click **Generate Access Token**.
17. A Facebook window opens. Click **Continue** (or **Continue as** your name) to allow it.
18. Test it. In the long box at the top, replace the text with this line and click **Submit**:

    ```
    ads_archive?search_terms=shoes&ad_reached_countries=['GB']&fields=id,page_name
    ```

✅ **Checkpoint:** the answer below starts with `"data": [` and lists ads. An empty list (`"data": []`)
also means it works. An error that mentions your identity or terms means Part 1 or Part 2 isn't
finished yet.

### Part 5: Make the token last 60 days

The token from Part 4 stops working after an hour or two. This part swaps it for one that lasts
about 60 days.

19. Click the small **i** icon next to the token, then **Open in Access Token Tool**.
20. At the bottom of the **Access Token Info** table, click **Extend Access Token**. Enter your
    Facebook password if asked.
21. Copy the new token that appears below the table. This is the one you paste into Benji GTM.

✅ **Checkpoint:** paste the new token into the box at the top of the Access Token Tool and click
**Debug**. **Expires** shows a date about two months away.

### Part 6: Paste it into Benji GTM

22. In Benji GTM, open **Settings > Your keys**.
23. Find the **Meta Ad Library** row and click **Add**.
24. Paste the token into the box.
25. Click **Save and check**.

✅ **Checkpoint:** the row says **Saved. The key was checked and works.** and shows it as set.

26. Put a reminder in your calendar for 55 days from today: "Renew Meta Ad Library token". Repeat
    Parts 4 to 6 then, and use **Replace** on the same row.

## What it looks like

A long string of letters and numbers with no spaces, starting with `EAA`. Usually 150 to 250
characters.

## If it doesn't work

| What you see | What to do |
| --- | --- |
| "Meta rejected this token (wrong or expired)" | The token ran out or was copied badly. Repeat Parts 4 to 6 and use **Replace**. |
| "Meta accepted the token, but it has no Ad Library API access yet" | Your identity isn't confirmed yet, or the Ad Library API terms aren't accepted. Finish Parts 1 and 2, wait for Meta's confirmation, then click **⋯ > Check again** on the row. |
| The check works but Research finds no Meta ads for a competitor | Expected if the competitor doesn't advertise in the EU or UK. Add an EU or UK country to that competitor, or use Apify. |
| "its rate limit was hit" | Meta limits how often you can ask. Wait an hour and try again. |
| The token stopped working before 60 days | Changing your Facebook password or logging out of all sessions cancels it. Make a new one (Parts 4 to 6). |

## Keep it safe

- Never paste the token into a chat with an AI helper, an email or a screenshot. Paste it only into
  Benji GTM's Settings.
- To cancel it: change your Facebook password, or delete the app at
  https://developers.facebook.com/apps (open the app, then **App settings > Basic**, then
  **Delete app** at the bottom of the page).

Checked against: https://developers.facebook.com/docs/graph-api/reference/ads_archive/ ·
https://developers.facebook.com/docs/graph-api/reference/archived-ad/ ·
https://developers.facebook.com/docs/development/create-an-app/ ·
https://developers.facebook.com/documentation/ads-commerce/marketing-api/get-started/authentication ·
https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived/ ·
https://www.facebook.com/ID (19 November 2026). The page https://www.facebook.com/ads/library/api
refused automated reading, so Part 2 is written from the app's own error message, not from that page.
