// The "Send to Meta" routes, written against injected dependencies so the tests run them against the
// mock Marketing API: index.ts supplies the signed-in user's settings, the database lookups and the
// draft queue, and has already checked LAUNCH_ALLOWED_EMAILS and META_ALLOWED_AD_ACCOUNTS (reads);
// every write here also calls deps.allowWrite() (META_ALLOWED_AD_ACCOUNTS for writes) first.
//
//   /campaigns   { after? }                      the account's campaigns (50 a page)
//   /adsets      { campaignId, after? }          a campaign's ad sets
//   /connections {}                              Pages, Instagram accounts, pixels, conversions, audiences, currency
//   /search      { kind, q }                     interests, places, languages (Meta's targeting search)
//   /estimate    { objective, adSet }            monthly audience estimate for an ad set's targeting
//   /send        { stage, campaign, adSet, ad, confirm }   plan (or, confirmed, create) paused objects + queue the ads
//   /edit        { level, id, changes, confirm } plan (or apply) a rename, budget, bid, schedule change or a pause
//   /ad-preview  { adId }                        Meta's previews of a created ad and its Ads Manager link
import {
  accountId, adPreviews, adSetInfo, campaignInfo, connections, deliveryEstimate, isOdax, listAdSets, listCampaigns, search,
  type SearchKind, validInterests,
} from "./catalog.ts";
import { act, adsManagerUrl, type Graph } from "./graph.ts";
import { account, adPayload, createObject, explain, toMinor, updateObject } from "./meta.ts";
import { adName, appCode, day, nextVersion, type Stage } from "./naming.ts";
import { adSetBody, campaignBody, creativeBody, type CreativeCopy, type DraftSpec, type MediaRef, promotedBody, targetingBody } from "./pipeline.ts";
import {
  type AdFormat, type AdSetSpec, type AdSpec, BID_INFO, type BidStrategy, type CampaignSpec, CTA_LABEL, GOAL_INFO, type EditChanges, type GeoPick, type MetaObjective,
  META_OBJECTIVES, OBJECTIVE_INFO, type ParentCampaign, type PlacementRule, PLATFORMS, type TargetingSpec, validateAd, validateAdSet, validateCampaign,
  validateEdit,
} from "./rules.ts";
import type { CreativeInput, LaunchSettingsRow } from "./types.ts";

/** A refusal with a status and, sometimes, what was already created (Launch never deletes, so it says so). */
export class SheetError extends Error {
  constructor(message: string, readonly status = 400, readonly extra: Record<string, unknown> = {}) { super(message); }
}

export interface NewDraft {
  stage: Stage;
  creative: CreativeInput;
  ad_name: string;
  primary_text: string;
  headline: string;
  cta: string;
  link: string;
  adset_id: string;
  spec: DraftSpec;
}

export interface SheetDeps {
  graph: Graph;
  settings: LaunchSettingsRow;
  /** The user's approved, QA-passed creatives in this workspace, by id (never a URL from the caller). */
  creatives: (ids: string[]) => Promise<Map<string, CreativeInput>>;
  /** Ad names already used in the workspace (for version numbers). */
  usedNames: () => Promise<string[]>;
  /** Saves the drafts and starts the worker. */
  queue: (drafts: NewDraft[]) => Promise<{ jobId: string; drafts: unknown[] }>;
  /** Throws unless the ad account may be written to (META_ALLOWED_AD_ACCOUNTS). */
  allowWrite: () => void;
  /** Whether a creative's file may be uploaded (this project's storage). */
  mediaAllowed: (url: string) => boolean;
  now?: () => Date;
}

// MARK: Input parsing (everything from the browser is untrusted)

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? v as Json : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : typeof v === "number" ? String(v) : "");
const opt = (v: unknown, max = 500) => str(v, max) || null;
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};
const id = (v: unknown) => str(v, 40).replace(/^act_/, "");
const ID = /^\d{5,25}$/;

const objective = (v: unknown): MetaObjective => {
  const s = str(v, 40);
  if (!(META_OBJECTIVES as readonly string[]).includes(s)) throw new SheetError("Pick the campaign's objective.");
  return s as MetaObjective;
};
const strategy = (v: unknown): BidStrategy | null => {
  // An unknown value is kept so validation names it ("Pick a bid strategy.").
  const s = str(v, 40);
  return s ? s as BidStrategy : null;
};

