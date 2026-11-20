import type { NextRequest } from "next/server";
import { getAdMetrics } from "@/lib/ad-metrics";
import { getTranslator } from "@/lib/i18n/server";
import { listApprovedCreatives } from "@/lib/creatives";
import { suggest, thresholds } from "@/lib/launch/promotion";
import { fromMinor, scalingAdvice } from "@/lib/launch/scaling";
import { DRAFT_COLUMNS, type ConnectionStatus, type LaunchDraft, type LaunchOverview, type LaunchSettings } from "@/lib/launch/types";
import { isResponse, requireUser } from "@/lib/server/auth";
import { defaultSettings, launch } from "@/lib/server/launch";
import { relay } from "@/lib/server/radar";
import { loadWorkspace } from "@/lib/server/workspaces";
import { launchedStages } from "@/lib/server/launched-ads";

const day = (offset = 0) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

/** Everything the Launch page shows: settings, approved creatives, drafts, the Meta connection and suggestions. */
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/launch/[productId]">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { productId } = await ctx.params;
  const workspace = await loadWorkspace(productId);
  if (isResponse(workspace)) return workspace;

  const metricsRange = { since: day(-28), until: day() };
  const [{ data: saved }, { data: drafts }, creatives, metrics, launched] = await Promise.all([
    session.supabase.from("launch_settings").select("*").eq("product_id", productId).maybeSingle(),
    session.supabase.from("launch_drafts").select(DRAFT_COLUMNS).eq("product_id", productId).order("created_at", { ascending: false }).limit(100),
    listApprovedCreatives(productId),
    getAdMetrics(productId, metricsRange),
    // Every ad Launch sent and its stage, so ads sent into other ad sets are judged too.
    launchedStages(session.supabase, productId),
  ]);
  const settings = (saved as LaunchSettings | null) ?? null;
  const defaults = defaultSettings(productId, {
    appName: workspace.brandKit.appName, appStoreUrl: workspace.brandKit.appStoreUrl,
    meta: workspace.connections.meta,
  });
  const { t } = await getTranslator();
  const status: ConnectionStatus = settings
    ? (await launch<ConnectionStatus>(session, "status", { productId }, 20_000)).data
    : { connected: false, missing: [t("Save the Launch settings to connect this workspace.")] };

  const th = thresholds(settings?.thresholds);
  const rows = (drafts ?? []) as LaunchDraft[];
  const promoted = new Set(rows.filter((d) => d.source === "promotion" && d.status === "draft" && d.promoted_from_ad_id).map((d) => d.promoted_from_ad_id!));
  const suggestions = suggest(metrics, th, { testingAdSetId: settings?.testing_adset_id, scalingAdSetId: settings?.scaling_adset_id, promoted, launched });

  const currency = status.account?.currency ?? metrics[0]?.currency ?? "USD";
  const scaling = scalingAdvice({
    metrics, thresholds: th, scalingAdSetId: settings?.scaling_adset_id,
    dailyBudget: status.scaling?.dailyBudget != null ? fromMinor(status.scaling.dailyBudget, currency) : settings?.scaling_daily_budget ?? null,
    maxDailyBudget: settings?.max_daily_budget ?? null, currency,
  });
  const event = (d: (typeof metrics)[number]["days"][number]) => (th.conversionEvent === "install" ? d.installs : th.conversionEvent === "trial" ? d.trials : th.conversionEvent === "purchase" ? d.purchases : d.clicks);
  const since7 = day(-7);
  const volume = { last7: 0, last28: 0, spend28: 0 };
  for (const m of metrics) for (const d of m.days) {
    volume.last28 += event(d); volume.spend28 += d.spend;
    if (d.date >= since7) volume.last7 += event(d);
  }

  const overview: LaunchOverview = {
    workspace: { id: workspace.id, name: workspace.name, appName: workspace.brandKit.appName, appStoreUrl: workspace.brandKit.appStoreUrl, website: defaults.meta.websiteUrl },
    settings, defaults, creatives, drafts: rows, status, suggestions, thresholds: th, metricsRange,
    scaling, volume, mmpConnected: Boolean(workspace.connections.appstack?.appId),
  };
  return Response.json(overview);
}

/**
 * Saves Launch settings (including the daily-uploads switch). Users can only read launch_settings: the
 * launch function checks LAUNCH_ALLOWED_EMAILS, validates the form and writes it.
 */
export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/launch/[productId]">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { productId } = await ctx.params;
  const workspace = await loadWorkspace(productId);
  if (isResponse(workspace)) return workspace;
  const settings = await request.json().catch(() => ({}));
  return relay(await launch(session, "settings", { productId, settings }));
}
