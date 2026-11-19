// What Launch sends to the Marketing API: the payloads for ad creatives, paused ads, paused copies
// and (in the setup step) paused testing and scaling campaigns. Builders are pure, so tests and the
// preview show exactly what would be sent; the operations below them take a Graph client.
//
// App promotion (iOS): campaign objective OUTCOME_APP_PROMOTION, ad set optimization_goal
// APP_INSTALLS with promoted_object { application_id, object_store_url } (or, with optimize_for
// trial/purchase, OFFSITE_CONVERSIONS with custom_event_type START_TRIAL / PURCHASE, which needs the
// app to send those events through the SDK or an MMP), targeting user_os iOS on mobile, SKAdNetwork
// attribution on the campaign. Testing campaigns keep the budget on the ad set (ABO); scaling
// campaigns put it on the campaign (CBO) unless scaling_budget is "adset". Creatives use call_to_action INSTALL_MOBILE_APP
// (or another app CTA) linking to the App Store. Needs the app registered on developers.facebook.com
// with its App Store id, and the ad account authorised to advertise it.
// Website traffic (fallback while the app isn't on the App Store): OUTCOME_TRAFFIC, LINK_CLICKS (or
// LANDING_PAGE_VIEWS when a pixel is connected), destination WEBSITE, UTM tags on the creative.
// Legacy Advantage+ App campaigns (smart_promotion_type) can't be created through the API since
// May 2026, so Launch builds manual campaigns; Advantage+ audience is on in every ad set.
import { act, type Graph, GraphError } from "./graph.ts";
import { adSetName, campaignName, type Stage } from "./naming.ts";
import { ctaFor, objectiveFromSettings } from "./rules.ts";
import type { CreativeInput, DraftRow, LaunchSettingsRow, Objective } from "./types.ts";

// MARK: Calls to action

export const APP_CTAS = ["INSTALL_MOBILE_APP", "DOWNLOAD", "USE_APP", "LEARN_MORE", "SIGN_UP", "SUBSCRIBE"] as const;
export const WEB_CTAS = ["LEARN_MORE", "SIGN_UP", "DOWNLOAD", "SUBSCRIBE", "GET_OFFER", "SHOP_NOW"] as const;
export type Cta = (typeof APP_CTAS)[number] | (typeof WEB_CTAS)[number];

/**
 * Turns a creative's CTA text ("Download free", "Install now") into a Meta CTA type for the objective.
 * The same matching as the sheet's ctaFor (rules.ts), narrowed to the CTAs the testing drafts use.
 */
export function ctaType(text: string | null | undefined, objective: Objective): Cta {
  const allowed: readonly string[] = objective === "app_promotion" ? APP_CTAS : WEB_CTAS;
  const t = ctaFor(text, objectiveFromSettings(objective));
  return (allowed.includes(t) ? t : allowed[0]) as Cta;
}

// MARK: Money

/** Currencies Meta counts in whole units (no cents); everything else is in hundredths. */
const NO_OFFSET = new Set(["CLP", "COP", "CRC", "HUF", "ISK", "IDR", "JPY", "KRW", "PYG", "TWD", "VND"]);
export const toMinor = (amount: number, currency: string) => Math.round(amount * (NO_OFFSET.has(currency.toUpperCase()) ? 1 : 100));
export const fromMinor = (minor: number, currency: string) => minor / (NO_OFFSET.has(currency.toUpperCase()) ? 1 : 100);

// MARK: Readiness

