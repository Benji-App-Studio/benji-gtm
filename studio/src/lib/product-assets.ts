// Product images (`product_assets`): what a product is and sells, as pictures for creatives. Uploaded on
// the Product page or collected by the AI reader from the website and store listing; the AI sorts them
// (kind, label, group, what each suits). Recreate and Studio suggest them as Higgsfield references, but
// only the user's picks are ever used. Safe in the browser.
import { fill, m, type Vars } from "./i18n/translate";

export type AssetKind = "app_screen" | "product" | "packaging" | "lifestyle" | "person" | "logo" | "other";

/** Whether a pictured person agreed to appear in ads (product_assets.consent). */
export type AssetConsent = "confirmed" | "unknown" | "not_given";
export const CONSENT_OPTIONS: { id: AssetConsent; label: string; hint: string }[] = [
  { id: "confirmed", label: m("Consent confirmed"), hint: m("They agreed to appear in our ads.") },
  { id: "unknown", label: m("Consent unknown"), hint: m("Nobody has asked yet.") },
  { id: "not_given", label: m("No consent"), hint: m("They didn't agree: don't use them.") },
];

export interface ProductAsset {
  id: string;
  product_id: string;
  url: string;
  storage_path: string | null;
  source: "upload" | "website" | "app_store" | "google_play";
  source_url: string | null;
  kind: AssetKind;
  label: string | null;
  description: string | null;
  group_name: string | null;
  good_for: string[];
  width: number | null;
  height: number | null;
  sorted_at: string | null;
  kind_locked: boolean;
  hidden: boolean;
  /** People: did they agree to appear in ads? Anything but "confirmed" needs a person to check. */
  consent: AssetConsent;
  /** People: they may be under 18. */
  possible_minor: boolean;
  /**
   * Product and packaging images: the transparent PNG cut-out ("Make cut-out", Higgsfield's background
   * remover on the desktop runner), stored in the `creatives` bucket at `cutout_path`.
   */
  cutout_url: string | null;
  cutout_path: string | null;
  created_at: string;
}

export const ASSET_COLUMNS = "id, product_id, url, storage_path, source, source_url, kind, label, description, group_name, good_for, width, height, sorted_at, kind_locked, hidden, consent, possible_minor, cutout_url, cutout_path, created_at";

/**
 * The people among some images whose use needs a person's OK: consent not confirmed, or possibly a
 * minor. Each with why, for the warning at batch create (and QA's people check).
 */
export function peopleToCheck(assets: Pick<ProductAsset, "id" | "kind" | "label" | "consent" | "possible_minor">[]): { id: string; label: string; reasons: string[] }[] {
  return assets.filter((a) => a.kind === "person").map((a) => {
    const reasons = [
      ...(a.consent === "not_given" ? [m("no consent")] : (a.consent ?? "unknown") !== "confirmed" ? [m("consent unknown")] : []),
      ...(a.possible_minor ? [m("may be a minor")] : []),
    ];
    return { id: a.id, label: a.label?.trim() || "A person", reasons };
  }).filter((p) => p.reasons.length);
}

/** One line for a batch that uses them, or "" when everyone is cleared. */
export function peopleWarning(assets: Pick<ProductAsset, "id" | "kind" | "label" | "consent" | "possible_minor">[]): string {
  const people = peopleToCheck(assets);
  if (!people.length) return "";
  const list = people.slice(0, 3).map((p) => `${p.label} (${p.reasons.join(", ")})`).join("; ");
  return `${people.length === 1 ? "A person in your references isn't" : `${people.length} people in your references aren't`} cleared for ads: ${list}${people.length > 3 ? "; …" : ""}. QA will ask a person to check before approval.`;
}


// MARK: Cut-outs

/** The kinds a cut-out can be made of: the product itself and its packaging. */
export const CUTOUT_KINDS: AssetKind[] = ["product", "packaging"];
export const canCutOut = (a: Pick<ProductAsset, "kind">) => CUTOUT_KINDS.includes(a.kind);
/** Higgsfield's background remover: a runner job (the public API doesn't offer it; checked 2026-10-09). */
export const CUTOUT_MODEL = "image_background_remover";
/**
 * Its price in credits, the estimate the runner checks the live price against (it refuses above
 * priceLimit: 1.5× or 2 credits more). Not yet confirmed with `higgsfield generate cost`.
 */
export const CUTOUT_CREDITS = 1;

/** A cut-out job's params: which asset, and its image (the one reference the remover takes). */
export interface CutoutParams { cutout: { asset_id: string }; image_refs: [string] }
export function cutoutParams(asset: Pick<ProductAsset, "id" | "url">): CutoutParams {
  return { cutout: { asset_id: asset.id }, image_refs: [asset.url] };
}
/** The asset a job cuts out, or null when it isn't a cut-out job. */
export function cutoutAssetId(job: { model: string; params: Record<string, unknown> | null }): string | null {
  const c = job.params?.cutout as Record<string, unknown> | undefined;
  return job.model === CUTOUT_MODEL && c && typeof c.asset_id === "string" && /^[0-9a-f-]{36}$/i.test(c.asset_id) ? c.asset_id : null;
}

