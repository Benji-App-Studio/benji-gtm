// "Send to Meta": the Graph payloads for a campaign, an ad set and an ad creative built from the
// sheet's specs (rules.ts). Pure, so /send's plan shows exactly what would be sent and the tests can
// check every field. Money arrives in major units and leaves through toMinor in the account currency.
// The draft worker (draft.ts) builds the creative once the media is uploaded; everything else that
// gets created is PAUSED (graph.ts refuses anything else).
import { toMinor, URL_TAGS } from "./meta.ts";
import {
  type AdFormat, type AdSetSpec, type AiDisclosure, type CampaignSpec, ctaFor, type MetaObjective, type ParentCampaign, PLATFORMS,
  type PlacementRule, type PromotedObject, type TargetingSpec, targetsEu,
} from "./rules.ts";
import type { CreativeInput } from "./types.ts";

const has = (v: unknown) => v !== null && v !== undefined && v !== "";
const iso = (s: string | null | undefined) => (s ? new Date(s).toISOString() : undefined);

// MARK: Campaign

/** POST /act_{id}/campaigns */
export function campaignBody(c: CampaignSpec, currency: string): Record<string, unknown> {
  const cbo = c.budgetMode === "CBO";
  const special = c.specialAdCategories ?? [];
  return {
    name: c.name.trim(),
    objective: c.objective,
    status: "PAUSED",
    buying_type: "AUCTION",
    special_ad_categories: special,
    ...(special.length ? { special_ad_category_country: c.specialAdCountries } : {}),
    // CBO: the campaign holds the budget and the bid strategy. ABO: no budget fields at all, and
    // budget sharing between ad sets off (Meta asks for the flag on campaigns without a budget).
    ...(cbo
      ? {
        ...(has(c.dailyBudget) ? { daily_budget: toMinor(Number(c.dailyBudget), currency) } : { lifetime_budget: toMinor(Number(c.lifetimeBudget), currency) }),
        bid_strategy: c.bidStrategy ?? "LOWEST_COST_WITHOUT_CAP",
      }
      : { is_adset_budget_sharing_enabled: false }),
    ...(has(c.spendCap) ? { spend_cap: toMinor(Number(c.spendCap), currency) } : {}),
    start_time: iso(c.startTime),
    stop_time: iso(c.stopTime),
    ...(c.objective === "OUTCOME_APP_PROMOTION" && c.skadnetwork ? { is_skadnetwork_attribution: true } : {}),
  };
}

// MARK: Targeting

const geo = (picks: TargetingSpec["locations"]) => {
  const countries = picks.filter((p) => p.type === "country").map((p) => p.key);
  const regions = picks.filter((p) => p.type === "region").map((p) => ({ key: p.key }));
  const cities = picks.filter((p) => p.type === "city").map((p) => ({
    key: p.key, ...(has(p.radius) ? { radius: Number(p.radius), distance_unit: p.distanceUnit ?? "mile" } : {}),
  }));
  return {
    ...(countries.length ? { countries } : {}),
    ...(regions.length ? { regions } : {}),
    ...(cities.length ? { cities } : {}),
  };
};

const placementFields = (rule: PlacementRule) => {
  const out: Record<string, string[]> = { publisher_platforms: [...rule.publisher_platforms] };
  for (const p of PLATFORMS) {
    const positions = rule[`${p}_positions`];
    if (positions?.length && rule.publisher_platforms.includes(p)) out[`${p}_positions`] = [...positions];
  }
  return out;
};

/** The targeting spec. `appStoreUrl` (app promotion) adds the store's OS on mobile. */
export function targetingBody(t: TargetingSpec, appStoreUrl?: string | null): Record<string, unknown> {
  const out: Record<string, unknown> = { geo_locations: geo(t.locations) };
  const excluded = t.excludedLocations ?? [];
  if (excluded.length) out.excluded_geo_locations = geo(excluded);
  const defaultAges = t.ageMin === 18 && t.ageMax === 65;
  if (t.advantageAudience) {
    // With Advantage+ audience the age range is a suggestion Meta may go beyond; the hard limits stay 18–65.
    out.age_min = 18;
    out.age_max = 65;
    if (!defaultAges) out.age_range = [t.ageMin, t.ageMax];
  } else {
    out.age_min = t.ageMin;
    out.age_max = t.ageMax;
  }
  if (t.genders === "men") out.genders = [1];
  if (t.genders === "women") out.genders = [2];
  if (t.locales?.length) out.locales = t.locales.map((l) => l.key);
  if (t.audiences?.length) out.custom_audiences = t.audiences.map((a) => ({ id: a.id }));
  if (t.excludedAudiences?.length) out.excluded_custom_audiences = t.excludedAudiences.map((a) => ({ id: a.id }));
  if (t.interests?.length) out.flexible_spec = [{ interests: t.interests.map((i) => ({ id: i.id, name: i.name })) }];
  out.targeting_automation = { advantage_audience: t.advantageAudience ? 1 : 0 };
  // Advantage+ placements: every placement field is left out.
  if (t.placements !== "advantage") Object.assign(out, placementFields(t.placements));
  if (appStoreUrl) {
    out.user_os = [/play\.google\./.test(appStoreUrl) ? "Android" : "iOS"];
    out.device_platforms = ["mobile"];
  }
  return out;
}