/** What's missing before Launch can create drafts for a workspace (empty when ready). */
export function missing(settings: LaunchSettingsRow, stage: Stage = "TEST"): string[] {
  const m = settings.meta ?? {};
  const out: string[] = [];
  if (!m.adAccountId) out.push("Connect a Meta ad account to the workspace.");
  if (!m.pageId) out.push("Connect the Facebook Page the ads run from.");
  if (settings.objective === "app_promotion") {
    if (!m.appId) out.push("Add the Meta app id for the iOS app (App promotion needs it).");
    if (!m.appStoreUrl) out.push("Add the App Store link (or switch the objective to Website traffic until the app is live).");
  } else if (!m.websiteUrl) {
    out.push("Add the website the ads link to.");
  }
  const adSet = stage === "TEST" ? settings.testing_adset_id : settings.scaling_adset_id;
  if (!adSet) out.push(`Choose (or create) the ${stage === "TEST" ? "testing" : "scaling"} ad set.`);
  return out;
}

export const destination = (settings: LaunchSettingsRow) =>
  (settings.objective === "app_promotion" ? settings.meta.appStoreUrl : settings.meta.websiteUrl) ?? "";

/** UTM tags on website ads, filled in by Meta with the names (so analytics see the naming convention). */
export const URL_TAGS = "utm_source=meta&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_term={{adset.name}}&utm_content={{ad.name}}";

// MARK: Payloads

export interface CreativeFields {
  name: string;
  primaryText: string;
  headline: string;
  cta: string;
  link: string;
  /** The link description (disclaimers); left out when empty. */
  description?: string | null;
  /** self_ai_disclosure, as the person declared it; left out when undecided. */
  aiDisclosure?: "OPT_IN" | "OPT_OUT" | null;
  imageHash?: string | null;
  videoId?: string | null;
  thumbnailUrl?: string | null;
}

/** POST /act_{id}/adcreatives */
export function creativePayload(settings: LaunchSettingsRow, f: CreativeFields): Record<string, unknown> {
  const m = settings.meta;
  const type = ctaType(f.cta, settings.objective);
  const callToAction = { type, value: { link: f.link } };
  const identity: Record<string, unknown> = { page_id: m.pageId };
  if (m.instagramId) identity.instagram_user_id = m.instagramId;
  const description = f.description?.trim() || undefined;
  let spec: Record<string, unknown>;
  if (f.videoId) {
    spec = {
      ...identity,
      video_data: {
        video_id: f.videoId,
        message: f.primaryText,
        title: f.headline,
        ...(description ? { link_description: description } : {}),
        ...(f.imageHash ? { image_hash: f.imageHash } : f.thumbnailUrl ? { image_url: f.thumbnailUrl } : {}),
        call_to_action: callToAction,
      },
    };
  } else {
    spec = {
      ...identity,
      link_data: { link: f.link, message: f.primaryText, name: f.headline, ...(description ? { description } : {}), image_hash: f.imageHash, call_to_action: callToAction },
    };
  }
  return {
    name: f.name,
    object_story_spec: spec,
    ...(settings.objective === "website_traffic" ? { url_tags: URL_TAGS } : {}),
    // Meta labels AI-made ads where the law asks for it (same field as the sheet's creativeBody).
    ...(f.aiDisclosure ? { self_ai_disclosure: f.aiDisclosure } : {}),
  };
}

/** POST /act_{id}/ads — always paused. */
export const adPayload = (name: string, adSetId: string, creativeId: string) => ({
  name,
  adset_id: adSetId,
  creative: { creative_id: creativeId },
  status: "PAUSED",
});

/** POST /{ad_id}/copies — the promotion: the same ad, paused, in the scaling ad set. */
export const copyPayload = (adSetId: string) => ({
  adset_id: adSetId,
  status_option: "PAUSED",
  rename_options: { rename_strategy: "NO_RENAME" },
});

export interface StructureInput {
  settings: LaunchSettingsRow;
  stage: Stage;
  app: string;
  date: string;
  currency: string;
  dailyBudget: number;
}

/** Whether this stage's budget sits on the campaign (CBO): scaling, unless the settings say ad set. */
export const campaignBudget = (s: Pick<StructureInput, "settings" | "stage">) => s.stage === "SCALE" && s.settings.scaling_budget !== "adset";

const APP_EVENT = { trial: "START_TRIAL", purchase: "PURCHASE" } as const;

