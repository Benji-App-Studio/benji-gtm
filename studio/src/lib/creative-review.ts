// When a creative may be approved, and when a template remake may become the template: one set of rules
// for the review route (studio/src/app/api/studio/creatives/[id]/route.ts), the Studio's review panel
// and the template library. The database enforces QA and the poster frame too; the rest lives here.
// Plain TypeScript, safe in the browser. Messages and badge labels are English, marked with m(): show
// them with t().
import { composedParam } from "./composed-ads";
import { overlayParam } from "./logo-overlay";
import { m } from "./i18n/translate";

interface Reviewed {
  kind: string;
  qa_status: string;
  qa: { needsHuman?: string[] } | null;
  thumbnail_url: string | null;
  copy: Record<string, unknown> | null;
}

/** Work still to do on a creative before anyone can approve it: its text set (composed ads) and our logo placed. */
export function pendingWork(creative: Pick<Reviewed, "kind" | "copy">, jobParams: Record<string, unknown> | null | undefined): string | null {
  if (creative.kind !== "image") return null;
  const copy = creative.copy ?? {};
  if (copy.composeError) return m("The text didn't fit the layout: edit it (Edit text) before approving.");
  if (composedParam(jobParams) && !copy.composed) return m("The text isn't set on this ad yet. Wait for it, or try again.");
  if (overlayParam(jobParams) && !copy.logo && !copy.logoRemoved) return m("Our logo isn't placed on this ad yet. Wait for it, or try again.");
  return null;
}

/** The checks a person must make themselves (QA's needsHuman), when there are any. */
export const needsHuman = (creative: Pick<Reviewed, "qa">) => (creative.qa?.needsHuman ?? []).filter(Boolean);

/**
 * Why `creative` can't be approved with `note` (null when it can), and the HTTP status to answer with:
 * QA must pass, or warn with a note; a video needs its poster frame; composed text and our logo must be in place.
 */
export function approvalProblem(creative: Reviewed, jobParams: Record<string, unknown> | null | undefined, note: string | undefined): { error: string; status: number } | null {
  if (!["pass", "warn"].includes(creative.qa_status)) {
    return { error: creative.qa_status === "fail" ? m("QA failed this creative; fix it and make a new one.") : m("Wait for QA to finish first."), status: 409 };
  }
  const pending = pendingWork(creative, jobParams);
  if (pending) return { error: pending, status: 409 };
  if (creative.kind === "video" && !creative.thumbnail_url) return { error: m("This video has no poster frame, which Launch needs. Make it again."), status: 409 };
  if (creative.qa_status === "warn" && !note) return { error: m("QA raised warnings: add a note saying why it's fine to ship."), status: 400 };
  // QA's "check yourself" items (needsHuman) are shown in the review panel; they don't block approving.
  return null;
}

/**
 * What a template remake's batch made, for the template library. A template isn't an ad: it's a
 * brand-free layout whose example text is replaced when it's used, so only a leak of the original's
 * brand (its names, checked as competitors) keeps a creative from becoming the template. Ad-policy
 * checks (the right app, testimonials, health claims) apply to the ads made from it, not to it.
 * The first usable creative becomes the template; while QA is still on it, wait; when every one leaks
 * the original's brand, the remake failed with that reason.
 */
type RemakeCheck = { id?: string; verdict: string; label: string; reason: string };
const LEAK_CHECKS = ["competitor_names", "competitor"];
const leak = (c: { qa: { checks?: RemakeCheck[] } | null }) => c.qa?.checks?.find((x) => x.verdict === "fail" && (!x.id || LEAK_CHECKS.includes(x.id)));
export function remakeOutcome(made: { id: string; qa_status: string; qa: { checks?: RemakeCheck[] } | null }[]):
  { use: string } | { wait: true } | { failed: string } | null {
  if (!made.length) return null;
  const usable = made.find((c) => ["pass", "warn", "error"].includes(c.qa_status) || (c.qa_status === "fail" && c.qa?.checks?.length && !leak(c)));
  if (usable) return { use: usable.id };
  if (made.some((c) => c.qa_status === "pending" || c.qa_status === "running")) return { wait: true };
  const failed = leak(made[0]) ?? made[0].qa?.checks?.find((c) => c.verdict === "fail");
  return { failed: `QA failed the remake${failed ? ` (${failed.label}: ${failed.reason})` : ""}. Try again or pick another template.`.slice(0, 400) };
}

/** How a QA verdict reads on a badge (the Studio's gallery and review panel, the Playground's results). */
export const QA_BADGE: Record<string, { label: string; tone: "neutral" | "accent" | "win" | "warn" | "highlight" }> = {
  pending: { label: m("QA queued"), tone: "neutral" }, running: { label: m("Checking"), tone: "accent" }, pass: { label: m("QA passed"), tone: "win" },
  warn: { label: m("QA warnings"), tone: "highlight" }, fail: { label: m("QA failed"), tone: "warn" }, error: { label: m("QA error"), tone: "warn" },
};
