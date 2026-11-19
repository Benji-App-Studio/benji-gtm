# Collecting competitors' ads

> **What this file is for:** getting your competitors' ads into Benji GTM so you can see what is
> working for them: which ads they keep paying for, in which format, with which hook.
>
> **When to use it:** after you've added competitors on your app's **Research** page, whenever you
> want their newest ads. Choosing a way takes two minutes; collecting takes a few minutes per run.

## The three ways

| Way | Cost | What it gets | Needs |
| --- | --- | --- | --- |
| **The Chrome extension** | Free | One competitor's Meta ads at a time, with images, videos and Meta's impressions order | Chrome on your Mac ([install guide](CHROME-EXTENSION.md)) |
| **Automatic collection through Apify** | Billed per ad from your Apify credit | Meta ads in any country, Google ads in any country, and (if you switch it on) TikTok ads shown in Europe, for one competitor or all at once | An Apify key ([guide](keys/apify.md)) |
| **The official APIs** | Free | Meta: only ads shown in the EU and the UK, as text without images or videos. TikTok: only ads shown in Europe, and only if TikTok approves your application | A Meta Ad Library token ([guide](keys/meta-ad-library.md)); TikTok research keys ([guide](keys/tiktok.md)) |

## Which to choose

- **Starting out, or on a tight budget:** the Chrome extension. It's free and gets the richest Meta data.
- **Several competitors, or you want Google search and YouTube ads too:** add an Apify key. Apify's free
  plan includes $5 of usage a month, which covers thousands of Meta ads.
- **Competitors that advertise in Europe:** add the Meta Ad Library token as well. It's free and adds to
  the other two; on its own it misses every ad shown outside the EU and the UK.

You can use all three together: ads from every way land in the same list, and a competitor's row on the
Research page says which sources found its ads.

## What each automatic source covers

Prices are from each collector's page on the Apify Store (free plan), checked on 19 November 2026.
**Settings > Research sources** shows them in the app.

| Source | Covers | Finds a competitor by | Cost per 100 ads |
| --- | --- | --- | --- |
| Meta ads (Apify) | Every active ad in any country, with images and videos | Facebook Page, else its name | $0.075 (community collector) or $0.58 (Apify's own) |
| Google ads (Apify) | Search, YouTube, Shopping, Maps and Play ads in any country, from Google's Ads Transparency Center (last 12 months) | Google advertiser id, else website, else its name | $0.20, plus $0.20 per 100 text ads for their words |
| TikTok ads in Europe (Apify) | A brand's ads shown in the EU, the UK and Switzerland, with videos | TikTok business id, else business name | $0.30 |
| TikTok Top Ads (Apify) | TikTok's best-performing ads by country and keyword | A keyword (not one brand) | $0.10, plus $0.005 per search |
| Meta's official API | Ads shown in the EU and the UK (and political ads elsewhere), text only | Facebook Page, else its name | Free |
| TikTok's official API | A brand's ads shown in Europe | TikTok business id, else business name | Free (by application) |

**The honest TikTok situation.** TikTok only lists a brand's own ads for ads shown in Europe (the EU,
the UK and Switzerland). A competitor that advertises only in the US has no TikTok ads you can see
anywhere: not in TikTok's library, not through Apify, not through the official API. TikTok Top Ads covers
the US too, but it ranks the best ads by industry and keyword, not one brand's ads, so it rarely shows a
particular competitor. That's why both paid TikTok sources start switched off.

## Steps: set up automatic collection (once)

1. Add your Apify key: follow [keys/apify.md](keys/apify.md) (about 5 minutes).
   ✅ **Checkpoint:** **Settings > API keys** shows Apify as saved and checked.
2. Open **Settings > Research sources**.
   ✅ **Checkpoint:** **Meta ads** and **Google ads** say **On**. Both are on **Auto**, which turns a
   source on as soon as its key is saved.
3. Optional: switch **TikTok ads in Europe** to **On** if your competitors advertise in Europe.
4. Optional: if Meta ads stop coming in, switch **Meta collector** to **Apify's own**. It costs more and
   is maintained by Apify.

Only the workspace owner can change these settings. Members see what is set.

## Steps: tell each source who your competitor is

1. On your app's **Research** page, click **Add or edit** in the Competitors list.
2. Click **Edit** next to a competitor (or add a new one with its name).
3. **Facebook Page:** open the brand's Facebook Page, or its page in the Meta Ad Library, and paste the link.
4. **Website or Google advertiser:** paste the brand's website (for example `notion.so`). For one exact
   account instead, search the brand on https://adstransparency.google.com, open the advertiser and paste
   its link (it contains `AR` followed by numbers).
5. **TikTok business:** search the brand on https://library.tiktok.com with a European country picked,
   and paste the advertiser name it shows (or the link).
6. Click **Save changes**.
   ✅ **Checkpoint:** each field showed "Saved as …" before you saved, and the competitor's line in the
   list shows its Page, website and TikTok name.

Every field is optional. Without one, the source searches for the competitor's name, which can pick up
another brand with a similar name.

## Steps: collect ads

**For one competitor:**

1. On the **Research** page, click **Collect** on the competitor's row.
2. Read the dialog: it lists each source that will run, how many ads it reads at most, and the most it
   can cost, plus anything that can't be collected and why.
3. Click **Collect, up to $…** (or **Collect, free** when only free sources run).
   ✅ **Checkpoint:** the dialog says "Collecting…", then "Done: 41 Meta ads, 12 Google ads, …".

**For every followed competitor:** click **Collect ads** at the top of the Research page, then the same
steps 2 and 3.

You can close the dialog while it runs; collection keeps going and the ads appear when it ends (usually
one to five minutes). New ads are then read for their format and hook in the background.

## What it costs, in practice

The dialog shows the most a collection can cost, assuming every competitor has the maximum number of ads
(200 Meta ads and 100 Google ads per competitor). Real runs usually cost much less: a brand with 30 live
Meta ads costs for 30. Ten competitors on Meta and Google cost at most about $5.50, and typically under
$1. Apify takes it from your Apify credit; see your usage at https://console.apify.com/billing.

## Troubleshooting

- **"No source can collect yet."** No key is saved for any source that is switched on. Add the Apify key
  (Settings > API keys), or switch a source on in Settings > Research sources.
- **"Apify's monthly credit is used up."** Add credit or upgrade at https://console.apify.com/billing,
  then collect again. Nothing was charged for the ads that didn't come in.
- **Google found ads from the wrong company.** The competitor has no website or Google advertiser id, so
  its name was searched. Add its website (step 4 above) and collect again.
- **"TikTok: not available for this brand outside Europe."** The brand shows no TikTok ads in Europe.
  That's TikTok's limit, not a fault: US-only TikTok ads aren't public anywhere.
- **Meta ads stopped coming in.** Collectors sometimes break when Meta changes its site. Switch
  **Meta collector** to **Apify's own** in Settings > Research sources, or use the free Chrome extension.
- **A switch says "Set on the server".** Your Supabase project has an older setting
  (`RESEARCH_TIKTOK` or `RESEARCH_META_APIFY_ACTOR`) that wins over the app. Remove it under the project's
  edge function secrets to choose in the app instead.
- **Media links expired.** Images and videos are saved to your storage right after a collection; if a
  file shows "Media link expired", collect that competitor again.
