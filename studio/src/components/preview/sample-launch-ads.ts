// Sample answer for Launch › Ads in the development preview (/preview/launch-ads) and the example app:
// the sample world's launched ads (sample-world.ts), run through the real join (lib/launch/tracking.ts)
// so the page shows what the server would send, with the same days Measure reads. Add ?ads=0 for the
// empty state.
import { m } from "@/lib/i18n/translate";
import { DEFAULT_THRESHOLDS, type Thresholds } from "@/lib/launch/promotion";
import { trackLaunchedAds, type AdInput, type AttributedInput, type DayInput, type DraftInput } from "@/lib/launch/tracking";
import { ADS, adDay, adName, adSetOf, bundled, COMPETITORS, CREATIVES, creativeImage, day, english, WORLD, type Tx } from "./sample-world";

/** Launch settings' rules: judged on paying customers against the target CAC. */
export const SAMPLE_THRESHOLDS: Thresholds = { ...DEFAULT_THRESHOLDS, conversionEvent: "purchase", targetCac: WORLD.targetCac };

/** The competitor ad batch b1 was made from (Research's first Peakfinder ad). */
export const SOURCE_AD = { libraryId: "1234567890123", headline: "Find a trail in 30 seconds", paidAdId: "ad1" };

export function sampleLaunchedAds(days: number, tx: Tx = english) {
  const empty = typeof location !== "undefined" && new URLSearchParams(location.search).get("ads") === "0";
  const since = day(-(days - 1)), until = day(0);
  const ads: AdInput[] = ADS.map((ad) => {
    const set = adSetOf(ad);
    return {
      ad_id: ad.adId, name: adName(ad), status: ad.status, campaign_id: set.campaignId, adset_id: set.adSetId, adset_name: set.adSetName, creative_id: `mc_${ad.creative}`, thumbnail_url: null, format_id: ad.format,
      ...(ad.status === "DISAPPROVED" ? { delivery: { configured: "ACTIVE", issues: [{ summary: tx(m("Ad rejected: it mentions a price the landing page doesn't show.")) }], created: `${day(ad.sent)}T10:00:00+0000` } } : {}),
    };
  });
  const drafts: DraftInput[] = ADS.map((ad, n) => ({
    id: `d${n + 1}`, ad_id: ad.adId, creative_ref: ad.creative, ad_name: adName(ad), adset_id: adSetOf(ad).adSetId, stage: ad.stage, status: "draft", error: null,
    creative: ad.creative === "gone" ? { url: creativeImage("gone"), kind: "image", title: "Before and after, old cut", batchId: "b2" } : { url: creativeImage(ad.creative), kind: "image" },
    source: ad.promotedFrom ? "promotion" : "manual", promoted_from_ad_id: ad.promotedFrom ?? null, created_at: `${day(ad.sent)}T10:00:00Z`,
  }));
  // One still on its way to Meta.
  drafts.push({ id: "d7", ad_id: null, creative_ref: "c2", creative: { url: creativeImage("c2"), kind: "image" }, ad_name: adName({ stage: "TEST", format: "carousel", hook: "how-to", named: 0 }), adset_id: WORLD.testing.adSetId, stage: "TEST", status: "creating", source: "manual", promoted_from_ad_id: null, error: null, created_at: `${day(0)}T08:00:00Z` });

  const metaDays: DayInput[] = [];
  const attributed: AttributedInput[] = [];
  for (let i = -(days - 1); i <= 0; i++) {
    const date = day(i);
    for (const ad of ADS) {
      const d = adDay(ad, i);
      if (!d) continue;
      metaDays.push({ ad_id: ad.adId, date, spend: d.spend, impressions: d.impressions, clicks: d.clicks, installs: d.meta.installs, trials: d.meta.trials, purchases: d.meta.purchases, purchase_value: d.meta.value });
      attributed.push({ ad_id: ad.adId, date, media_source: "meta", installs: d.appstack.installs, trials: d.appstack.trials, purchases: d.appstack.purchases, revenue_usd: d.appstack.revenue });
    }
  }
  const peak = COMPETITORS[0];
  const tracking = trackLaunchedAds({
    range: { since, until }, currency: "USD", usdPerUnit: 1, split: "appstack",
    // Measure's LTV (RevenueCat's realized 30-day LTV per paying customer), as the server passes it.
    ltvUsd: WORLD.ltvDay30, thresholds: SAMPLE_THRESHOLDS,
    testingAdSetId: WORLD.testing.adSetId, scalingAdSetId: WORLD.scaling.adSetId, adAccountId: WORLD.adAccountId, appCode: WORLD.appCode,
    drafts: empty ? [] : drafts, ads: empty ? [] : ads, days: metaDays, attributed,
    creatives: CREATIVES.filter((c) => c.approved).map((c) => ({ id: c.id, url: creativeImage(c.id), thumbnail_url: null, kind: "image", prompt: `A weekend hiker checks Trailmix at a trailhead: ${c.title}.`, title: c.title, headline: null, format_card_id: null, format_slug: c.format, hook_type: c.hook, batch_id: c.batch, created_at: `${day(-41)}T09:00:00Z` })),
    sources: [{ batchId: "b1", paidAdId: SOURCE_AD.paidAdId, libraryId: SOURCE_AD.libraryId, pageName: peak.name, thumb: bundled(WORLD.competitorAdPath), headline: SOURCE_AD.headline, url: `https://www.facebook.com/ads/library/?id=${SOURCE_AD.libraryId}` }],
  });
  return { ...tracking, days, thresholds: SAMPLE_THRESHOLDS, adAccountId: WORLD.adAccountId, testingAdSetId: WORLD.testing.adSetId, scalingAdSetId: WORLD.scaling.adSetId, syncedAt: new Date(Date.now() - 3_600_000).toISOString() };
}