// MARK: Ad set

export function promotedBody(po: PromotedObject | undefined): Record<string, string> | undefined {
  if (!po) return undefined;
  const out: Record<string, string> = {};
  if (po.customConversionId) out.custom_conversion_id = po.customConversionId;
  else {
    if (po.pixelId) out.pixel_id = po.pixelId;
    if (po.applicationId) out.application_id = po.applicationId;
    if (po.objectStoreUrl) out.object_store_url = po.objectStoreUrl;
    if (po.customEventType) out.custom_event_type = po.customEventType;
  }
  if (po.pageId) out.page_id = po.pageId;
  return Object.keys(out).length ? out : undefined;
}

/** POST /act_{id}/adsets — budget and bidding only under an ABO parent. */
export function adSetBody(a: AdSetSpec, campaignId: string, parent: ParentCampaign, currency: string): Record<string, unknown> {
  const abo = parent.budgetMode === "ABO";
  const strategy = a.bidStrategy ?? "LOWEST_COST_WITHOUT_CAP";
  const appStoreUrl = parent.objective === "OUTCOME_APP_PROMOTION" ? a.promotedObject?.objectStoreUrl : null;
  const schedule = a.schedule ?? [];
  const attribution = a.attribution
    ? [
      { event_type: "CLICK_THROUGH", window_days: a.attribution.clickDays },
      ...(a.attribution.viewDays ? [{ event_type: "VIEW_THROUGH", window_days: a.attribution.viewDays }] : []),
      ...(a.attribution.engagedViewDays ? [{ event_type: "ENGAGED_VIDEO_VIEW", window_days: a.attribution.engagedViewDays }] : []),
    ]
    : undefined;
  return {
    name: a.name.trim(),
    campaign_id: campaignId,
    status: "PAUSED",
    optimization_goal: a.optimizationGoal,
    billing_event: a.billingEvent || "IMPRESSIONS",
    ...(a.destinationType ? { destination_type: a.destinationType } : {}),
    promoted_object: promotedBody(a.promotedObject),
    ...(abo
      ? {
        ...(has(a.dailyBudget) ? { daily_budget: toMinor(Number(a.dailyBudget), currency) } : { lifetime_budget: toMinor(Number(a.lifetimeBudget), currency) }),
        bid_strategy: strategy,
        ...((strategy === "COST_CAP" || strategy === "LOWEST_COST_WITH_BID_CAP") && has(a.bidAmount) ? { bid_amount: toMinor(Number(a.bidAmount), currency) } : {}),
        // The floor as a percentage (2.00× → 200), as Meta's Ads MCP takes it.
        ...(strategy === "LOWEST_COST_WITH_MIN_ROAS" && has(a.roasFloor) ? { bid_constraints: { roas_average_floor: Math.round(Number(a.roasFloor) * 100) } } : {}),
      }
      : {}),
    start_time: iso(a.startTime),
    end_time: iso(a.endTime),
    ...(schedule.length
      ? { adset_schedule: schedule.map((s) => ({ start_minute: s.startMinute, end_minute: s.endMinute, days: [...s.days].sort() })), pacing_type: ["day_parting"] }
      : {}),
    ...(a.frequencyCap ? { frequency_control_specs: [{ event: "IMPRESSIONS", interval_days: a.frequencyCap.days, max_frequency: a.frequencyCap.impressions }] } : {}),
    attribution_spec: attribution,
    ...(targetsEu(a.targeting) ? { dsa_beneficiary: a.dsaBeneficiary?.trim(), dsa_payor: a.dsaPayor?.trim() } : {}),
    targeting: targetingBody(a.targeting, appStoreUrl),
  };
}

// MARK: Ad creative

/** The copy and identity every ad of a send shares (saved on each draft as `spec.copy`). */
export interface CreativeCopy {
  pageId: string;
  instagramId?: string | null;
  primaryText: string;
  headline: string;
  description?: string | null;
  cta: string;
  link: string;
  displayLink?: string | null;
  urlTags?: string | null;
  advantageCreative: boolean;
  aiDisclosure: AiDisclosure;
  cards?: { creativeId: string; headline?: string; description?: string; link?: string }[];
}

/** One piece of media in an ad, filled in by the worker as it uploads. */
export interface MediaRef {
  creativeId: string;
  kind: "image" | "video";
  imageHash?: string | null;
  videoId?: string | null;
  thumbnailUrl?: string | null;
  /** Placement customisation: where this asset is used (null = the fallback). */
  rule?: PlacementRule | null;
}

/** What a draft from the sheet carries (launch_drafts.spec). */
export interface DraftSpec {
  objective: MetaObjective;
  format: AdFormat;
  copy: CreativeCopy;
  media: (MediaRef & { creative: CreativeInput; ready?: boolean })[];
}

/** Advantage+ creative enhancements, switched on or off together (off unless asked for). */
export const ADVANTAGE_FEATURES = ["image_touchups", "text_optimizations", "image_brightness_and_contrast", "enhance_cta", "image_animation"] as const;

