// Research sources (lib/research-sources.ts) in the page's language. That file is a byte-for-byte copy
// of supabase/functions/_shared/research-sources.ts and stays import-free, so its source names and
// messages are English there, and so are the research function's skip reasons and notes that use them
// (supabase/functions/research/plan.ts). This file lists every one of them for the dictionaries and
// turns any of them into the page's language where it is shown:
//   researchText(reason, useT())
import { m } from "../../lib/i18n/translate";
import { templateTranslator } from "../../lib/i18n/template-match";

export const RESEARCH_SOURCE_SENTENCES: readonly string[] = [
  // SOURCE_NAMES.
  m("Meta ads through Apify"),
  m("Google ads"),
  m("Meta's Ad Library API"),
  m("TikTok's Commercial Content API"),
  m("TikTok ads shown in Europe"),
  m("TikTok Top Ads"),
  // PRICES notes.
  m("$0.34 per 100 on Apify's Business plan."),
  m("$0.20 per 100 ads, plus $0.20 per 100 text ads for their words."),
  m("Plus $0.005 per search."),
  // researchPatch (Settings › Research sources, answered by the install function).
  m("Research sources must be a set of choices."),
  m("Choose the community or the official actor for Meta ads."),
  m("Unknown research source: {field}."),
  m("{source} must be on, off or automatic."),
  m("Send the research sources to change."),
  // The research function's plan (skipped sources and notes in the collect dialog).
  m("Meta ads in {countries}: {source} needs the Apify key."),
  m("Meta ads in {countries}: {source} needs its key."),
  m("Meta ads in {countries}: {source} is off in Settings > Research sources."),
  m("TikTok lists a brand's ads only where they ran in Europe, so only its European ads can come in."),
  m("No TikTok source that finds a brand's own ads is on."),
  m("That competitor isn't on the list any more."),
  m("Add competitors to the list and follow them first."),
  m("Google ads are matched by name for competitors without a website or Google advertiser id; add one for exact results."),
];

/** One of the sentences above (or a message made of them) in the page's language; unknown text stays as it came. */
export const researchText = templateTranslator(RESEARCH_SOURCE_SENTENCES);
