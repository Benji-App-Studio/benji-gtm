// The AI scan's fit check, as the Research pages show it: advice on whether our product can make the
// same promise as a competitor's ad. It never blocks anything; the user decides.
import type { AdFit, AdSells } from "@/lib/product-assets";
import type { RankedAdRow } from "@/lib/research";
import { m } from "@/lib/i18n/translate";
import { cx } from "../ui";

/** Short labels for the ad cards and the filter. */
export const FIT_SHORT: Record<AdFit["level"], string> = { fits: m("Fits"), partly: m("Partly"), doesnt_fit: m("Doesn't fit") };

const DOT: Record<AdFit["level"], string> = { fits: "bg-win", partly: "bg-caution", doesnt_fit: "bg-caution-ink/70" };

export function FitDot({ level, className }: { level: AdFit["level"]; className?: string }) {
  return <span className={cx("size-1.5 shrink-0 rounded-full", DOT[level], className)} aria-hidden />;
}

/** Decoded formats that teach rather than sell a thing. */
const TEACHING = new Set(["explainer", "how_to_steps", "listicle", "myth_vs_reality", "expert_answers", "news_update", "hack_or_secret"]);

/**
 * What an ad without a fit check probably sells, for ordering our images: a text-only or teaching ad
 * shows information; anything else is left open ("other": products and app screens first).
 */
export function guessSells(ad: Pick<RankedAdRow, "media_type" | "decoded">): AdSells {
  if (ad.media_type === "text" || (ad.decoded && TEACHING.has(ad.decoded.format))) return "education";
  return "other";
}
