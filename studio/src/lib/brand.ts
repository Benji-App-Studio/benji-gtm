// One brand source. A product's brand lives in two columns: products.brand_kit (the basics: name,
// tagline, icon, App Store link, screenshots, plus the colours, tone and forbidden claims older readers
// use) and products.brand_system (look, voice, avatars, offers, palette, fonts, products). The Brand
// page edits both as one thing, and this file is the rules that keep them in step:
// - colours: the palette is the one list; the kit's colours are its hexes, primary and accent first;
// - tone: voice.oneLine (+ rules) is the one tone; the kit's tone is written from it;
// - forbidden claims: voice.forbiddenClaims is the one list; the kit's copy is the same list.
// The AI product profile (products.insight) only suggests (brandSuggestions / applySuggestion), and
// every generator reads the merged brand (mergeBrand; lib/server/brand.ts brandFor), where forbidden
// claims are the kit's, the voice's and the profile's claims_to_avoid together.
// Pure TypeScript: the browser, the server and the Node tests share it.
import { m } from "./i18n/translate";
import { cleanBrandSystem, EMPTY_BRAND_SYSTEM, hasBrandSystem, BRAND_SYSTEM_LIMITS, type BrandColor, type BrandSystem, type ColorRole } from "./brand-system";
import { profileOf, type ProductInsight, type ProductProfile } from "./product-insight";
import { BRAND_LIMITS, cleanBrandKit, hexColor, readBrandKit, type BrandKit } from "./workspace-schema";

/** The brand kit fields the Brand page's Basics section edits. */
export interface BrandBasics { appName: string; tagline: string; iconUrl: string; appStoreUrl: string; screenshotUrls: string[] }
export const BASICS_KEYS = ["appName", "tagline", "iconUrl", "appStoreUrl", "screenshotUrls"] as const;

/** What the Brand page edits and saves: the basics and the whole system. */
export interface BrandDraft { basics: BrandBasics; system: BrandSystem }

/** What the Brand page loads, and gets back after a save (GET/PUT /api/products/[id]/brand). */
export interface BrandOverview { name: string; appName: string; stored: boolean; draft: BrandDraft; suggestions: BrandSuggestion[]; hasProfile: boolean }

/** The stored columns these rules read. */
export interface BrandColumns { name: string; brand_kit: unknown; brand_system: unknown; insight?: ProductInsight | null }

const norm = (v: string) => v.trim().toLowerCase();

/** Lists joined in order, without blanks or repeats (case-insensitive), at most `max`. */
export function unionList(lists: (string[] | null | undefined)[], max: number = BRAND_LIMITS.claims): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of lists.flat()) {
    const text = (item ?? "").trim();
    if (!text || seen.has(norm(text))) continue;
    seen.add(norm(text));
    out.push(text);
  }
  return out.slice(0, max);
}

// MARK: Colours

const KIT_ORDER: ColorRole[] = ["primary", "accent", "secondary", "background", "neutral"];

/** The kit's colours from the palette: hexes, primary first, then accent, then the rest (palette order within a role). */
export function kitColors(palette: BrandColor[]): string[] {
  const ranked = palette.map((c, i) => ({ c, i })).sort((a, b) => KIT_ORDER.indexOf(a.c.role) - KIT_ORDER.indexOf(b.c.role) || a.i - b.i);
  return unionList([ranked.map(({ c }) => hexColor(c.hex) ?? "")], BRAND_LIMITS.colors);
}

/** Palette entries for kit colours the palette doesn't have yet: the first becomes primary when there's none. */
export function paletteWith(palette: BrandColor[], colors: string[]): BrandColor[] {
  const have = new Set(palette.map((c) => (hexColor(c.hex) ?? c.hex).toUpperCase()));
  const out = [...palette];
  for (const raw of colors) {
    const hex = hexColor(raw);
    if (!hex || have.has(hex) || out.length >= BRAND_SYSTEM_LIMITS.palette) continue;
    have.add(hex);
    out.push({ name: "", hex, role: out.some((c) => c.role === "primary") ? "accent" : "primary", use: "" });
  }
  return out;
}

// MARK: Tone

/** The kit's tone from the voice: the one line, then each rule on its own "- " line. */
export function toneFromVoice(voice: Pick<BrandSystem["voice"], "oneLine" | "rules">): string {
  return [voice.oneLine.trim(), ...voice.rules.map((r) => r.trim()).filter(Boolean).map((r) => `- ${r}`)].filter(Boolean).join("\n");
}

/**
 * A kit tone back into a one line and rules: "- " lines are rules; the rest is the one line. A long
 * legacy tone keeps its first sentence as the one line and the other sentences become rules.
 */
export function voiceFromTone(tone: string): { oneLine: string; rules: string[] } {
  const lines = tone.replace(/\r/g, "").split("\n").map((l) => l.trim()).filter(Boolean);
  const rules = lines.filter((l) => /^[-*•]\s+/.test(l)).map((l) => l.replace(/^[-*•]\s+/, ""));
  let oneLine = lines.filter((l) => !/^[-*•]\s+/.test(l)).join(" ");
  if (oneLine.length > 400) {
    const sentences = oneLine.match(/[^.!?]+[.!?]*/g)?.map((x) => x.trim()).filter(Boolean) ?? [oneLine];
    oneLine = sentences[0].slice(0, 400);
    rules.unshift(...sentences.slice(1).map((x) => x.slice(0, 400)));
  }
  return { oneLine, rules: rules.slice(0, 12) };
}

