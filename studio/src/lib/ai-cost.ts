// What the AI steps that run on OpenAI's text model are estimated to cost, so a paid action can say so
// before it runs: reading ads (the research function's decode, through the AI judge), the Market review
// and chart summaries, and the Google Play refresh (Apify). Estimates, not quotes: OpenAI bills the
// tokens actually used.
//
// The model is the default text model (MODEL_DEFAULTS.text in supabase/functions/_shared/ai/models.ts;
// ai-cost.test.ts checks they match). Prices: release/docs/keys/openai.md.

export const OPENAI_TEXT_PRICING = {
  model: "gpt-6.1-sol",
  usdPerMillion: { input: 2, output: 10 },
  checked: "2026-11-19",
} as const;

/** Text-model tokens in and out, in USD. */
export const textUsd = (input: number, output: number) =>
  (input * OPENAI_TEXT_PRICING.usdPerMillion.input + output * OPENAI_TEXT_PRICING.usdPerMillion.output) / 1_000_000;

/**
 * Reading one ad for its format, hook and each line's job: one request to the AI judge with the format
 * list, the ad's copy (or its transcript) and the questions. A short image ad measured about 3,600
 * tokens in; a video with a transcript asks one more question per line. About 1,000 tokens come back.
 */
export const DECODE_TOKENS = { input: 5_000, output: 1_000 } as const;
export const decodeUsdPerAd = () => textUsd(DECODE_TOKENS.input, DECODE_TOKENS.output);
/** Reading `ads` ads. */
export const decodeUsd = (ads: number) => Math.max(0, ads) * decodeUsdPerAd();

/**
 * A Market review summary (insight/market.ts `summary`): the newest 300 reviews at most, cut to 60,000
 * characters (`reviewPrompt`, about 4 characters a token and 230 a review line), plus the instructions;
 * about 2,500 tokens back, with its short reasoning.
 */
export function reviewSummaryUsd(reviews: number) {
  const chars = Math.min(60_000, Math.min(Math.max(reviews, 0), 300) * 230);
  return textUsd(1_500 + chars / 4, 2_500);
}

/** A Market chart summary (`chartSummary`): 50 apps with their short descriptions, about 5,000 tokens in and 2,000 back. */
export const chartSummaryUsd = () => textUsd(5_000, 2_000);

/** A Google Play refresh: the Apify reviews actor reads up to 150 reviews, about $0.02 (release/docs/MARKET.md). */
export const PLAY_REFRESH_USD = 0.02;

/**
 * "≈ $0.02" style: two decimals, or three below ten cents so a small cost isn't rounded to nothing. Pass
 * the translator's `intl` for the amount in the page's language ("≈ US$0.02" in Chinese and Korean, like
 * every other amount there) and its `t` for the words.
 */
export function approxUsd(amount: number, intl = "en-US", t: (text: string) => string = (text) => text): string {
  const money = (n: number, decimals: number) => new Intl.NumberFormat(intl, { style: "currency", currency: "USD", minimumFractionDigits: Math.min(2, decimals), maximumFractionDigits: decimals }).format(n);
  if (!Number.isFinite(amount) || amount <= 0) return money(0, 0);
  if (amount < 0.005) return t("under $0.01");
  return `≈ ${money(amount, amount < 0.1 ? 3 : 2)}`;
}
