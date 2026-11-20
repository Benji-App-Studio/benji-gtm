// Launch's shapes on the studio side: the settings row, drafts and what the Launch page loads.
// The database rows mirror supabase/functions/launch/types.ts.
import type { ApprovedCreative } from "@/lib/creatives";
import type { Suggestion, Thresholds } from "./promotion";
import type { ScalingAdvice } from "./scaling";
import { m } from "../i18n/translate";

export type Objective = "app_promotion" | "website_traffic";

export interface LaunchMeta {
  adAccountId?: string;
  pageId?: string;
  instagramId?: string;
  pixelId?: string;
  appId?: string;
  appStoreUrl?: string;
  websiteUrl?: string;
  appName?: string;
}

export interface LaunchSettings {
  product_id: string;
  app_code: string | null;
  objective: Objective;
  meta: LaunchMeta;
  countries: string[];
  testing_campaign_id: string | null;
  testing_adset_id: string | null;
  scaling_campaign_id: string | null;
  scaling_adset_id: string | null;
  testing_daily_budget: number | null;
  scaling_daily_budget: number | null;
  max_daily_budget: number | null;
  thresholds: Partial<Thresholds>;
  default_cta: string | null;
  automation_enabled: boolean;
  automation_max_ads_per_day: number;
  automation_max_ads_in_adset: number;
  automation_last_run_at: string | null;
  automation_last_note: string | null;
  /** Scaling budget on the campaign (CBO) or the ad set (ABO); testing is always ABO. */
  scaling_budget: "campaign" | "adset";
  /** What app ad sets optimise for: installs, or the trial / purchase app event. */
  optimize_for: "install" | "trial" | "purchase";
  /** Optional progress through the Meta ads playbook (warm-up, attribution); suggestions only. */
  playbook?: Playbook;
}

export type WarmupStatus = "not_started" | "running" | "done" | "skipped";
export type AttributionStep = "sdk" | "mmp_collecting" | "mmp";
export interface Playbook {
  warmup?: { status: WarmupStatus; startedAt?: string | null };
  attribution?: { step: AttributionStep };
}

export type DraftStatus = "queued" | "processing" | "creating" | "draft" | "error" | "cancelled";

export interface LaunchDraft {
  id: string;
  job_id: string | null;
  source: "manual" | "automation" | "promotion";
  stage: "TEST" | "SCALE";
  creative_ref: string;
  creative: Partial<ApprovedCreative>;
  ad_name: string;
  primary_text: string;
  headline: string;
  cta: string;
  link: string;
  adset_id: string;
  status: DraftStatus;
  ad_id: string | null;
  promoted_from_ad_id: string | null;
  reason: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export const DRAFT_COLUMNS = "id, job_id, source, stage, creative_ref, creative, ad_name, primary_text, headline, cta, link, adset_id, status, ad_id, promoted_from_ad_id, reason, error, created_at, updated_at";

export interface AdSetStatus { id: string; name: string; status: string; effectiveStatus: string; dailyBudget: number | null; lifetimeBudget: number | null; ads: number; url: string }

/** The launch function's /status answer. */
export interface ConnectionStatus {
  connected: boolean;
  mock?: boolean;
  version?: string;
  missing?: string[];
  issues?: string[];
  error?: string;
  account?: { id: string; name: string; currency: string; accountStatus: number; hasPaymentMethod: boolean; url: string };
  testing?: AdSetStatus;
  scaling?: AdSetStatus;
}

export interface LaunchOverview {
  workspace: { id: string; name: string; appName: string; appStoreUrl?: string; website?: string };
  /** Saved settings, or null before the first save (then `defaults` prefill the form). */
  settings: LaunchSettings | null;
  defaults: LaunchSettings;
  creatives: ApprovedCreative[];
  drafts: LaunchDraft[];
  status: ConnectionStatus;
  suggestions: Suggestion[];
  thresholds: Thresholds;
  metricsRange: { since: string; until: string };
  scaling: ScalingAdvice;
  /** Conversions (by the judged event) and spend over the last 7 and 28 days, account-wide. */
  volume: { last7: number; last28: number; spend28: number };
  /** Whether the workspace has an MMP (AppStack) app connected. */
  mmpConnected: boolean;
}

export const CTA_OPTIONS: Record<Objective, { value: string; label: string }[]> = {
  app_promotion: [
    { value: "INSTALL_MOBILE_APP", label: m("Install now") },
    { value: "DOWNLOAD", label: m("Download") },
    { value: "USE_APP", label: m("Use app") },
    { value: "SIGN_UP", label: m("Sign up") },
    { value: "SUBSCRIBE", label: m("Subscribe") },
    { value: "LEARN_MORE", label: m("Learn more") },
  ],
  website_traffic: [
    { value: "LEARN_MORE", label: m("Learn more") },
    { value: "SIGN_UP", label: m("Sign up") },
    { value: "DOWNLOAD", label: m("Download") },
    { value: "SUBSCRIBE", label: m("Subscribe") },
    { value: "GET_OFFER", label: m("Get offer") },
  ],
};

/** Mirrors ctaType in the edge function: free text from a creative → a Meta CTA for the objective. */
export function ctaFor(text: string | undefined | null, objective: Objective): string {
  const options = CTA_OPTIONS[objective].map((o) => o.value);
  const t = (text ?? "").trim().toUpperCase().replace(/[^A-Z]+/g, "_");
  if (options.includes(t)) return t;
  const s = t.replace(/_/g, " ");
  if (/INSTALL|GET THE APP|GET APP/.test(s)) return objective === "app_promotion" ? "INSTALL_MOBILE_APP" : "DOWNLOAD";
  if (/DOWNLOAD/.test(s)) return "DOWNLOAD";
  if (/SIGN ?UP|JOIN|REGISTER|START|TRY/.test(s)) return "SIGN_UP";
  if (/SUBSCRIBE/.test(s)) return "SUBSCRIBE";
  if (/OPEN|USE/.test(s) && objective === "app_promotion") return "USE_APP";
  return objective === "app_promotion" ? "INSTALL_MOBILE_APP" : "LEARN_MORE";
}

export const ctaLabel = (value: string, objective: Objective) => CTA_OPTIONS[objective].find((o) => o.value === value)?.label ?? value.replace(/_/g, " ").toLowerCase();
