# TikTok Commercial Content API (client key and secret)

> **What this does in the app:** Research pulls competitors' TikTok ads from TikTok's official ad library.
> Without it, a brand's TikTok ads shown in Europe can still come through Apify (Settings > Research
> sources > TikTok ads in Europe, about $0.30 per 100 ads).
>
> **Required or optional:** Optional (Advanced). **Most people can't get this**: TikTok approves
> each application by hand, and many are refused.
>
> **What it costs:** Free, if TikTok approves you.

## Read this first

- **It's by application.** You apply on TikTok for Developers and TikTok reviews it. TikTok presents
  the API as being for researchers and the public; companies doing competitor research are often
  turned down. Expect to wait, and expect a possible "no".
- **It only covers ads shown in Europe.** TikTok's ad library holds ads shown in Europe (the EU and
  nearby countries). A competitor advertising only in the US returns nothing.
- **No switch needed.** Once both keys are saved, **Settings > Research sources** shows **TikTok's
  official API** as on (it's on **Auto**). Switch it off there if you don't want it. An older setting
  `RESEARCH_TIKTOK` in your Supabase project still wins over that choice if someone set it.

If any of this rules you out, skip this key.

## Before you start

You need:

- An **official email address** (a work or university address, not a free webmail one) to create a
  TikTok for Developers account.
- A short description of what you'll use the data for.
- Time: the review can take days or weeks.

## Steps

### Part 1: Apply

1. Open https://developers.tiktok.com/products/commercial-content-api
2. Create a TikTok for Developers account with your official email address (or sign in if you have one).
3. Follow the page's steps to apply for the Commercial Content API. Describe your use honestly.
4. Wait for TikTok's answer by email. Questions go to commercial-research-questions@tiktok.com.

✅ **Checkpoint:** TikTok emails you that your application is approved.

### Part 2: Find the client key and secret

5. Sign in at https://developers.tiktok.com and open the project TikTok approved.
6. Find the research client's registration details. The **Client key** is shown there.
7. Next to **Client secret**, click **Display** to reveal it.

### Part 3: Paste both into Benji GTM

8. In Benji GTM, open **Settings > Your keys**.
9. Find **TikTok research client key**, click **Add**, paste the client key and click **Save and
   check**. It says it's waiting for the secret. That's expected.
10. Find **TikTok research client secret**, click **Add**, paste the client secret and click **Save
    and check**.

✅ **Checkpoint:** the row says **Saved. The key was checked and works.** Benji GTM asked TikTok for
a token with the pair, and TikTok gave one.

## What it looks like

Two strings of letters and numbers from the same TikTok project: a shorter **client key** and a longer
**client secret**. No spaces.

## If it doesn't work

| What you see | What to do |
| --- | --- |
| "TikTok rejected this client key and secret" | They come from different projects, were copied badly, or the project isn't approved for the Commercial Content API. Copy both again from the approved project. |
| Both keys are saved but Research finds no TikTok ads | Check that **TikTok's official API** is on in Settings > Research sources, that no `RESEARCH_TIKTOK` setting turns it off, and that the competitor advertises in Europe. |
| Your application was refused | Switch on **TikTok ads in Europe** in Settings > Research sources (it uses your Apify key). See [COLLECTING-ADS.md](../COLLECTING-ADS.md). |

## Keep it safe

- Never paste the client secret into a chat with an AI helper, an email or a screenshot. Paste it only
  into Benji GTM's Settings.
- If the secret leaks, contact TikTok through TikTok for Developers to reset it, then use **Replace**
  on the secret row.

Checked against: https://developers.tiktok.com/products/commercial-content-api ·
https://developers.tiktok.com/docs/en/commercial-content-api-getting-started ·
https://developers.tiktok.com/docs/en/client-access-token-management ·
https://newsroom.tiktok.com/tiktoks-research-api-and-commercial-content-library (19 November 2026).
TikTok's developer site refused automated reading, so these steps come from search excerpts of those
pages. The exact menu names after approval, the eligibility rules and the list of countries could not
be read in full.
