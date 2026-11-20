// An app's getting-started guide, as rules: the four steps from nothing to a first result (get a
// competitor's ads in, make one of them for your app, send it to Meta paused, see what it brought in),
// each judged from real data, and where each step takes you and which button to press there. The
// profile, brand and competitor list are worth filling in but never block a step: the brand is filled
// from the app's link where it can be (app/api/onboarding). Plain TypeScript with no strings to
// translate (components/getting-started.tsx words every step), safe in the browser; checked in
// workspace-setup.test.ts.
import { featureState, type Feature, type FeatureState } from "./capabilities";
import type { InstallState } from "./install/types";
import { appHref, appSettingsHref, researchHref } from "./nav-model";
import { brandBasicsGaps, type BrandKit, type WorkspaceConnections, type WorkspaceCounts } from "./workspace-schema";

export type GuideKey = "ads" | "make" | "launch" | "results";

export interface GuideStep {
  key: GuideKey;
  /** null while what it is judged from is still loading. */
  done: boolean | null;
  /** The page that does this step, with ?guide=<key> so that page points at the button to press. */
  href: string;
  /** What the page still needs before this step works (a key or a connection), when it does; null when it's ready or unknown. */
  locked: FeatureState | null;
}

/** What each step's page needs before its button works. Getting ads in needs nothing (the free extension). */
const STEP_NEEDS: Record<GuideKey, Feature | null> = { ads: null, make: "studio.images", launch: "launch", results: "measure.meta" };

/**
 * The query a guide link carries. `?guide=<step>` on a step's page points at the button to press there (the
 * button carries `data-guide="<step>"`; a page's "connect" button carries `data-guide="connect"`). A bare
 * `?guide` on an app's Home (lib/nav-model.ts guideHref: Help > Get started, the command menu) reopens
 * the guide and points at its next step.
 */
export const GUIDE_PARAM = "guide";
export const guideStepHref = (id: string, key: GuideKey): string => {
  const page = key === "ads" || key === "make" ? researchHref(id) : key === "launch" ? appHref(id, "launch") : appHref(id, "measure");
  return `${page}?${GUIDE_PARAM}=${key}`;
};

/** What a `guide` query asks for: "reopen" (bare ?guide), one step, or nothing. */
export function guideAsk(value: string | null | undefined): "reopen" | GuideKey | null {
  if (value === "" || value === "open" || value === "1") return "reopen";
  return isGuideKey(value) ? value : null;
}
export const isGuideKey = (value: unknown): value is GuideKey => value === "ads" || value === "make" || value === "launch" || value === "results";

type App = { id: string; connections?: WorkspaceConnections | null };

/**
 * The four steps, in order. `counts` undefined: still loading (every step null); null: they couldn't
 * be counted (nothing is done). A launched ad is a draft that reached Meta (it has an ad id); a result is
 * a day of data from a revenue or analytics source, or spend on a launched ad (a source that synced
 * nothing doesn't count). Measure counts as unlocked when any source can report, not only Meta.
 */
export function guideSteps(id: string, counts: WorkspaceCounts | null | undefined, install?: InstallState | null, app?: App | null): GuideStep[] {
  const has = (n: number | null | undefined) => (counts === undefined ? null : (n ?? 0) > 0);
  const launched = counts?.launchedAds ?? counts?.metaAds;
  const done: Record<GuideKey, boolean | null> = {
    ads: has(counts?.paidAds),
    make: has(counts?.creatives),
    launch: has(launched),
    results: has(counts?.resultRows),
  };
  const locked = (key: GuideKey): FeatureState | null => {
    const need = STEP_NEEDS[key];
    if (!need || done[key]) return null;
    // Results: any one source is enough (RevenueCat, Superwall, Mixpanel, AppStack or Meta spend).
    if (key === "results" && anyMeasureSource(install, app)) return null;
    const state = featureState(need, install, app);
    return state.ok ? null : state;
  };
  return (["ads", "make", "launch", "results"] as const).map((key) => ({ key, done: done[key], href: guideStepHref(id, key), locked: locked(key) }));
}

const MEASURE_SOURCES: Feature[] = ["measure.meta", "measure.revenuecat", "measure.superwall", "measure.mixpanel", "measure.appstack"];

/** Whether any measure source has its key and this app's connection. Unknown install: true (nothing is locked). */
export function anyMeasureSource(install: InstallState | null | undefined, app?: App | null): boolean {
  if (!install) return true;
  return MEASURE_SOURCES.some((feature) => featureState(feature, install, app).ok);
}

export interface GuideStatus {
  done: number;
  total: number;
  /** The first step not done, or null when every step is (or while loading). */
  current: GuideStep | null;
  complete: boolean;
  loading: boolean;
}

export function guideStatus(steps: GuideStep[]): GuideStatus {
  const loading = steps.some((s) => s.done === null);
  const done = steps.filter((s) => s.done).length;
  const current = loading ? null : steps.find((s) => !s.done) ?? null;
  return { done, total: steps.length, current, complete: !loading && done === steps.length, loading };
}

// MARK: The app's profile (worth filling in, never blocking)

export interface ProfileItem {
  key: "profile" | "brand" | "competitors";
  done: boolean | null;
  href: string;
  /** Brand: how many of logo, colours and voice are set (of 3). Competitors: how many are on the list. */
  count?: number;
}

type Product = { description?: string | null };

/** The profile, the brand basics and the competitor list: shown on Home as "make it yours", none of them a step. */
export function profileItems(id: string, kit: BrandKit, product: Product | undefined, watchlist: number | undefined): ProfileItem[] {
  const gaps = brandBasicsGaps(kit).length;
  return [
    { key: "profile", href: appSettingsHref(id, "profile"), done: product ? Boolean(product.description?.trim()) : null },
    { key: "brand", href: appSettingsHref(id, "brand"), done: gaps === 0, count: 3 - gaps },
    { key: "competitors", href: `${researchHref(id)}?competitors`, done: watchlist === undefined ? null : watchlist > 0, count: watchlist },
  ];
}