/** POST /act_{id}/campaigns — a paused campaign; with a campaign budget (CBO) when scaling, ad set budgets otherwise. */
export function campaignPayload(s: StructureInput): Record<string, unknown> {
  const app = s.settings.objective === "app_promotion";
  const cbo = campaignBudget(s);
  return {
    name: campaignName({ app: s.app, stage: s.stage, objective: app ? "app-promotion" : "website-traffic", date: s.date }),
    objective: app ? "OUTCOME_APP_PROMOTION" : "OUTCOME_TRAFFIC",
    status: "PAUSED",
    buying_type: "AUCTION",
    special_ad_categories: [],
    // CBO: the campaign holds the budget and the bid strategy, and Meta spreads it across ad sets.
    // ABO: budgets live on the ad sets (one per campaign), so budget sharing between them is off.
    ...(cbo
      ? { daily_budget: toMinor(s.dailyBudget, s.currency), bid_strategy: "LOWEST_COST_WITHOUT_CAP" }
      : { is_adset_budget_sharing_enabled: false }),
    ...(app ? { is_skadnetwork_attribution: true } : {}),
  };
}

/** POST /act_{id}/adsets — a paused ad set (with its own daily budget unless the campaign has one), Advantage+ audience and the app or site. */
export function adSetPayload(s: StructureInput, campaignId: string): Record<string, unknown> {
  const settings = s.settings;
  const app = settings.objective === "app_promotion";
  const event = settings.optimize_for === "trial" || settings.optimize_for === "purchase" ? APP_EVENT[settings.optimize_for] : null;
  const promoted = { application_id: settings.meta.appId, object_store_url: settings.meta.appStoreUrl };
  const countries = settings.countries?.length ? settings.countries : ["US"];
  const targeting: Record<string, unknown> = {
    geo_locations: { countries },
    targeting_automation: { advantage_audience: 1 },
    ...(app ? { user_os: ["iOS"], device_platforms: ["mobile"] } : {}),
  };
  return {
    name: adSetName({ app: s.app, stage: s.stage, audience: `${countries.join("-")}-broad`, date: s.date }),
    campaign_id: campaignId,
    status: "PAUSED",
    ...(campaignBudget(s) ? {} : { daily_budget: toMinor(s.dailyBudget, s.currency), bid_strategy: "LOWEST_COST_WITHOUT_CAP" }),
    billing_event: "IMPRESSIONS",
    targeting,
    ...(app && event
      ? { optimization_goal: "OFFSITE_CONVERSIONS", promoted_object: { ...promoted, custom_event_type: event } }
      : app
      ? { optimization_goal: "APP_INSTALLS", promoted_object: promoted }
      : settings.meta.pixelId
      ? { optimization_goal: "LANDING_PAGE_VIEWS", destination_type: "WEBSITE" }
      : { optimization_goal: "LINK_CLICKS", destination_type: "WEBSITE" }),
  };
}

// MARK: Operations

export interface AccountInfo { id: string; name: string; currency: string; accountStatus: number; hasPaymentMethod: boolean; timezone?: string }

/** Read-only: the ad account's name, currency, status and whether it can pay. */
export async function account(graph: Graph, adAccountId: string): Promise<AccountInfo> {
  const a = await graph.get<Record<string, unknown>>(act(adAccountId), { fields: "id,name,currency,account_status,funding_source,timezone_name" });
  return {
    id: String(a.id ?? act(adAccountId)),
    name: String(a.name ?? ""),
    currency: String(a.currency ?? "USD"),
    accountStatus: Number(a.account_status ?? 0),
    hasPaymentMethod: Boolean(a.funding_source),
    timezone: a.timezone_name as string | undefined,
  };
}

export interface AdSetInfo { id: string; name: string; status: string; effectiveStatus: string; dailyBudget: number | null; lifetimeBudget: number | null; campaignId: string; ads: number }

