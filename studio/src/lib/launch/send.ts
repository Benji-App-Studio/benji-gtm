// The "Send to Meta" sheet's view of the launch function: the shapes its read routes answer with
// (supabase/functions/launch/catalog.ts and sheet.ts) and a small caller. Rules and defaults live in
// rules.ts (a byte-identical copy of the function's), so the sheet checks what the server checks.
import type { AdSetSpec, AdSpec, BudgetMode, CampaignSpec, MetaObjective } from "./rules";
import { formatMoney } from "../i18n/format";

export interface CampaignRow {
  id: string;
  name: string;
  objective: MetaObjective | string;
  status: string;
  effectiveStatus: string;
  budgetMode: BudgetMode;
  dailyBudget: number | null;
  lifetimeBudget: number | null;
  bidStrategy: string | null;
  spendCap: number | null;
  startTime: string | null;
  stopTime: string | null;
  specialAdCategories: string[];
  /** False for legacy objectives the API can't add ads to. */
  supported: boolean;
  url: string;
}

export interface AdSetRow {
  id: string;
  name: string;
  campaignId: string;
  status: string;
  effectiveStatus: string;
  optimizationGoal: string;
  billingEvent: string;
  destinationType: string | null;
  dailyBudget: number | null;
  lifetimeBudget: number | null;
  bidStrategy: string | null;
  bidAmount: number | null;
  startTime: string | null;
  endTime: string | null;
  targeting: string;
  ads: number;
  url: string;
}

export interface Paged<T> { items: T[]; next: string | null; currency: string }

export interface Connections {
  account: { id: string; name: string; currency: string; timezone?: string };
  pages: { id: string; name: string; instagram?: { id: string; username: string } | null }[];
  instagram: { id: string; username: string; source: "account" | "page" }[];
  pixels: { id: string; name: string; lastFired: string | null }[];
  customConversions: { id: string; name: string; event: string | null; pixelId: string | null }[];
  audiences: { id: string; name: string; subtype: string; size: string | null; lookalike: boolean }[];
  errors: Record<string, string>;
}

export interface SearchHit { id: string; name: string; detail?: string; size?: number | null; type?: "country" | "region" | "city"; countryCode?: string }

export interface PlanObject { level: "campaign" | "adset" | "ad"; action: "create" | "use"; name: string; lines: { label: string; value: string }[] }

export interface SendPlan {
  currency: string;
  stage: "TEST" | "SCALE";
  objects: PlanObject[];
  money: { currency: string; daily: number | null; lifetime: number | null; text: string };
  note: string;
  payloads: Record<string, unknown>;
}

export interface SendResult {
  created: { campaign?: { id: string; name: string; url: string }; adSet?: { id: string; name: string; url: string } };
  jobId: string;
  drafts: { id: string; ad_name: string; status: string; adset_id: string; creative_ref: string }[];
  campaign: { id: string; url: string };
  adSet: { id: string; url: string };
  note: string;
}

export interface EditPlan { level: "campaign" | "adset"; id: string; name: string; lines: { label: string; value: string }[]; hints: string[]; url: string }

export interface AdPreviews { adId: string; name: string; previews: { format: string; src: string | null; error?: string }[]; url: string }

/** An error from the launch function, with every reason when it gave several. */
export class MetaCallError extends Error {
  constructor(message: string, readonly errors: string[] = [], readonly extra: Record<string, unknown> = {}) { super(message); }
}

/** Calls one of the sheet's routes through the studio (the browser never holds a Meta token). */
export async function metaCall<T>(productId: string, route: string, body: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch(`/api/launch/${productId}/meta`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, route }),
  });
  const data = await response.json().catch(() => ({}));
  // Without the server's own words, the HTTP status in a sentence the sheet shows translated
  // (ruleText in components/launch/rules-words.ts matches it).
  if (!response.ok) throw new MetaCallError(data.error ?? `The server answered ${response.status}. Try again.`, Array.isArray(data.errors) ? data.errors : [], data);
  return data as T;
}

/** "₹2,000" in the account currency (`locale`: the page's, from the translator's `intl`). */
export function money(n: number | null | undefined, currency = "USD", locale = "en") {
  return formatMoney(locale, n, currency);
}

/** A <input type="datetime-local"> value ↔ ISO. */
export const toLocalInput = (iso: string | null | undefined) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);

/**
 * What the sheet sends to the "send" route: the specs exactly as built (Meta's codes: objective, goal,
 * button, placements), never the words the page shows for them, so the page's language never reaches Meta.
 */
export function sendBody(o: {
  stage: "TEST" | "SCALE"; mode: "new-campaign" | "new-adset" | "existing";
  campaign: CampaignSpec; campaignId?: string | null; adSet: AdSetSpec; adSetId?: string | null; ad: AdSpec; creativeIds: string[]; confirm: boolean;
}) {
  return {
    stage: o.stage,
    campaign: o.mode === "new-campaign" ? { create: o.campaign } : { id: o.campaignId ?? undefined },
    adSet: o.mode === "existing" ? { id: o.adSetId ?? undefined } : { create: o.adSet },
    ad: { ...o.ad, creativeIds: o.creativeIds },
    confirm: o.confirm,
  };
}
