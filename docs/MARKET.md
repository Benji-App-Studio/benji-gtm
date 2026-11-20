# App stores research: see what's working in the app stores

> **What this file is for:** using the **Research › App stores** tab to research the apps you'd compete with: which
> apps win in your category, how your competitors' apps are rated and priced, how often they ship,
> and what their users love and hate.
>
> **When to use it:** before you build an app (to pick a gap worth filling) and every week or two
> after (to watch your competitors). The App Store part is free and needs no key. Allow 10 minutes
> the first time.

## Before you start

- Benji GTM running (`bash start.command`), signed in, with your app added.
- Optional: your **OpenAI key** in **Settings > Your keys** ([how](keys/openai.md)). It writes the
  review summaries and the chart reads. Each one costs a few cents.
- Optional: your **Apify token** ([how](keys/apify.md)), only for Google Play apps. Google Play has
  no free official API, so its reviews come from an Apify actor: about $0.02 per refresh, from your
  Apify credit. App Store apps never need it.

## Find what wins in your category

1. Open your app, then **Research** in the sidebar, then the **App stores** tab, then **Top charts**.
2. Pick **Top grossing**, your category (for example **Health & Fitness**) and your country.
   Top grossing shows what people pay for; Top free shows what people download.
3. Read the list: each app's rating, how many people rated it, its price and when it was last updated.
   An old leader with many ratings that hasn't shipped in months is often a gap.
4. With your OpenAI key set, click **Summarize** on **What wins in this chart**.

✅ **Checkpoint:** you see 100 ranked apps, and (with the key) a short read of their patterns,
pricing and openings.

## Track your competitors' apps

1. On the **Competitors' apps** tab, click **Track an app**.
2. Type the app's name, or paste its App Store link (from the App Store's **Share** button), pick the
   store country and click **Find**. Click **Track** on the right app. You can also click **Track**
   on any row in **Top charts**.
3. If your competitor list (on Research › Ads) already has names, click **Find their apps** to
   track their App Store apps in one go.
4. Click a tracked app to open it: rating, version, how often it ships, the reviews by stars, its
   releases and its newest reviews.
5. With your OpenAI key set, click **Summarize** under **What users say**. You get what users love, complain about,
   ask for and say about price, each with real quotes copied from the reviews.

✅ **Checkpoint:** your competitors are listed with their rating, price and "updated N days ago",
and each opened app shows what its users say.

## Find the gaps

1. Summarize the reviews of two or three tracked apps.
2. Open the **Opportunities** tab.

✅ **Checkpoint:** a ranked list of the complaints and requests your competitors' users share, each
with quotes. The ones at the top, shared by several apps, are the gaps a new app could fill.

## Troubleshooting

- **"Market isn't set up in your database yet":** your copy is older than this page. Follow
  [UPDATING.md](UPDATING.md); it adds Market's tables and backend.
- **"The App Store is limiting requests right now":** Apple allows about 20 requests a minute. Wait a
  minute and try again.
- **No reviews for an app:** Apple's review feed gives the 50 newest reviews per country, and some
  apps get none in it. Refresh reads the US, UK, Canadian and Australian stores each time, so the count
  grows as you refresh over days.
- **The rating trend is empty:** it needs snapshots from two different days. Refresh the app again
  tomorrow.

💡 **Beginner tip:** refresh your competitors once a week. The trend, the release history and the
review count all build up from those refreshes.