export function parseCampaign(raw: unknown): CampaignSpec {
  const r = obj(raw);
  return {
    name: str(r.name, 400),
    objective: objective(r.objective),
    budgetMode: r.budgetMode === "CBO" ? "CBO" : r.budgetMode === "ABO" ? "ABO" : ("" as "ABO"),
    dailyBudget: num(r.dailyBudget), lifetimeBudget: num(r.lifetimeBudget), bidStrategy: strategy(r.bidStrategy), spendCap: num(r.spendCap),
    startTime: opt(r.startTime, 40), stopTime: opt(r.stopTime, 40),
    specialAdCategories: arr(r.specialAdCategories).map((s) => str(s, 40)).filter(Boolean),
    specialAdCountries: arr(r.specialAdCountries).map((s) => str(s, 2).toUpperCase()).filter(Boolean),
    skadnetwork: r.skadnetwork === true,
  };
}

const geoPick = (raw: unknown): GeoPick => {
  const r = obj(raw);
  const type = r.type === "region" || r.type === "city" ? r.type : "country";
  return {
    key: type === "country" ? str(r.key, 2).toUpperCase() : str(r.key, 20), name: str(r.name, 120) || str(r.key, 20), type,
    countryCode: opt(r.countryCode, 2)?.toUpperCase() ?? undefined, radius: num(r.radius),
    distanceUnit: r.distanceUnit === "kilometer" ? "kilometer" : "mile",
  };
};
const named = (raw: unknown) => arr(raw).slice(0, 100).map((x) => ({ id: str(obj(x).id, 30), name: str(obj(x).name, 200) }));

export function parseRule(raw: unknown): PlacementRule {
  const r = obj(raw);
  const rule: PlacementRule = { publisher_platforms: arr(r.publisher_platforms).map((p) => str(p, 30)) as PlacementRule["publisher_platforms"] };
  for (const p of PLATFORMS) {
    const positions = arr(r[`${p}_positions`]).map((x) => str(x, 40)).filter(Boolean);
    if (positions.length) rule[`${p}_positions`] = positions;
  }
  return rule;
}

export function parseTargeting(raw: unknown): TargetingSpec {
  const r = obj(raw);
  return {
    locations: arr(r.locations).slice(0, 200).map(geoPick),
    excludedLocations: arr(r.excludedLocations).slice(0, 200).map(geoPick),
    ageMin: Number(r.ageMin ?? 18), ageMax: Number(r.ageMax ?? 65),
    genders: r.genders === "men" || r.genders === "women" ? r.genders : "all",
    locales: arr(r.locales).slice(0, 50).map((l) => ({ key: Number(obj(l).key), name: str(obj(l).name, 100) })),
    audiences: named(r.audiences), excludedAudiences: named(r.excludedAudiences), interests: named(r.interests),
    advantageAudience: r.advantageAudience !== false,
    placements: r.placements === "advantage" || !r.placements ? "advantage" : parseRule(r.placements),
  };
}

export function parseAdSet(raw: unknown): AdSetSpec {
  const r = obj(raw);
  const po = obj(r.promotedObject);
  const f = r.frequencyCap ? obj(r.frequencyCap) : null;
  const at = r.attribution ? obj(r.attribution) : null;
  return {
    name: str(r.name, 400),
    optimizationGoal: str(r.optimizationGoal, 60), billingEvent: str(r.billingEvent, 40) || "IMPRESSIONS", destinationType: opt(r.destinationType, 40),
    promotedObject: {
      pixelId: opt(po.pixelId, 30) ?? undefined, customEventType: opt(po.customEventType, 40) ?? undefined,
      customConversionId: opt(po.customConversionId, 30) ?? undefined, applicationId: opt(po.applicationId, 30) ?? undefined,
      objectStoreUrl: opt(po.objectStoreUrl, 500) ?? undefined, pageId: opt(po.pageId, 30) ?? undefined,
    },
    dailyBudget: num(r.dailyBudget), lifetimeBudget: num(r.lifetimeBudget), bidStrategy: strategy(r.bidStrategy),
    bidAmount: num(r.bidAmount), roasFloor: num(r.roasFloor), startTime: opt(r.startTime, 40), endTime: opt(r.endTime, 40),
    schedule: arr(r.schedule).slice(0, 50).map((s) => ({ days: arr(obj(s).days).map(Number), startMinute: Number(obj(s).startMinute), endMinute: Number(obj(s).endMinute) })),
    frequencyCap: f ? { impressions: Number(f.impressions), days: Number(f.days) } : null,
    attribution: at ? { clickDays: Number(at.clickDays) as 1 | 7, viewDays: Number(at.viewDays ?? 0) as 0 | 1, engagedViewDays: Number(at.engagedViewDays ?? 0) as 0 | 1 } : null,
    dsaBeneficiary: opt(r.dsaBeneficiary, 200), dsaPayor: opt(r.dsaPayor, 200),
    targeting: parseTargeting(r.targeting),
  };
}

