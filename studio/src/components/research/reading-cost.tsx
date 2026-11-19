"use client";
// What reading the ads costs after a collection or an import. New ads are read for their format and hook
// automatically (the research function's decode-new) whenever the AI's key is set; that runs on OpenAI
// (or TypeSafe, when Settings choose it) and is billed there, apart from Apify's collection cost.
import { featureState } from "@/lib/capabilities";
import { approxUsd, decodeUsd, decodeUsdPerAd, OPENAI_TEXT_PRICING } from "@/lib/ai-cost";
import type { InstallState } from "@/lib/install/types";
import { UI_LOCALE } from "@/lib/ui-locale";

const NO_SWITCH = "There's no setting to turn this off.";

/** The reading estimate for `ads` new ads, or null when TypeSafe reads them (it bills its own way). */
export function readingUsd(ads: number, install: InstallState | null): number | null {
  return install?.aiProvider === "typesafe" ? null : decodeUsd(ads);
}

/** One plain line: ads are read automatically when the key is set, about what that costs, and that it can't be switched off. */
export function ReadingCostLine({ ads, install, upTo = false, inline = false, className }: { ads: number; install: InstallState | null; upTo?: boolean; /** A span, for inside a paragraph. */ inline?: boolean; className?: string }) {
  const keySet = install ? featureState("ai", install).ok : false;
  const each = approxUsd(decodeUsdPerAd());
  const count = `${ads.toLocaleString(UI_LOCALE)} ad${ads === 1 ? "" : "s"}`;
  const total = approxUsd(decodeUsd(ads));
  const text = install?.aiProvider === "typesafe"
    ? `${keySet ? "The AI then reads" : "Once the TypeSafe key is set, the AI reads"} each new ad for its format and hook, automatically, billed by TypeSafe. ${NO_SWITCH}`
    : `${keySet ? "With your OpenAI key set, each new ad is then read" : "Once your OpenAI key is set, each new ad is read"} for its format and hook automatically: ${each} an ad at OpenAI, ${upTo ? "up to " : ""}${total} for ${count} (an estimate at ${OPENAI_TEXT_PRICING.model} prices; ads read before aren't read again). ${NO_SWITCH}`;
  return inline ? <span className={className ?? "block"}>{text}</span> : <p className={className ?? "text-xs text-muted"}>{text}</p>;
}