/** Read-only: an ad set's budget and status, and how many ads it holds (for the guardrails). */
export async function adSet(graph: Graph, id: string): Promise<AdSetInfo> {
  const a = await graph.get<Record<string, unknown>>(id, { fields: "id,name,status,effective_status,daily_budget,lifetime_budget,campaign_id,campaign{daily_budget},ads.limit(0).summary(true)" });
  const ads = (a.ads as { summary?: { total_count?: number } } | undefined)?.summary?.total_count ?? 0;
  // Under a campaign budget (CBO) the ad set has none of its own: report the campaign's.
  const campaignDaily = (a.campaign as { daily_budget?: string | number } | undefined)?.daily_budget;
  return {
    id: String(a.id), name: String(a.name ?? ""), status: String(a.status ?? ""), effectiveStatus: String(a.effective_status ?? ""),
    dailyBudget: a.daily_budget != null ? Number(a.daily_budget) : campaignDaily != null ? Number(campaignDaily) : null,
    lifetimeBudget: a.lifetime_budget != null && Number(a.lifetime_budget) > 0 ? Number(a.lifetime_budget) : null,
    campaignId: String(a.campaign_id ?? ""), ads,
  };
}

/** Uploads an image's bytes; returns its hash. */
export async function uploadImage(graph: Graph, adAccountId: string, name: string, bytes: Uint8Array): Promise<string> {
  const res = await graph.post<{ images?: Record<string, { hash: string }> }>(`${act(adAccountId)}/adimages`, { bytes: base64(bytes), name });
  const hash = Object.values(res.images ?? {})[0]?.hash;
  if (!hash) throw new Error("Meta didn't return an image hash.");
  return hash;
}

/** Starts a video upload from a public URL; Meta fetches and processes it. Returns the video id. */
export async function uploadVideo(graph: Graph, adAccountId: string, name: string, fileUrl: string): Promise<string> {
  const res = await graph.post<{ id?: string; video_id?: string }>(`${act(adAccountId)}/advideos`, { file_url: fileUrl, name, title: name.slice(0, 250) });
  const id = res.id ?? res.video_id;
  if (!id) throw new Error("Meta didn't return a video id.");
  return id;
}

export type VideoState = { state: "processing"; progress: number } | { state: "ready"; thumbnail: string | null } | { state: "error"; message: string };

/** Where a video's processing is; a ready video comes with its preferred thumbnail. */
export async function videoState(graph: Graph, videoId: string): Promise<VideoState> {
  const v = await graph.get<{ status?: { video_status?: string; processing_progress?: number; processing_phase?: { errors?: { message?: string }[] } }; thumbnails?: { data?: { uri: string; is_preferred?: boolean }[] } }>(
    videoId, { fields: "status,thumbnails{uri,is_preferred}" },
  );
  const status = v.status?.video_status ?? "processing";
  if (status === "ready") {
    const thumbs = v.thumbnails?.data ?? [];
    return { state: "ready", thumbnail: (thumbs.find((t) => t.is_preferred) ?? thumbs[0])?.uri ?? null };
  }
  if (status === "error" || status === "expired") {
    return { state: "error", message: v.status?.processing_phase?.errors?.[0]?.message ?? "Meta couldn't process the video." };
  }
  return { state: "processing", progress: v.status?.processing_progress ?? 0 };
}

export async function createCreative(graph: Graph, adAccountId: string, payload: Record<string, unknown>): Promise<string> {
  const res = await graph.post<{ id?: string }>(`${act(adAccountId)}/adcreatives`, payload);
  if (!res.id) throw new Error("Meta didn't return a creative id.");
  return res.id;
}

export async function createAd(graph: Graph, adAccountId: string, payload: ReturnType<typeof adPayload>): Promise<string> {
  const res = await graph.post<{ id?: string }>(`${act(adAccountId)}/ads`, payload);
  if (!res.id) throw new Error("Meta didn't return an ad id.");
  return res.id;
}