export function parseAd(raw: unknown): Omit<AdSpec, "creatives"> & { creativeIds: string[] } {
  const r = obj(raw);
  const format: AdFormat = r.format === "carousel" || r.format === "placements" ? r.format : "single";
  const per: AdSpec["perCreative"] = {};
  for (const [k, v] of Object.entries(obj(r.perCreative)).slice(0, 50)) {
    const o = obj(v);
    per[str(k, 40)] = { primaryText: opt(o.primaryText, 2000) ?? undefined, headline: opt(o.headline, 255) ?? undefined, description: opt(o.description, 255) ?? undefined };
  }
  return {
    format,
    creativeIds: arr(r.creativeIds).slice(0, 60).map((x) => str(x, 40)),
    pageId: id(r.pageId), instagramId: opt(r.instagramId, 30),
    primaryText: str(r.primaryText, 2000), headline: str(r.headline, 255), description: opt(r.description, 255),
    cta: str(r.cta, 40), link: str(r.link, 1000), displayLink: opt(r.displayLink, 200), urlTags: opt(r.urlTags, 1000),
    advantageCreative: r.advantageCreative === true,
    aiDisclosure: r.aiDisclosure === "OPT_IN" || r.aiDisclosure === "OPT_OUT" ? r.aiDisclosure : null,
    cards: arr(r.cards).slice(0, 12).map((c) => ({ creativeId: str(obj(c).creativeId, 40), headline: opt(obj(c).headline, 255) ?? undefined, description: opt(obj(c).description, 255) ?? undefined, link: opt(obj(c).link, 1000) ?? undefined })),
    placements: arr(r.placements).slice(0, 12).map((p) => ({ creativeId: str(obj(p).creativeId, 40), rule: obj(p).rule ? parseRule(obj(p).rule) : null })),
    perCreative: per,
  };
}

// MARK: Helpers

async function accountContext(deps: SheetDeps) {
  const adAccountId = deps.settings.meta?.adAccountId;
  if (!adAccountId) throw new SheetError("Add the ad account id to this workspace's Launch settings first.");
  const info = await account(deps.graph, adAccountId);
  return { adAccountId: accountId(adAccountId), currency: info.currency, info };
}

const mine = (row: { accountId: string }, adAccountId: string, what: string) => {
  if (row.accountId && row.accountId !== adAccountId) throw new SheetError(`That ${what} isn't in this workspace's ad account.`, 403);
};

const metaId = (v: unknown, what: string) => {
  const s = id(v);
  if (!ID.test(s)) throw new SheetError(`Which ${what}?`);
  return s;
};

export const codeFor = (s: LaunchSettingsRow) => appCode(s.meta?.appName ?? "App", s.app_code);

/** Major units in the account currency, for people. */
export function moneyText(n: number | null | undefined, currency: string) {
  if (n == null) return "–";
  try { return new Intl.NumberFormat("en", { style: "currency", currency, maximumFractionDigits: n < 100 ? 2 : 0 }).format(n); } catch { return `${n} ${currency}`; }
}

// MARK: Reads

export async function campaignsRoute(deps: SheetDeps, input: Json) {
  const { adAccountId, currency } = await accountContext(deps);
  const page = await listCampaigns(deps.graph, adAccountId, currency, opt(input.after, 200));
  return { ...page, currency, items: page.items.map((c) => ({ ...c, supported: isOdax(c.objective), url: adsManagerUrl(adAccountId, "campaigns", [c.id]) })) };
}

export async function adSetsRoute(deps: SheetDeps, input: Json) {
  const { adAccountId, currency } = await accountContext(deps);
  const campaign = await campaignInfo(deps.graph, metaId(input.campaignId, "campaign"), currency);
  mine(campaign, adAccountId, "campaign");
  const page = await listAdSets(deps.graph, campaign.id, currency, opt(input.after, 200));
  return { ...page, currency, campaign, items: page.items.map((a) => ({ ...a, url: adsManagerUrl(adAccountId, "adsets", [a.id]) })) };
}

export async function connectionsRoute(deps: SheetDeps) {
  const { adAccountId } = await accountContext(deps);
  return connections(deps.graph, adAccountId);
}

export async function searchRoute(deps: SheetDeps, input: Json) {
  const kind = (["interest", "geo", "locale"] as const).find((k) => k === input.kind);
  if (!kind) throw new SheetError("Search interests, places or languages.");
  return { kind, items: await search(deps.graph, kind as SearchKind, str(input.q, 100)) };
}

