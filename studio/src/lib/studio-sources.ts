// Which batches the Studio shows, and where each creative came from. Plain TypeScript, safe in the browser
// (and in node tests: relative imports only).
// - Studio batches (no settings.source): everywhere in the Studio.
// - Playground batches (source "playground"): their jobs stay on the Playground (it shows them live), but
//   their results join the Studio's review gallery, with a "Remix" badge, so they go through QA and
//   approval like any other creative and can launch.
// - Template remakes (source "playground-template"): library templates, not ads; never in the Studio.
import { PLAYGROUND_SOURCE } from "./playground";
import { TEMPLATE_SOURCE } from "./playground-templates";

export type CreativeOrigin = "studio" | "playground";
export type OriginFilter = CreativeOrigin | "all";

/** Batch sources whose jobs (and batches) stay out of the Studio's job list. */
export const STUDIO_HIDDEN_JOB_SOURCES = [PLAYGROUND_SOURCE, TEMPLATE_SOURCE] as const;
/** Batch sources whose creatives stay out of the Studio's review gallery. */
export const STUDIO_HIDDEN_CREATIVE_SOURCES = [TEMPLATE_SOURCE] as const;

const sourceOf = (settings: unknown): string | null => {
  const source = (settings as { source?: unknown } | null | undefined)?.source;
  return typeof source === "string" && source ? source : null;
};

/** Whether a batch's jobs show in the Studio's job list. */
export const studioShowsJobs = (settings: unknown) => !(STUDIO_HIDDEN_JOB_SOURCES as readonly string[]).includes(sourceOf(settings) ?? "");
/** Whether a batch's creatives show in the Studio's review gallery. */
export const studioShowsCreatives = (settings: unknown) => !(STUDIO_HIDDEN_CREATIVE_SOURCES as readonly string[]).includes(sourceOf(settings) ?? "");

/** The batch ids the Studio sorts rows by: hidden entirely (template remakes) and Playground (results only). */
export function batchSourceIds(batches: { id: string; source: string | null }[]): { hidden: string[]; playground: string[] } {
  const hidden: string[] = [];
  const playground: string[] = [];
  for (const b of batches) {
    if (b.source === PLAYGROUND_SOURCE) playground.push(b.id);
    else if (b.source && !studioShowsCreatives({ source: b.source })) hidden.push(b.id);
  }
  return { hidden, playground };
}

/** Rows arriving live: which the Studio keeps. Jobs of Playground and hidden batches go; Playground creatives stay. */
export function studioRows<J extends { batch_id: string | null }, C extends { batch_id: string | null }>(
  jobs: J[], creatives: C[], ids: { hidden: ReadonlySet<string>; playground: ReadonlySet<string> },
): { jobs: J[]; creatives: C[] } {
  return {
    jobs: jobs.filter((j) => !j.batch_id || (!ids.hidden.has(j.batch_id) && !ids.playground.has(j.batch_id))),
    creatives: creatives.filter((c) => !c.batch_id || !ids.hidden.has(c.batch_id)),
  };
}

/** Where a creative came from, by its batch. */
export const originOf = (creative: { batch_id: string | null }, playground: ReadonlySet<string>): CreativeOrigin =>
  creative.batch_id && playground.has(creative.batch_id) ? "playground" : "studio";

/** The creatives a source chip keeps. */
export const byOrigin = <C extends { batch_id: string | null }>(creatives: C[], filter: OriginFilter, playground: ReadonlySet<string>): C[] =>
  filter === "all" ? creatives : creatives.filter((c) => originOf(c, playground) === filter);

/** The Studio with one creative's review panel open (the Playground's "Review in Studio"). */
export const reviewHref = (productId: string, creativeId: string) => `/app/w/${productId}/studio?review=${encodeURIComponent(creativeId)}`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The creative a Studio link asks to review (`?review=<id>`), when it's a well-formed id. */
export function reviewParam(search: string | URLSearchParams | null | undefined): string | null {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  const id = params?.get("review")?.trim() ?? "";
  return UUID.test(id) ? id.toLowerCase() : null;
}