/** Duplicates an ad (paused) into another ad set and names the copy; returns the copy's id. */
export async function copyAd(graph: Graph, adId: string, adSetId: string, name: string): Promise<string> {
  const res = await graph.post<{ copied_ad_id?: string; ad_object_ids?: { ad_object_type: string; source_id: string; copied_id: string }[] }>(`${adId}/copies`, copyPayload(adSetId));
  const id = res.copied_ad_id ?? res.ad_object_ids?.find((o) => o.ad_object_type === "ad")?.copied_id;
  if (!id) throw new Error("Meta didn't return the copy's id.");
  await graph.post(id, { name });
  return id;
}

/** Creates a paused campaign or ad set (graph.ts refuses anything not PAUSED); returns its id. */
export async function createObject(graph: Graph, adAccountId: string, edge: "campaigns" | "adsets", payload: Record<string, unknown>): Promise<string> {
  const res = await graph.post<{ id?: string }>(`${act(adAccountId)}/${edge}`, payload);
  if (!res.id) throw new Error(`Meta didn't return the new ${edge === "campaigns" ? "campaign" : "ad set"}'s id.`);
  return res.id;
}

/** Changes fields on a campaign or ad set (rename, budget, bid, schedule, pause). Never ACTIVE: graph.ts refuses it. */
export async function updateObject(graph: Graph, id: string, fields: Record<string, unknown>) {
  await graph.post(id, fields);
}

/** Pauses an ad (the one write that changes something already running, and only ever to PAUSED). */
export async function pauseAd(graph: Graph, adId: string) {
  await graph.post(adId, { status: "PAUSED" });
}

/** The setup step: a paused campaign and ad set for a stage. */
export async function createStructure(graph: Graph, s: StructureInput): Promise<{ campaignId: string; adSetId: string }> {
  const adAccountId = s.settings.meta.adAccountId!;
  const c = await graph.post<{ id?: string }>(`${act(adAccountId)}/campaigns`, campaignPayload(s));
  if (!c.id) throw new Error("Meta didn't return a campaign id.");
  const a = await graph.post<{ id?: string }>(`${act(adAccountId)}/adsets`, adSetPayload(s, c.id));
  if (!a.id) throw new Error("Meta didn't return an ad set id.");
  return { campaignId: c.id, adSetId: a.id };
}

/** Everything Meta would receive for a draft, before anything is uploaded (the preview). */
export function previewDraft(settings: LaunchSettingsRow, d: Pick<DraftRow, "ad_name" | "primary_text" | "headline" | "cta" | "link" | "adset_id"> & { creative: CreativeInput }) {
  const upload = d.creative.kind === "video"
    ? { edge: `${act(settings.meta.adAccountId ?? "0")}/advideos`, params: { file_url: d.creative.url, name: d.ad_name } }
    : { edge: `${act(settings.meta.adAccountId ?? "0")}/adimages`, params: { bytes: "<image bytes, base64>", name: d.ad_name } };
  return {
    upload,
    creative: creativePayload(settings, {
      name: d.ad_name, primaryText: d.primary_text, headline: d.headline, cta: d.cta, link: d.link,
      description: d.creative.description, aiDisclosure: d.creative.aiDisclosure,
      imageHash: d.creative.kind === "image" ? "<image hash>" : null,
      videoId: d.creative.kind === "video" ? "<video id>" : null,
      thumbnailUrl: d.creative.kind === "video" ? d.creative.thumbnailUrl ?? "<thumbnail>" : null,
    }),
    ad: adPayload(d.ad_name, d.adset_id || "<ad set id>", "<creative id>"),
  };
}

/** A short, human message for a Meta error. */
export function explain(error: unknown): string {
  if (error instanceof GraphError) {
    if (error.code === 190) return "Meta rejected the system-user token (expired or revoked). Generate a new one.";
    if (error.code === 200 || error.code === 10) return `Meta says the token lacks a permission: ${error.message}`;
    return error.userTitle ? `${error.userTitle}: ${error.message}` : error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

function base64(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}
