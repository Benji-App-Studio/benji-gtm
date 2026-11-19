import "server-only";
// The studio holds no Meta token: everything that touches the Marketing API runs in the `launch`
// Supabase edge function. API routes call it as the signed-in user.
import { DEFAULT_THRESHOLDS } from "@/lib/launch/promotion";
import type { LaunchSettings } from "@/lib/launch/types";
import type { Session } from "./auth";
import { callFunction } from "./functions";
import type { RadarResult } from "./radar";

// LAUNCH_FUNCTION_URL points the studio at a locally served launch function (supabase functions
// serve, with LAUNCH_META_MOCK=1) while developing; unset, it's the deployed one.
export function launch<T = Record<string, unknown>>(session: Session, route: string, body: unknown, timeoutMs = 60_000): Promise<RadarResult<T>> {
  return callFunction<T>("launch", session, route, {
    body,
    method: "POST",
    timeoutMs,
    messages: {
      notDeployed: "The launch function isn't deployed yet.",
      badAnswer: (status) => `Launch's backend answered ${status}.`,
      unreachable: "Couldn't reach Launch's backend. Try again in a moment.",
    },
  });
}

// MARK: Settings

// Saving settings: the edge function's /settings route validates the form (supabase/functions/launch/
// settings.ts) and writes it; users can only read launch_settings.

export function defaultSettings(productId: string, w: { appName: string; appStoreUrl?: string; website?: string; meta?: Partial<LaunchSettings["meta"]> }): LaunchSettings {
  return {
    product_id: productId, app_code: null,
    objective: w.appStoreUrl ? "app_promotion" : "website_traffic",
    meta: { ...w.meta, appName: w.appName, appStoreUrl: w.appStoreUrl, websiteUrl: w.website },
    countries: ["US"], testing_campaign_id: null, testing_adset_id: null, scaling_campaign_id: null, scaling_adset_id: null,
    testing_daily_budget: null, scaling_daily_budget: null, max_daily_budget: null,
    thresholds: { ...DEFAULT_THRESHOLDS }, default_cta: null, scaling_budget: "campaign", optimize_for: "install",
    automation_enabled: false, automation_max_ads_per_day: 3, automation_max_ads_in_adset: 20,
    automation_last_run_at: null, automation_last_note: null,
  };
}