// MARK: The Brand page's state

/**
 * What the Brand page shows for the stored columns: the basics from the kit, and the system with the
 * kit's older lists folded in (kit colours missing from the palette, the kit's tone when the voice is
 * empty, the kit's forbidden claims). Saving it writes both columns in step (prepareBrandSave).
 */
export function brandDraft(row: BrandColumns): BrandDraft {
  const kit = readBrandKit(row.brand_kit, row.name);
  const stored = row.brand_system ? cleanBrandSystem(row.brand_system) : structuredClone(EMPTY_BRAND_SYSTEM);
  const voice = { ...stored.voice };
  if (!voice.oneLine && !voice.rules.length && kit.tone) Object.assign(voice, voiceFromTone(kit.tone));
  voice.forbiddenClaims = unionList([voice.forbiddenClaims, kit.forbiddenClaims]);
  return {
    basics: { appName: kit.appName, tagline: kit.tagline ?? "", iconUrl: kit.iconUrl ?? "", appStoreUrl: kit.appStoreUrl ?? "", screenshotUrls: kit.screenshotUrls },
    system: { ...stored, voice, palette: paletteWith(stored.palette, kit.colors) },
  };
}

/** The new brand_kit JSON: the stored one, the basics, and the colours, tone and claims from the system. */
export function syncKit(rawKit: unknown, basics: Partial<Record<keyof BrandKit, unknown>>, system: BrandSystem): Record<string, unknown> {
  const raw = (rawKit && typeof rawKit === "object" ? rawKit : {}) as Record<string, unknown>;
  const colors = kitColors(system.palette);
  const tone = toneFromVoice(system.voice).slice(0, 4000);
  const claims = system.voice.forbiddenClaims;
  // JSON drops the keys that were cleared (undefined).
  return JSON.parse(JSON.stringify({ ...raw, ...basics, colors, tone: tone || undefined, forbiddenClaims: claims.length ? claims : undefined }));
}

/**
 * What saving the Brand page writes: both columns, or an error to show. `basics` changes only the keys
 * it names (cleaned like the old Settings form); `system` replaces the whole system (when it's left
 * out, the current one is kept and the kit is re-synced from it).
 */
export function prepareBrandSave(row: BrandColumns, input: { basics?: Partial<BrandBasics> | null; system?: unknown }, now = new Date()): { brand_kit: Record<string, unknown>; brand_system: BrandSystem } | { error: string } {
  const given = (input.basics && typeof input.basics === "object" ? input.basics : {}) as Record<string, unknown>;
  const basics = cleanBrandKit(Object.fromEntries(BASICS_KEYS.filter((k) => k in given).map((k) => [k, given[k]])));
  if (typeof basics === "string") return { error: basics };
  const raw = input.system !== undefined && input.system !== null ? (input.system as Record<string, unknown>) : null;
  const rawClaims = raw ? (raw.voice as Record<string, unknown> | undefined)?.forbiddenClaims : undefined;
  if (Array.isArray(rawClaims) && rawClaims.filter((c) => typeof c === "string" && c.trim()).length > BRAND_SYSTEM_LIMITS.claims) {
    return { error: `Keep forbidden claims to ${BRAND_SYSTEM_LIMITS.claims} lines.` };
  }
  const system = raw ? cleanBrandSystem(raw) : brandDraft(row).system;
  const saved: BrandSystem = { ...system, updatedAt: now.toISOString() };
  return { brand_kit: syncKit(row.brand_kit, basics, saved), brand_system: saved };
}

// MARK: The merged brand every generator reads

export interface MergedBrand {
  /** The kit as every reader expects it, with the merged colours, tone and forbidden claims. */
  kit: BrandKit;
  /** The brand system, when it has anything worth using (hasBrandSystem); null otherwise. */
  system: BrandSystem | null;
  /** The prompt-ready AI profile, when there is one. */
  profile: ProductProfile | null;
  /** The kit's claims ∪ the voice's ∪ the AI profile's claims_to_avoid. */
  forbiddenClaims: string[];
}

/**
 * The one brand reader: the kit's basics, the system (with the kit's older lists folded in, as the
 * Brand page shows it) and the profile. Generators use `kit` where they used the brand kit, so colours,
 * tone and forbidden claims come out the same everywhere.
 */
export function mergeBrand(row: BrandColumns): MergedBrand {
  const draft = brandDraft(row);
  const stored = row.brand_system ? cleanBrandSystem(row.brand_system) : null;
  const forbiddenClaims = unionList([draft.system.voice.forbiddenClaims, row.insight?.claims_to_avoid ?? []]);
  const kit = readBrandKit({ ...syncKit(row.brand_kit, {}, draft.system), forbiddenClaims }, row.name);
  return { kit, system: hasBrandSystem(stored) ? draft.system : null, profile: profileOf(row.insight), forbiddenClaims };
}