/** Product images with a cut-out, for "Use the real product" (visible ones, newest first as given). */
export function cutoutChoices(assets: Pick<ProductAsset, "id" | "kind" | "label" | "hidden" | "cutout_url">[]): { id: string; url: string; label: string }[] {
  return assets.filter((a) => canCutOut(a) && !a.hidden && typeof a.cutout_url === "string" && /^https:\/\//i.test(a.cutout_url))
    .map((a) => ({ id: a.id, url: a.cutout_url!, label: a.label?.trim() || ASSET_KIND_LABEL[a.kind] }));
}

export const ASSET_KINDS: { id: AssetKind; label: string; plural: string }[] = [
  { id: "app_screen", label: m("App screen"), plural: m("App screens") },
  { id: "product", label: m("Product"), plural: m("Products") },
  { id: "packaging", label: m("Packaging"), plural: m("Packaging") },
  { id: "lifestyle", label: m("Lifestyle"), plural: m("Lifestyle") },
  { id: "person", label: m("People"), plural: m("People") },
  { id: "logo", label: m("Logo"), plural: m("Logos") },
  { id: "other", label: m("Other"), plural: m("Other") },
];
export const ASSET_KIND_LABEL = Object.fromEntries(ASSET_KINDS.map((k) => [k.id, k.label])) as Record<AssetKind, string>;
export const ASSET_SOURCE_LABEL: Record<ProductAsset["source"], string> = { upload: m("Uploaded"), website: m("From the website"), app_store: m("From the App Store"), google_play: m("From Google Play") };

/** At most this many of our images go to Higgsfield with one creative (after the competitor's). */
export const PRODUCT_REFERENCES = 3;

/** What a competitor's ad promotes, from the AI scan's fit check (or guessed from the ad's type). */
export type AdSells = "specific_drug" | "product" | "service" | "app" | "education" | "other";

export interface AdFit {
  ad_sells: AdSells;
  subject: string;
  level: "fits" | "partly" | "doesnt_fit";
  reason: string;
  adaptation: string;
  suggested_asset_ids: string[];
}

/** Display words (translate with t() where shown); the AI scan's data keeps the level and the `ad_sells` code. */
export const FIT_LABEL: Record<AdFit["level"], string> = { fits: m("Fits your offer"), partly: m("Partly fits"), doesnt_fit: m("Doesn't fit your offer") };
export const SELLS_LABEL: Record<AdSells, string> = {
  specific_drug: m("a named medicine"), product: m("a product"), service: m("a service or membership"), app: m("an app"), education: m("information or tips"), other: m("something else"),
};

/** Which of our image kinds answer what their ad shows, best first. */
const KINDS_FOR: Record<AdSells, AssetKind[]> = {
  specific_drug: ["product", "packaging", "app_screen", "lifestyle"],
  product: ["product", "packaging", "lifestyle"],
  service: ["app_screen", "lifestyle", "person"],
  app: ["app_screen", "lifestyle"],
  education: ["lifestyle", "app_screen", "person"],
  other: ["product", "app_screen", "lifestyle"],
};

/**
 * Our images ordered for one ad: the AI scan's picks first (when it ran), then the kinds that answer
 * what the ad shows, the rest after. Suggestions only: nothing is picked for the user.
 */
export function suggestAssets(
  assets: ProductAsset[], o: { fit?: AdFit | null; sells?: AdSells; video?: boolean }, t: (text: string, vars?: Vars) => string = fill,
): { asset: ProductAsset; suggested: boolean; why: string | null }[] {
  const visible = assets.filter((a) => !a.hidden);
  const picked = new Set(o.fit?.suggested_asset_ids ?? []);
  const kinds = KINDS_FOR[o.fit?.ad_sells ?? o.sells ?? "other"];
  const rank = (a: ProductAsset) => (picked.has(a.id) ? -100 : 0) + (kinds.includes(a.kind) ? kinds.indexOf(a.kind) : 50) + (a.kind === "logo" ? 80 : 0);
  return [...visible].sort((a, b) => rank(a) - rank(b)).map((asset) => {
    const byAi = picked.has(asset.id);
    const byKind = !o.fit && kinds.slice(0, 2).includes(asset.kind);
    return {
      asset,
      suggested: byAi || byKind,
      why: byAi ? t("Suggested by the AI scan for this ad") : byKind ? t("{kind}: matches what this ad shows", { kind: t(ASSET_KIND_LABEL[asset.kind]) }) : null,
    };
  });
}

/** Images grouped for display: by kind, then the AI's group, newest first inside. */
export function groupAssets(assets: ProductAsset[]): { kind: AssetKind; label: string; groups: { name: string | null; assets: ProductAsset[] }[] }[] {
  return ASSET_KINDS.map((k) => {
    const ofKind = assets.filter((a) => a.kind === k.id);
    const names = [...new Set(ofKind.map((a) => a.group_name ?? null))].sort((a, b) => (a === null ? 1 : b === null ? -1 : a.localeCompare(b)));
    return { kind: k.id, label: k.plural, groups: names.map((name) => ({ name, assets: ofKind.filter((a) => (a.group_name ?? null) === name) })) };
  }).filter((k) => k.groups.some((g) => g.assets.length));
}