const callToAction = (type: string, link: string, caption?: string | null) =>
  ({ type, value: { link, ...(caption ? { link_caption: caption } : {}) } });

/** POST /act_{id}/adcreatives for a single image or video, a carousel, or placement customisation. */
export function creativeBody(name: string, format: AdFormat, copy: CreativeCopy, media: MediaRef[], objective: MetaObjective): Record<string, unknown> {
  const cta = ctaFor(copy.cta, objective);
  const identity: Record<string, unknown> = { page_id: copy.pageId, ...(copy.instagramId ? { instagram_user_id: copy.instagramId } : {}) };
  const description = copy.description?.trim() || undefined;
  let spec: Record<string, unknown> = identity;
  let assetFeed: Record<string, unknown> | undefined;

  if (format === "carousel") {
    const cards: NonNullable<CreativeCopy["cards"]> = copy.cards?.length ? copy.cards : media.map((m) => ({ creativeId: m.creativeId }));
    spec = {
      ...identity,
      link_data: {
        link: copy.link,
        message: copy.primaryText,
        ...(copy.displayLink ? { caption: copy.displayLink } : {}),
        multi_share_optimized: true,
        multi_share_end_card: false,
        call_to_action: callToAction(cta, copy.link),
        child_attachments: cards.map((card) => {
          const m = media.find((x) => x.creativeId === card.creativeId)!;
          const link = card.link || copy.link;
          return {
            link,
            name: card.headline || copy.headline,
            ...((card.description || description) ? { description: card.description || description } : {}),
            ...(m.kind === "video" ? { video_id: m.videoId, ...(m.thumbnailUrl ? { picture: m.thumbnailUrl } : {}) } : { image_hash: m.imageHash }),
            call_to_action: callToAction(cta, link),
          };
        }),
      },
    };
  } else if (format === "placements") {
    const label = (m: MediaRef) => `radar_${m.creativeId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 24)}`;
    const images = media.filter((m) => m.kind === "image");
    const videos = media.filter((m) => m.kind === "video");
    // Rules in order; the fallback last, covering every platform, so it serves whatever the others don't.
    const ordered = [...media.filter((m) => m.rule), ...media.filter((m) => !m.rule)];
    const everywhere: PlacementRule = { publisher_platforms: PLATFORMS.filter((p) => !(objective === "OUTCOME_APP_PROMOTION" && p === "threads")) };
    assetFeed = {
      images: images.map((m) => ({ hash: m.imageHash, adlabels: [{ name: label(m) }] })),
      videos: videos.map((m) => ({ video_id: m.videoId, ...(m.thumbnailUrl ? { thumbnail_url: m.thumbnailUrl } : {}), adlabels: [{ name: label(m) }] })),
      bodies: [{ text: copy.primaryText }],
      titles: [{ text: copy.headline }],
      ...(description ? { descriptions: [{ text: description }] } : {}),
      link_urls: [{ website_url: copy.link, ...(copy.displayLink ? { display_url: copy.displayLink } : {}) }],
      call_to_action_types: [cta],
      ad_formats: [...(images.length ? ["SINGLE_IMAGE"] : []), ...(videos.length ? ["SINGLE_VIDEO"] : [])],
      optimization_type: "PLACEMENT",
      asset_customization_rules: ordered.map((m, i) => ({
        customization_spec: placementFields(m.rule ?? everywhere),
        [m.kind === "video" ? "video_label" : "image_label"]: { name: label(m) },
        priority: i + 1,
      })),
    };
  } else {
    const m = media[0];
    if (m.kind === "video") {
      spec = {
        ...identity,
        video_data: {
          video_id: m.videoId,
          message: copy.primaryText,
          title: copy.headline,
          ...(description ? { link_description: description } : {}),
          ...(m.imageHash ? { image_hash: m.imageHash } : m.thumbnailUrl ? { image_url: m.thumbnailUrl } : {}),
          call_to_action: callToAction(cta, copy.link, copy.displayLink),
        },
      };
    } else {
      spec = {
        ...identity,
        link_data: {
          link: copy.link,
          message: copy.primaryText,
          name: copy.headline,
          ...(description ? { description } : {}),
          ...(copy.displayLink ? { caption: copy.displayLink } : {}),
          image_hash: m.imageHash,
          call_to_action: callToAction(cta, copy.link),
        },
      };
    }
  }

  const urlTags = copy.urlTags?.trim() || (objective === "OUTCOME_APP_PROMOTION" ? undefined : URL_TAGS);
  return {
    name,
    object_story_spec: spec,
    ...(assetFeed ? { asset_feed_spec: assetFeed } : {}),
    ...(urlTags ? { url_tags: urlTags } : {}),
    degrees_of_freedom_spec: {
      creative_features_spec: Object.fromEntries(ADVANTAGE_FEATURES.map((f) => [f, { enroll_status: copy.advantageCreative ? "OPT_IN" : "OPT_OUT" }])),
    },
    // Declared by the person sending (no default): Meta labels AI-made ads where the law asks for it.
    self_ai_disclosure: copy.aiDisclosure,
  };
}