// MARK: Suggestions from the AI profile

export type SuggestionKey = "tagline" | "colors" | "tone" | "claims" | "appStoreUrl" | "icon" | "screenshots";

export type BrandSuggestion =
  | { key: "tagline" | "tone" | "appStoreUrl" | "icon"; label: string; value: string }
  | { key: "screenshots" | "claims"; label: string; value: string[] }
  | { key: "colors"; label: string; value: BrandColor[] };

const ROLE_WORDS: [RegExp, ColorRole][] = [[/primary|main|brand/i, "primary"], [/secondary/i, "secondary"], [/background|surface|canvas/i, "background"], [/neutral|text|ink|grey|gray/i, "neutral"], [/accent|highlight|cta/i, "accent"]];
const roleOf = (role: string): ColorRole => ROLE_WORDS.find(([re]) => re.test(role))?.[1] ?? "accent";
const isHttps = (v: string) => /^https:\/\/\S+$/i.test(v);
const isStoreLink = (v: string) => { try { return /(^|\.)apple\.com$|(^|\.)play\.google\.com$/.test(new URL(v).hostname); } catch { return false; } };

/** A suggestion applied to a draft: lists gain the suggested items, single fields take the value. */
export function applySuggestion(draft: BrandDraft, s: BrandSuggestion): BrandDraft {
  const next: BrandDraft = { basics: { ...draft.basics }, system: { ...draft.system, voice: { ...draft.system.voice } } };
  switch (s.key) {
    case "tagline": next.basics.tagline = s.value; break;
    case "appStoreUrl": next.basics.appStoreUrl = s.value; break;
    case "icon": next.basics.iconUrl = s.value; break;
    case "screenshots": next.basics.screenshotUrls = unionList([draft.basics.screenshotUrls, s.value], BRAND_LIMITS.screenshots); break;
    case "tone": next.system.voice.oneLine = s.value; break;
    case "claims": next.system.voice.forbiddenClaims = unionList([draft.system.voice.forbiddenClaims, s.value]); break;
    case "colors": {
      const have = new Set(draft.system.palette.map((c) => c.hex.toUpperCase()));
      const add = s.value.filter((c) => !have.has(c.hex.toUpperCase()));
      const hasPrimary = draft.system.palette.some((c) => c.role === "primary");
      next.system.palette = [...draft.system.palette, ...add.map((c, i) => ({ ...c, role: !hasPrimary && i === 0 && !add.some((x) => x.role === "primary") ? "primary" as const : c.role }))].slice(0, BRAND_SYSTEM_LIMITS.palette);
      break;
    }
  }
  return next;
}

/**
 * What the AI profile suggests for this brand, each only when using it would change something: the
 * tagline, colours (added to the palette), tone (the voice's one line), claims to avoid (added to the
 * forbidden claims), the App Store link, and the store's icon and screenshots when there are none.
 */
export function brandSuggestions(insight: ProductInsight | null | undefined, draft: BrandDraft): BrandSuggestion[] {
  if (!insight) return [];
  const brand = insight.brand ?? { colors: [], tone: "", voice: [] };
  const candidates: BrandSuggestion[] = [];
  if (insight.tagline?.trim()) candidates.push({ key: "tagline", label: m("Tagline"), value: insight.tagline.trim().slice(0, 160) });
  const colors = (brand.colors ?? []).map((c) => ({ hex: hexColor(c.hex) ?? "", name: (c.name ?? "").trim().slice(0, 60), role: roleOf(c.role ?? ""), use: "" })).filter((c) => c.hex);
  const have = new Set(draft.system.palette.map((c) => c.hex.toUpperCase()));
  const newColors = colors.filter((c) => !have.has(c.hex));
  if (newColors.length) candidates.push({ key: "colors", label: m("Brand colours"), value: newColors });
  const tone = [brand.tone?.trim(), brand.voice?.length ? `(${brand.voice.join(", ")})` : ""].filter(Boolean).join(" ").slice(0, 400);
  if (tone) candidates.push({ key: "tone", label: m("Tone of voice"), value: tone });
  const claims = (insight.claims_to_avoid ?? []).filter((c) => !draft.system.voice.forbiddenClaims.some((x) => norm(x) === norm(c)));
  if (claims.length) candidates.push({ key: "claims", label: m("Claims to avoid"), value: unionList([claims]) });
  const store = insight.appStore;
  if (store?.url && isStoreLink(store.url)) candidates.push({ key: "appStoreUrl", label: m("App Store link"), value: store.url });
  if (!draft.basics.iconUrl && store?.iconUrl && isHttps(store.iconUrl)) candidates.push({ key: "icon", label: m("App icon (from the store)"), value: store.iconUrl });
  if (!draft.basics.screenshotUrls.length && store?.screenshots?.length) {
    const shots = store.screenshots.filter(isHttps).slice(0, 8);
    if (shots.length) candidates.push({ key: "screenshots", label: m("Screenshots (from the store)"), value: shots });
  }
  return candidates.filter((s) => JSON.stringify(applySuggestion(draft, s)) !== JSON.stringify(draft));
}
