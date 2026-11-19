// Shapes shared by the launch function's modules (database rows and what Meta needs).
import type { Stage } from "./naming.ts";
import type { DraftSpec } from "./pipeline.ts";

export type Objective = "app_promotion" | "website_traffic";
export type CreativeKind = "video" | "image";

/** An approved creative from the studio (the same shape as listApprovedCreatives in the studio). */
export interface CreativeInput {
  id: string;
  url: string;
  kind: CreativeKind;
  aspect?: string;
  durationSec?: number;
  formatCardId?: string;
  /** The format's slug for names (falls back to formatCardId). */
  formatSlug?: string;
  /** What kind of hook opens the ad (pain-point, curiosity, social-proof…), for names. */
  hookType?: string;
  headline?: string;
  primaryText?: string;
  cta?: string;
  /** Meta's link description (disclaimers: "Results vary.", "AI-generated imagery."). */
  description?: string;
  /** Made by a model (AI people, a generated scene): declared made with AI unless the person says otherwise. */
  aiGenerated?: boolean;
  /**
   * On a draft's copy of the creative: what the person declared (self_ai_disclosure). Testing drafts
   * keep it here (and the description above) so the worker sends both without new draft columns.
   */
  aiDisclosure?: "OPT_IN" | "OPT_OUT";
  thumbnailUrl?: string;
  approvedAt?: string;
}

/** Where ads go: the workspace's Meta connection (from the workspace) and Launch's own settings. */
export interface MetaConnection {
  adAccountId?: string;
  pageId?: string;
  /** The Instagram account ads run as (object_story_spec.instagram_user_id). */
  instagramId?: string;
  pixelId?: string;
  /** The Meta app id registered for the iOS app (needed for app promotion). */
  appId?: string;
}

export interface StageIds { campaignId?: string | null; adSetId?: string | null }

/** Promotion and pause rules (see studio/src/lib/launch/promotion.ts for what each one means). */
export interface Thresholds {
  targetCac: number;
  targetRoas: number | null;
  conversionEvent: "install" | "trial" | "purchase" | "link_click";
  minSpendMultiple: number;
  minConversions: number;
  minDays: number;
  maxDayShare: number;
  confidence: number;
  windowDays: number;
  minPayingForRoas: number;
  pauseSpendMultiple: number;
  pauseConfidence: number;
}

export interface LaunchSettingsRow {
  product_id: string;
  user_id: string;
  app_code: string | null;
  objective: Objective;
  meta: MetaConnection & { appStoreUrl?: string; websiteUrl?: string; appName?: string };
  countries: string[];
  testing_campaign_id: string | null;
  testing_adset_id: string | null;
  scaling_campaign_id: string | null;
  scaling_adset_id: string | null;
  testing_daily_budget: number | null;
  scaling_daily_budget: number | null;
  max_daily_budget: number | null;
  thresholds: Partial<Thresholds>;
  automation_enabled: boolean;
  automation_max_ads_per_day: number;
  automation_max_ads_in_adset: number;
  automation_last_run_at: string | null;
  default_cta: string | null;
  /** Where the scaling budget lives: the campaign (CBO, the playbook's default) or the ad set (ABO). Testing is always ABO. */
  scaling_budget?: "campaign" | "adset";
  /** What app ad sets optimise for: installs, or the trial / purchase app events (sent by the SDK or an MMP). */
  optimize_for?: "install" | "trial" | "purchase";
  created_at?: string;
  updated_at?: string;
}

export type DraftStatus = "queued" | "processing" | "creating" | "draft" | "error" | "cancelled";
export const TERMINAL: DraftStatus[] = ["draft", "error", "cancelled"];

export interface DraftRow {
  id: string;
  user_id: string;
  product_id: string;
  job_id: string | null;
  source: "manual" | "automation" | "promotion";
  stage: Stage;
  creative_ref: string;
  creative: CreativeInput;
  ad_name: string;
  primary_text: string;
  headline: string;
  cta: string;
  link: string;
  adset_id: string;
  status: DraftStatus;
  image_hash: string | null;
  video_id: string | null;
  thumbnail_url: string | null;
  meta_creative_id: string | null;
  ad_id: string | null;
  promoted_from_ad_id: string | null;
  attempts: number;
  error: string | null;
  next_check_at: string | null;
  /** Drafts from the "Send to Meta" sheet: the format, the shared copy and every piece of media (null for testing drafts). */
  spec?: DraftSpec | null;
  created_at: string;
  updated_at: string;
}
