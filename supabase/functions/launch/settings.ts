// The Launch settings form, validated. Users can only read launch_settings (row-level security); every
// save comes through the edge function's /settings route, which runs this first. Moved here from the
// studio (studio/src/lib/server/launch.ts) so there is one validator.
import type { LaunchSettingsRow, Thresholds } from "./types.ts";

export type WarmupStatus = "not_started" | "running" | "done" | "skipped";
export type AttributionStep = "sdk" | "mmp_collecting" | "mmp";
export interface Playbook {
  warmup?: { status: WarmupStatus; startedAt?: string | null };
  attribution?: { step: AttributionStep };
}

/** The columns a save may set. Anything else in the request is ignored. */
export type SettingsPatch = Partial<Pick<LaunchSettingsRow,
  | "objective" | "app_code" | "meta" | "countries"
  | "testing_campaign_id" | "testing_adset_id" | "scaling_campaign_id" | "scaling_adset_id"
  | "testing_daily_budget" | "scaling_daily_budget" | "max_daily_budget" | "thresholds" | "default_cta"
  | "automation_enabled" | "automation_max_ads_per_day" | "automation_max_ads_in_adset" | "scaling_budget" | "optimize_for"
>> & { playbook?: Playbook };

const ID = /^\d{5,25}$/;
const str = (v: unknown, max = 300) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
const num = (v: unknown, min: number, max: number) => {
  if (v === null || v === "" || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
};
const metaId = (v: unknown) => {
  const s = str(v, 40)?.replace(/^act_/, "");
  return s && ID.test(s) ? s : undefined;
};
const https = (v: unknown) => {
  const s = str(v, 500);
  if (!s) return undefined;
  try { return new URL(s).protocol === "https:" ? s : undefined; } catch { return undefined; }
};

/** Validates the Launch settings form; returns the columns to save or an error message. */
export function settingsInput(raw: Record<string, unknown>): SettingsPatch | string {
  const out: SettingsPatch = {};
  if ("objective" in raw) {
    if (raw.objective !== "app_promotion" && raw.objective !== "website_traffic") return "Pick an objective.";
    out.objective = raw.objective;
  }
  if ("app_code" in raw) {
    const code = str(raw.app_code, 6)?.toUpperCase();
    if (code && !/^[A-Z0-9]{2,6}$/.test(code)) return "The short code is 2–6 letters or digits (AC, TRAIL).";
    out.app_code = code ?? null;
  }
  if ("meta" in raw && raw.meta && typeof raw.meta === "object") {
    const m = raw.meta as Record<string, unknown>;
    for (const [key, label] of [["adAccountId", "ad account"], ["pageId", "Page"], ["instagramId", "Instagram account"], ["pixelId", "pixel"], ["appId", "Meta app"]] as const) {
      if (str(m[key]) && !metaId(m[key])) return `The ${label} id should be digits only.`;
    }
    for (const key of ["appStoreUrl", "websiteUrl"] as const) if (str(m[key]) && !https(m[key])) return "Links must start with https://.";
    out.meta = {
      adAccountId: metaId(m.adAccountId), pageId: metaId(m.pageId), instagramId: metaId(m.instagramId), pixelId: metaId(m.pixelId), appId: metaId(m.appId),
      appStoreUrl: https(m.appStoreUrl), websiteUrl: https(m.websiteUrl), appName: str(m.appName, 120),
    };
  }
  if ("countries" in raw) {
    const list = (Array.isArray(raw.countries) ? raw.countries : String(raw.countries ?? "").split(/[\s,]+/))
      .map((c) => String(c).trim().toUpperCase()).filter(Boolean);
    if (!list.length || list.some((c) => !/^[A-Z]{2}$/.test(c))) return "Countries are two-letter codes (US, GB, IN).";
    out.countries = [...new Set(list)].slice(0, 25);
  }
  for (const key of ["testing_campaign_id", "testing_adset_id", "scaling_campaign_id", "scaling_adset_id"] as const) {
    if (!(key in raw)) continue;
    if (str(raw[key]) && !metaId(raw[key])) return "Campaign and ad set ids are digits only.";
    out[key] = metaId(raw[key]) ?? null;
  }
  for (const key of ["testing_daily_budget", "scaling_daily_budget", "max_daily_budget"] as const) {
    if (!(key in raw)) continue;
    const n = num(raw[key], 0.01, 100_000_000);
    if (n === undefined) return "Budgets must be positive amounts.";
    out[key] = n;
  }
  if ("default_cta" in raw) out.default_cta = str(raw.default_cta, 40) ?? null;
  if ("automation_enabled" in raw) out.automation_enabled = raw.automation_enabled === true;
  if ("automation_max_ads_per_day" in raw) {
    const n = num(raw.automation_max_ads_per_day, 1, 20);
    if (n == null) return "Daily uploads: 1–20 ads a day.";
    out.automation_max_ads_per_day = Math.round(n);
  }
  if ("automation_max_ads_in_adset" in raw) {
    const n = num(raw.automation_max_ads_in_adset, 1, 50);
    if (n == null) return "The testing ad set holds at most 1–50 ads.";
    out.automation_max_ads_in_adset = Math.round(n);
  }
  if ("thresholds" in raw && raw.thresholds && typeof raw.thresholds === "object") {
    const t = raw.thresholds as Record<string, unknown>;
    const r: Partial<Thresholds> = {};
    const ranges: Partial<Record<keyof Thresholds, [number, number]>> = {
      targetCac: [0, 1e9], minSpendMultiple: [0.5, 20], minConversions: [1, 1000], minDays: [1, 30], maxDayShare: [0.2, 1],
      confidence: [0.5, 0.999], windowDays: [1, 90], minPayingForRoas: [0, 1000], pauseSpendMultiple: [0.5, 20], pauseConfidence: [0.5, 0.999],
    };
    for (const [key, [min, max]] of Object.entries(ranges) as [keyof Thresholds, [number, number]][]) {
      if (!(key in t)) continue;
      const n = num(t[key], min, max);
      if (n == null) return `${key} must be between ${min} and ${max}.`;
      (r as Record<string, number>)[key] = n;
    }
    if ("targetRoas" in t) {
      const n = num(t.targetRoas, 0.01, 100);
      if (n === undefined) return "Target ROAS must be a positive number (or empty).";
      r.targetRoas = n;
    }
    if ("conversionEvent" in t) {
      if (!["install", "trial", "purchase", "link_click"].includes(String(t.conversionEvent))) return "Pick the conversion to judge by.";
      r.conversionEvent = t.conversionEvent as Thresholds["conversionEvent"];
    }
    out.thresholds = r;
  }
  if ("scaling_budget" in raw) {
    if (!["campaign", "adset"].includes(String(raw.scaling_budget))) return "Pick where the scaling budget goes.";
    out.scaling_budget = raw.scaling_budget as LaunchSettingsRow["scaling_budget"];
  }
  if ("optimize_for" in raw) {
    if (!["install", "trial", "purchase"].includes(String(raw.optimize_for))) return "Pick what app ad sets optimise for.";
    out.optimize_for = raw.optimize_for as LaunchSettingsRow["optimize_for"];
  }
  if ("playbook" in raw && raw.playbook && typeof raw.playbook === "object") {
    const pb = raw.playbook as { warmup?: { status?: unknown; startedAt?: unknown }; attribution?: { step?: unknown } };
    const next: Playbook = {};
    if (pb.warmup) {
      const status = String(pb.warmup.status);
      if (!["not_started", "running", "done", "skipped"].includes(status)) return "Unknown warm-up status.";
      const startedAt = typeof pb.warmup.startedAt === "string" && !Number.isNaN(Date.parse(pb.warmup.startedAt)) ? new Date(pb.warmup.startedAt).toISOString() : null;
      next.warmup = { status: status as WarmupStatus, startedAt };
    }
    if (pb.attribution) {
      const step = String(pb.attribution.step);
      if (!["sdk", "mmp_collecting", "mmp"].includes(step)) return "Unknown attribution step.";
      next.attribution = { step: step as AttributionStep };
    }
    out.playbook = next;
  }
  if (out.automation_enabled && "max_daily_budget" in out && out.max_daily_budget == null) return "Set a maximum daily budget before turning on daily uploads.";
  return out;
}

/** Turning daily uploads on needs a budget cap and a testing ad set, saved now or before. */
export function automationRefusal(patch: SettingsPatch, current: Pick<LaunchSettingsRow, "max_daily_budget" | "testing_adset_id"> | null): string | null {
  if (!patch.automation_enabled) return null;
  const cap = "max_daily_budget" in patch ? patch.max_daily_budget : current?.max_daily_budget;
  const adSet = "testing_adset_id" in patch ? patch.testing_adset_id : current?.testing_adset_id;
  if (cap == null) return "Set a maximum daily budget before turning on daily uploads.";
  if (!adSet) return "Choose the testing ad set before turning on daily uploads.";
  return null;
}
