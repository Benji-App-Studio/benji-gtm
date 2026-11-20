"use client";
// What reading the ads costs after a collection or an import. New ads are read for their format and hook
// automatically (the research function's decode-new) whenever the AI's key is set; that runs on OpenAI
// (or TypeSafe, when Settings choose it) and is billed there, apart from Apify's collection cost.
import { featureState } from "@/lib/capabilities";
import { approxUsd, decodeUsd, decodeUsdPerAd, OPENAI_TEXT_PRICING } from "@/lib/ai-cost";
import type { InstallState } from "@/lib/install/types";
import { useT } from "@/lib/i18n/client";

/** The reading estimate for `ads` new ads, or null when TypeSafe reads them (it bills its own way). */
export function readingUsd(ads: number, install: InstallState | null): number | null {
  return install?.aiProvider === "typesafe" ? null : decodeUsd(ads);
}

/** One plain line: ads are read automatically when the key is set, about what that costs, and that it can't be switched off. */
export function ReadingCostLine({ ads, install, upTo = false, inline = false, className }: { ads: number; install: InstallState | null; upTo?: boolean; /** A span, for inside a paragraph. */ inline?: boolean; className?: string }) {
  const { t, tn, intl } = useT();
  const keySet = install ? featureState("ai", install).ok : false;
  const each = approxUsd(decodeUsdPerAd(), intl, t);
  const vars = { each, total: approxUsd(decodeUsd(ads), intl, t), model: OPENAI_TEXT_PRICING.model };
  const noSwitch = t("There's no setting to turn this off.");
  const cost = upTo
    ? tn(ads, "{each} an ad at OpenAI, up to {total} for {n} ad (an estimate at {model} prices; ads read before aren't read again).", "{each} an ad at OpenAI, up to {total} for {n} ads (an estimate at {model} prices; ads read before aren't read again).", vars)
    : tn(ads, "{each} an ad at OpenAI, {total} for {n} ad (an estimate at {model} prices; ads read before aren't read again).", "{each} an ad at OpenAI, {total} for {n} ads (an estimate at {model} prices; ads read before aren't read again).", vars);
  const text = install?.aiProvider === "typesafe"
    ? `${keySet ? t("The AI then reads each new ad for its format and hook, automatically, billed by TypeSafe.") : t("Once the TypeSafe key is set, the AI reads each new ad for its format and hook, automatically, billed by TypeSafe.")} ${noSwitch}`
    : `${keySet ? t("With your OpenAI key set, each new ad is then read for its format and hook automatically:") : t("Once your OpenAI key is set, each new ad is read for its format and hook automatically:")} ${cost} ${noSwitch}`;
  return inline ? <span className={className ?? "block"}>{text}</span> : <p className={className ?? "text-xs text-muted"}>{text}</p>;
}