export async function estimateRoute(deps: SheetDeps, input: Json) {
  const { adAccountId } = await accountContext(deps);
  const o = objective(input.objective);
  const adSet = parseAdSet(input.adSet);
  const appUrl = o === "OUTCOME_APP_PROMOTION" ? adSet.promotedObject?.objectStoreUrl : null;
  const estimate = await deliveryEstimate(deps.graph, adAccountId, adSet.optimizationGoal || "REACH", targetingBody(adSet.targeting, appUrl), promotedBody(adSet.promotedObject));
  return { estimate };
}

export async function adPreviewRoute(deps: SheetDeps, input: Json) {
  const { adAccountId } = await accountContext(deps);
  const adId = metaId(input.adId, "ad");
  const ad = await deps.graph.get<{ id: string; account_id?: string; name?: string }>(adId, { fields: "id,name,account_id" });
  mine({ accountId: accountId(ad.account_id) }, adAccountId, "ad");
  return { adId, name: ad.name ?? "", previews: await adPreviews(deps.graph, adId), url: adsManagerUrl(adAccountId, "ads", [adId]) };
}

// MARK: Send

const goalText = (g: string) => GOAL_INFO[g]?.label ?? g;
const bidText = (b: string | null | undefined) => BID_INFO[(b ?? "LOWEST_COST_WITHOUT_CAP") as BidStrategy]?.label ?? b ?? "";
const eventText = (e: string) => e.toLowerCase().replace(/_/g, " ");
const statusText = (s: string) => s.toLowerCase().replace(/_/g, " ");

interface Line { label: string; value: string }
export interface PlanObject { level: "campaign" | "adset" | "ad"; action: "create" | "use"; name: string; lines: Line[] }

const placementText = (t: TargetingSpec) => (t.placements === "advantage" ? "Advantage+ placements (Meta picks where it shows)" : t.placements.publisher_platforms.join(", "));

function campaignLines(c: CampaignSpec, currency: string): Line[] {
  const lines: Line[] = [{ label: "Objective", value: OBJECTIVE_INFO[c.objective].label }];
  if (c.budgetMode === "CBO") {
    lines.push({ label: "Budget", value: c.dailyBudget != null ? `${moneyText(c.dailyBudget, currency)} a day on the campaign (CBO)` : `${moneyText(c.lifetimeBudget, currency)} in total on the campaign (CBO)` });
    lines.push({ label: "Bidding", value: bidText(c.bidStrategy) });
  } else {
    lines.push({ label: "Budget", value: "On each ad set (ABO)" });
  }
  if (c.spendCap != null) lines.push({ label: "Spending limit", value: moneyText(c.spendCap, currency) });
  if (c.startTime || c.stopTime) lines.push({ label: "Runs", value: `${c.startTime ?? "when published"} → ${c.stopTime ?? "no end"}` });
  if (c.specialAdCategories?.length) lines.push({ label: "Special ad category", value: `${c.specialAdCategories.join(", ")} (${(c.specialAdCountries ?? []).join(", ")})` });
  return lines;
}

function adSetLines(a: AdSetSpec, parent: ParentCampaign, currency: string): Line[] {
  const t = a.targeting;
  const places = t.locations.map((l) => l.name).join(", ");
  const lines: Line[] = [
    { label: "Optimises for", value: `${goalText(a.optimizationGoal)}${a.promotedObject?.customEventType ? ` (${eventText(a.promotedObject.customEventType)})` : ""}` },
    { label: "Who", value: `${places} · ${t.ageMin}–${t.ageMax} · ${t.genders === "all" ? "all genders" : t.genders}${t.advantageAudience ? " · Advantage+ audience (age and interests are suggestions)" : ""}${t.interests?.length ? ` · interests: ${t.interests.map((i) => i.name).join(", ")}` : ""}` },
    { label: "Where", value: placementText(t) },
  ];
  if (parent.budgetMode === "ABO") {
    lines.push({ label: "Budget", value: a.dailyBudget != null ? `${moneyText(a.dailyBudget, currency)} a day` : `${moneyText(a.lifetimeBudget, currency)} in total` });
    lines.push({ label: "Bidding", value: `${bidText(a.bidStrategy)}${a.bidAmount != null ? ` at ${moneyText(a.bidAmount, currency)}` : ""}${a.roasFloor != null ? ` (ROAS ≥ ${a.roasFloor})` : ""}` });
  } else {
    lines.push({ label: "Budget", value: "Shared from the campaign (CBO)" });
  }
  if (a.startTime || a.endTime) lines.push({ label: "Runs", value: `${a.startTime ?? "when published"} → ${a.endTime ?? "no end"}` });
  if (a.schedule?.length) lines.push({ label: "Schedule", value: `${a.schedule.length} weekly block${a.schedule.length === 1 ? "" : "s"}` });
  if (a.frequencyCap) lines.push({ label: "Frequency cap", value: `${a.frequencyCap.impressions} per ${a.frequencyCap.days} day(s)` });
  return lines;
}

