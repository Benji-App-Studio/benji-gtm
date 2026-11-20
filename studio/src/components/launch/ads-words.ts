// The Ads view's words and number formats: each status, verdict and reason in plain words (in the
// page's language), and money, counts and dates in the page's locale.
import { formatMoney } from "../../lib/i18n/format";
import type { Translator } from "@/lib/i18n/translate";
import type { AttentionReason, Filter, LaunchedAd, SortKey, StatusKey, VerdictCode } from "@/lib/launch/tracking";

export function statusLabel({ t }: Translator, key: StatusKey): string {
  switch (key) {
    case "queued": return t("Queued");
    case "processing": return t("Meta is processing the video");
    case "creating": return t("Creating the ad");
    case "failed": return t("Failed to send");
    case "cancelled": return t("Cancelled");
    case "not_synced": return t("Paused draft (not synced yet)");
    case "running": return t("Running");
    case "paused": return t("Paused");
    case "adset_paused": return t("Ad set paused");
    case "campaign_paused": return t("Campaign paused");
    case "in_review": return t("In review");
    case "in_process": return t("Meta is processing");
    case "rejected": return t("Rejected by Meta");
    case "issues": return t("Delivery issues");
    case "preapproved": return t("Approved, not running");
    case "billing": return t("Needs billing info");
    case "archived": return t("Archived");
    case "deleted": return t("Deleted");
    case "unknown": return t("Unknown");
  }
}

export function statusTone(key: StatusKey): "win" | "warn" | "neutral" | "accent" {
  if (key === "running") return "win";
  if (key === "failed" || key === "rejected" || key === "issues" || key === "billing") return "warn";
  if (key === "queued" || key === "processing" || key === "creating" || key === "in_review" || key === "in_process") return "accent";
  return "neutral";
}

export function verdictLabel({ t }: Translator, code: VerdictCode): string {
  switch (code) {
    case "promote": return t("Promote");
    case "pause": return t("Pause");
    case "in_scaling": return t("In scaling");
    case "not_live": return t("Not on Meta yet");
    case "paused": return t("Paused");
    case "winner": return t("Winner");
    case "on_target": return t("On target");
    case "above_target": return t("Above target");
    case "learning": return t("Learning");
    case "no_customers": return t("No customers");
    case "converting": return t("Converting");
    case "no_customers_yet": return t("No customers yet");
    case "no_spend": return t("No spend");
  }
}

export function attentionLabel({ t }: Translator, reason: AttentionReason): string {
  switch (reason) {
    case "draft_failed": return t("The ad didn't reach Meta");
    case "delivery": return t("Meta reports a delivery problem");
    case "pause_suggested": return t("Launch suggests pausing it");
    case "no_customers": return t("Spent a customer's worth without a customer");
    case "above_target": return t("CAC is above LTV");
  }
}

export function filterLabel({ t }: Translator, filter: Filter): string {
  switch (filter) {
    case "all": return t("All");
    case "testing": return t("Testing");
    case "scaling": return t("Scaling");
    case "attention": return t("Needs attention");
    case "paused": return t("Paused");
  }
}

export function sortLabel({ t }: Translator, key: SortKey): string {
  switch (key) {
    case "spend": return t("Spend");
    case "impressions": return t("Impressions");
    case "ctr": return t("CTR");
    case "installs": return t("Installs");
    case "cpi": return t("CPI");
    case "trials": return t("Trials");
    case "purchases": return t("Purchases");
    case "cac": return t("CAC");
    case "roas": return t("ROAS");
    case "created": return t("Newest");
    case "name": return t("Name");
  }
}

export const stageLabel = ({ t }: Translator, ad: Pick<LaunchedAd, "stage">) => (ad.stage === "TEST" ? t("Testing") : ad.stage === "SCALE" ? t("Scaling") : t("No stage"));

/** Money, counts, percentages, multiples and short dates in the page's locale. */
export function formats({ intl }: Translator, currency: string) {
  const counter = new Intl.NumberFormat(intl, { maximumFractionDigits: 0 });
  const compact = new Intl.NumberFormat(intl, { notation: "compact", maximumFractionDigits: 1 });
  const percent = new Intl.NumberFormat(intl, { style: "percent", maximumFractionDigits: 2 });
  const day = new Intl.DateTimeFormat(intl, { month: "short", day: "numeric", timeZone: "UTC" });
  return {
    money: (n: number | null | undefined) => formatMoney(intl, n, currency),
    count: (n: number | null | undefined) => (n == null ? "–" : counter.format(Math.round(n))),
    compact: (n: number | null | undefined) => (n == null ? "–" : compact.format(n)),
    pct: (n: number | null | undefined) => (n == null ? "–" : percent.format(n)),
    times: (n: number | null | undefined) => (n == null ? "–" : `${new Intl.NumberFormat(intl, { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(n)}×`),
    day: (iso: string) => day.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`)),
  };
}