/** Plans (and, with confirm, creates) the paused campaign and ad set, then queues the ads as drafts. */
export async function sendRoute(deps: SheetDeps, input: Json) {
  const { graph, settings } = deps;
  const now = deps.now?.() ?? new Date();
  const { adAccountId, currency } = await accountContext(deps);
  const stage: Stage = input.stage === "SCALE" ? "SCALE" : "TEST";
  const errors: string[] = [];
  const objects: PlanObject[] = [];
  const cap = settings.max_daily_budget;

  // Campaign: an existing one (it must be in the workspace's account) or a new one.
  const c = obj(input.campaign);
  let parent: ParentCampaign;
  let campaignId: string | null = null;
  let newCampaign: CampaignSpec | null = null;
  if (c.id) {
    const row = await campaignInfo(graph, metaId(c.id, "campaign"), currency);
    mine(row, adAccountId, "campaign");
    if (!isOdax(row.objective)) throw new SheetError(`That campaign uses an older objective (${row.objective}) the API can't add to. Pick another campaign or make a new one.`);
    parent = { objective: row.objective, budgetMode: row.budgetMode, lifetime: row.lifetimeBudget != null, bidStrategy: row.bidStrategy, specialAdCategories: row.specialAdCategories };
    campaignId = row.id;
    objects.push({ level: "campaign", action: "use", name: row.name, lines: [{ label: "Objective", value: OBJECTIVE_INFO[row.objective].label }, { label: "Budget", value: row.budgetMode === "CBO" ? `${moneyText(row.dailyBudget ?? row.lifetimeBudget, currency)} ${row.dailyBudget != null ? "a day" : "in total"} (CBO)` : "On each ad set (ABO)" }, { label: "Status", value: statusText(row.effectiveStatus) }] });
  } else if (c.create) {
    newCampaign = parseCampaign(c.create);
    errors.push(...validateCampaign(newCampaign).map((e) => `Campaign: ${e}`));
    if (cap != null && newCampaign.budgetMode === "CBO" && newCampaign.dailyBudget != null && newCampaign.dailyBudget > cap) errors.push(`Campaign: the daily budget is over the ${moneyText(cap, currency)} guardrail in Launch settings.`);
    parent = { objective: newCampaign.objective, budgetMode: newCampaign.budgetMode, lifetime: newCampaign.lifetimeBudget != null, bidStrategy: newCampaign.bidStrategy, specialAdCategories: newCampaign.specialAdCategories };
    objects.push({ level: "campaign", action: "create", name: newCampaign.name, lines: campaignLines(newCampaign, currency) });
  } else {
    throw new SheetError("Pick a campaign, or create one.");
  }

  // Ad set: an existing one under that campaign, or a new one.
  const s = obj(input.adSet);
  let adSetId: string | null = null;
  let newAdSet: AdSetSpec | null = null;
  let destination: string | null = null;
  if (s.id) {
    if (newCampaign) throw new SheetError("A new campaign has no ad sets yet: create a new ad set too.");
    const row = await adSetInfo(graph, metaId(s.id, "ad set"), currency);
    mine(row, adAccountId, "ad set");
    if (row.campaignId !== campaignId) throw new SheetError("That ad set isn't in the chosen campaign.");
    adSetId = row.id;
    destination = row.destinationType;
    objects.push({ level: "adset", action: "use", name: row.name, lines: [{ label: "Optimises for", value: goalText(row.optimizationGoal) }, { label: "Who", value: row.targeting }, { label: "Budget", value: parent.budgetMode === "CBO" ? "Shared from the campaign (CBO)" : `${moneyText(row.dailyBudget ?? row.lifetimeBudget, currency)} ${row.dailyBudget != null ? "a day" : "in total"}` }, { label: "Already holds", value: `${row.ads} ad${row.ads === 1 ? "" : "s"}` }] });
    if (row.ads >= 50) errors.push("That ad set already holds 50 ads, Meta's limit. Pick or create another.");
  } else if (s.create) {
    newAdSet = parseAdSet(s.create);
    errors.push(...validateAdSet(newAdSet, parent, now).map((e) => `Ad set: ${e}`));
    if (cap != null && parent.budgetMode === "ABO" && newAdSet.dailyBudget != null && newAdSet.dailyBudget > cap) errors.push(`Ad set: the daily budget is over the ${moneyText(cap, currency)} guardrail in Launch settings.`);
    destination = newAdSet.destinationType ?? null;
    const interests = (newAdSet.targeting.interests ?? []).map((i) => i.id).filter((i) => /^\d+$/.test(i));
    if (interests.length) {
      const { invalid } = await validInterests(graph, interests);
      for (const bad of invalid) errors.push(`Ad set: Meta no longer offers the interest "${newAdSet.targeting.interests!.find((i) => i.id === bad)?.name ?? bad}". Remove it.`);
    }
    objects.push({ level: "adset", action: "create", name: newAdSet.name, lines: adSetLines(newAdSet, parent, currency) });
  } else {
    throw new SheetError("Pick an ad set, or create one.");
  }

  // The ads: creatives are read from the database (approved, QA passed), never from the caller.
  const parsed = parseAd(input.ad);
  const found = await deps.creatives(parsed.creativeIds);
  const missingCreative = parsed.creativeIds.find((i) => !found.has(i));
  if (missingCreative) throw new SheetError("One of the creatives isn't approved with a passing QA (or no longer exists).");
  for (const i of parsed.creativeIds) if (!deps.mediaAllowed(found.get(i)!.url)) throw new SheetError("Creatives must be files in this project's storage (https).");
  const ad: AdSpec = { ...parsed, creatives: parsed.creativeIds.map((i) => ({ id: i, kind: found.get(i)!.kind, aspect: found.get(i)!.aspect })) };
  errors.push(...validateAd(ad, parent.objective, destination).map((e) => `Ads: ${e}`));
  if (errors.length) throw new SheetError(errors[0], 400, { errors });

  // Names and payloads.
  const used = await deps.usedNames();
  const app = codeFor(settings);
  const date = day(now);
  const name = (creative: CreativeInput, format?: string) => {
    const f = format ?? creative.formatSlug ?? creative.formatCardId ?? "unformatted";
    const hook = creative.hookType ?? "hook";
    const n = adName({ app, stage, format: f, hook, version: nextVersion(used, app, f, hook), date });
    used.push(n);
    return n;
  };
  const copy = (creativeId?: string): CreativeCopy => {
    const own = creativeId ? ad.perCreative?.[creativeId] : undefined;
    return {
      pageId: ad.pageId, instagramId: ad.instagramId, primaryText: own?.primaryText ?? ad.primaryText, headline: own?.headline ?? ad.headline,
      description: own?.description ?? ad.description, cta: ad.cta, link: ad.link, displayLink: ad.displayLink, urlTags: ad.urlTags,
      advantageCreative: ad.advantageCreative, aiDisclosure: ad.aiDisclosure!, cards: ad.format === "carousel" ? ad.cards : undefined,
    };
  };
  const media = (ids: string[], rules?: Map<string, PlacementRule | null>) => ids.map((i) => {
    const creative = found.get(i)!;
    return { creativeId: i, kind: creative.kind, creative, rule: rules?.get(i) ?? null } as DraftSpec["media"][number];
  });
  type Planned = { name: string; creative: CreativeInput; spec: DraftSpec };
  const planned: Planned[] = [];
  if (ad.format === "single") {
    for (const i of parsed.creativeIds) planned.push({ name: name(found.get(i)!), creative: found.get(i)!, spec: { objective: parent.objective, format: "single", copy: copy(i), media: media([i]) } });
  } else if (ad.format === "carousel") {
    const order = ad.cards?.length ? ad.cards.map((c) => c.creativeId) : parsed.creativeIds;
    const first = found.get(order[0])!;
    planned.push({ name: name(first, "carousel"), creative: first, spec: { objective: parent.objective, format: "carousel", copy: copy(), media: media(order) } });
  } else {
    const rules = new Map((ad.placements ?? []).map((p) => [p.creativeId, p.rule]));
    const order = (ad.placements ?? []).map((p) => p.creativeId);
    const fallback = found.get((ad.placements ?? []).find((p) => !p.rule)!.creativeId)!;
    planned.push({ name: name(fallback), creative: fallback, spec: { objective: parent.objective, format: "placements", copy: copy(), media: media(order, rules) } });
  }
  const placeholder = (m: DraftSpec["media"][number]): MediaRef => ({
    ...m, imageHash: m.kind === "image" ? "<image hash>" : null, videoId: m.kind === "video" ? "<video id>" : null,
    thumbnailUrl: m.kind === "video" ? m.creative.thumbnailUrl ?? "<thumbnail>" : null,
  });
  for (const p of planned) {
    objects.push({
      level: "ad", action: "create", name: p.name,
      lines: [
        { label: "Format", value: p.spec.format === "single" ? `Single ${p.creative.kind}` : p.spec.format === "carousel" ? `Carousel of ${p.spec.media.length} cards` : `${p.spec.media.length} versions by placement` },
        { label: "Headline", value: p.spec.copy.headline },
        { label: "Button", value: CTA_LABEL[p.spec.copy.cta] ?? p.spec.copy.cta },
        { label: "Links to", value: p.spec.copy.link },
        { label: "AI disclosure", value: p.spec.copy.aiDisclosure === "OPT_IN" ? "Made with AI (declared)" : "Not made with AI (declared)" },
      ],
    });
  }

  const daily = (newCampaign?.budgetMode === "CBO" ? newCampaign.dailyBudget ?? 0 : 0) + (newAdSet && parent.budgetMode === "ABO" ? newAdSet.dailyBudget ?? 0 : 0);
  const lifetime = (newCampaign?.budgetMode === "CBO" ? newCampaign.lifetimeBudget ?? 0 : 0) + (newAdSet && parent.budgetMode === "ABO" ? newAdSet.lifetimeBudget ?? 0 : 0);
  const plan = {
    currency, stage, objects,
    money: { currency, daily: daily || null, lifetime: lifetime || null, text: [daily ? `${moneyText(daily, currency)} a day` : "", lifetime ? `${moneyText(lifetime, currency)} in total` : ""].filter(Boolean).join(" + ") || "No new budget (the ads join an existing budget)." },
    note: "Everything is created paused — nothing spends until you publish it in Ads Manager.",
    payloads: {
      campaign: newCampaign ? { edge: `${act(adAccountId)}/campaigns`, params: campaignBody(newCampaign, currency) } : null,
      adSet: newAdSet ? { edge: `${act(adAccountId)}/adsets`, params: adSetBody(newAdSet, campaignId ?? "<campaign id>", parent, currency) } : null,
      ads: planned.map((p) => ({
        creative: { edge: `${act(adAccountId)}/adcreatives`, params: creativeBody(p.name, p.spec.format, p.spec.copy, p.spec.media.map(placeholder), parent.objective) },
        ad: { edge: `${act(adAccountId)}/ads`, params: adPayload(p.name, adSetId ?? "<ad set id>", "<creative id>") },
      })),
    },
  };
  if (input.confirm !== true) return { plan };

  // Create: paused campaign → paused ad set → queued drafts (the worker uploads and makes the paused ads).
  deps.allowWrite();
  const created: Record<string, { id: string; name: string; url: string }> = {};
  try {
    if (newCampaign) {
      campaignId = await createObject(graph, adAccountId, "campaigns", campaignBody(newCampaign, currency));
      created.campaign = { id: campaignId, name: newCampaign.name, url: adsManagerUrl(adAccountId, "campaigns", [campaignId]) };
    }
    if (newAdSet) {
      adSetId = await createObject(graph, adAccountId, "adsets", adSetBody(newAdSet, campaignId!, parent, currency));
      created.adSet = { id: adSetId, name: newAdSet.name, url: adsManagerUrl(adAccountId, "adsets", [adSetId]) };
    }
  } catch (error) {
    const kept = Object.keys(created).length ? " What was already made stays in Ads Manager, paused (Launch never deletes): pick it as the destination to try again." : "";
    throw new SheetError(`${explain(error)}${kept}`, 400, { created });
  }
  const { jobId, drafts } = await deps.queue(planned.map((p) => ({
    stage, creative: p.creative, ad_name: p.name, primary_text: p.spec.copy.primaryText, headline: p.spec.copy.headline,
    cta: p.spec.copy.cta, link: p.spec.copy.link, adset_id: adSetId!, spec: p.spec,
  })));
  return {
    created, jobId, drafts,
    campaign: { id: campaignId, url: adsManagerUrl(adAccountId, "campaigns", [campaignId!]) },
    adSet: { id: adSetId, url: adsManagerUrl(adAccountId, "adsets", [adSetId!]) },
    note: plan.note,
  };
}

// MARK: Edit

export function parseChanges(raw: unknown): EditChanges {
  const r = obj(raw);
  const out: EditChanges = {};
  if ("name" in r) out.name = str(r.name, 400);
  for (const k of ["dailyBudget", "lifetimeBudget", "bidAmount", "roasFloor", "spendCap"] as const) if (k in r && r[k] !== "" && r[k] != null) out[k] = num(r[k]);
  if (r.bidStrategy) out.bidStrategy = strategy(r.bidStrategy);
  if (r.startTime) out.startTime = opt(r.startTime, 40);
  if (r.endTime) out.endTime = opt(r.endTime, 40);
  if (r.pause === true) out.pause = true;
  return out;
}

/** Plans (or, confirmed, applies) a change to a campaign or ad set. Never turns anything on. */
export async function editRoute(deps: SheetDeps, input: Json) {
  const { adAccountId, currency } = await accountContext(deps);
  const level = input.level === "campaign" ? "campaign" : input.level === "adset" ? "adset" : null;
  if (!level) throw new SheetError("Edit a campaign or an ad set.");
  const targetId = metaId(input.id, level === "campaign" ? "campaign" : "ad set");
  const changes = parseChanges(input.changes);
  let target;
  let name: string;
  if (level === "campaign") {
    const row = await campaignInfo(deps.graph, targetId, currency);
    mine(row, adAccountId, "campaign");
    target = { level, budgetMode: row.budgetMode, dailyBudget: row.dailyBudget, lifetimeBudget: row.lifetimeBudget, bidStrategy: row.bidStrategy } as const;
    name = row.name;
  } else {
    const row = await adSetInfo(deps.graph, targetId, currency);
    mine(row, adAccountId, "ad set");
    const parentRow = await campaignInfo(deps.graph, row.campaignId, currency);
    target = { level, budgetMode: parentRow.budgetMode, dailyBudget: row.dailyBudget, lifetimeBudget: row.lifetimeBudget, bidStrategy: row.bidStrategy, bidAmount: row.bidAmount } as const;
    name = row.name;
  }
  const { errors, hints } = validateEdit(target, changes);
  const cap = deps.settings.max_daily_budget;
  if (cap != null && changes.dailyBudget != null && changes.dailyBudget > cap) errors.push(`The daily budget is over the ${moneyText(cap, currency)} guardrail in Launch settings.`);
  if (changes.roasFloor != null && (changes.bidStrategy ?? target.bidStrategy) !== "LOWEST_COST_WITH_MIN_ROAS") errors.push("A ROAS floor needs the ROAS goal bid strategy.");

  const fields: Record<string, unknown> = {};
  const lines: Line[] = [];
  if (changes.name !== undefined && changes.name !== name) { fields.name = changes.name; lines.push({ label: "Name", value: changes.name }); }
  if (changes.dailyBudget != null) { fields.daily_budget = toMinor(changes.dailyBudget, currency); lines.push({ label: "Daily budget", value: `${moneyText(target.dailyBudget, currency)} → ${moneyText(changes.dailyBudget, currency)}` }); }
  if (changes.lifetimeBudget != null) { fields.lifetime_budget = toMinor(changes.lifetimeBudget, currency); lines.push({ label: "Lifetime budget", value: `${moneyText(target.lifetimeBudget, currency)} → ${moneyText(changes.lifetimeBudget, currency)}` }); }
  if (changes.bidStrategy) { fields.bid_strategy = changes.bidStrategy; lines.push({ label: "Bidding", value: changes.bidStrategy }); }
  if (changes.bidAmount != null) { fields.bid_amount = toMinor(changes.bidAmount, currency); lines.push({ label: "Bid amount", value: moneyText(changes.bidAmount, currency) }); }
  if (changes.roasFloor != null) { fields.bid_constraints = { roas_average_floor: Math.round(changes.roasFloor * 100) }; lines.push({ label: "ROAS floor", value: `${changes.roasFloor}×` }); }
  if (changes.spendCap != null) {
    if (level !== "campaign") errors.push("Spending limits are set on the campaign.");
    fields.spend_cap = toMinor(changes.spendCap, currency); lines.push({ label: "Spending limit", value: moneyText(changes.spendCap, currency) });
  }
  if (changes.startTime) { fields.start_time = new Date(changes.startTime).toISOString(); lines.push({ label: "Starts", value: changes.startTime }); }
  if (changes.endTime) { fields[level === "campaign" ? "stop_time" : "end_time"] = new Date(changes.endTime).toISOString(); lines.push({ label: "Ends", value: changes.endTime }); }
  if (changes.pause) { fields.status = "PAUSED"; lines.push({ label: "Status", value: "Paused" }); }
  if (errors.length) throw new SheetError(errors[0], 400, { errors, hints });
  if (!Object.keys(fields).length) throw new SheetError("Nothing to change.");
  const url = adsManagerUrl(adAccountId, level === "campaign" ? "campaigns" : "adsets", [targetId]);
  if (input.confirm !== true) return { plan: { level, id: targetId, name, lines, fields, hints, url } };
  deps.allowWrite();
  await updateObject(deps.graph, targetId, fields);
  return { updated: targetId, lines, hints, url };
}
