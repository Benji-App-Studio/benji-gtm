// Real App Store reviews as proof (products.insight.appStore.reviews, fetched verbatim by the insight
// function): the review picker in review-style Style Library and template fields inserts a review's
// exact text and author, and the Playground request records its id (job params `review_ids`), so every
// quoted review can be traced back. A review edited after it was inserted is no longer verbatim, so its
// id drops out. Plain TypeScript (browser and Node tests).

export interface AppStoreReview { id: string; author: string; rating: number; title: string; body: string; date: string; url?: string }

/** A form's review slot: the field for the review's words and, when there is one, the field for its author. */
export interface ReviewSlot { text: string; author?: string }

const TEXT = /\b(review|reviews|quote|testimonial)\b/i;
const AUTHOR = /\b(reviewer|author|customer|name|signed|by)\b/i;

/** The review slot of a set of fields (a Style Library style's or a custom template's), or null when it has none. */
export function reviewSlot(fields: { key: string; label: string; multiline?: boolean }[]): ReviewSlot | null {
  const text = fields.find((f) => (TEXT.test(f.label) || TEXT.test(f.key)) && !/reviewer/i.test(`${f.key} ${f.label}`) && !/\b(headline|title|rating|stars?)\b/i.test(f.label));
  if (!text) return null;
  const author = fields.find((f) => f !== text && (/reviewer/i.test(`${f.key} ${f.label}`) || (AUTHOR.test(f.label) && !f.multiline)));
  return { text: text.key, ...(author ? { author: author.key } : {}) };
}

/** The values with a review inserted: its exact words, and its author when the form has a slot for one. */
export function insertReview(values: Record<string, string>, slot: ReviewSlot, review: AppStoreReview): Record<string, string> {
  return { ...values, [slot.text]: review.body, ...(slot.author ? { [slot.author]: review.author } : {}) };
}

/** The picked review's id while its words are still in the field exactly; [] once they're edited. */
export function verbatimReviewIds(values: Record<string, string>, slot: ReviewSlot | null, picked: AppStoreReview | null): string[] {
  if (!slot || !picked) return [];
  return values[slot.text]?.trim() === picked.body.trim() ? [picked.id] : [];
}

/** Whether a review fits a field as it is (it can't be shortened and stay verbatim). */
export const reviewFits = (review: Pick<AppStoreReview, "body">, maxLength: number) => review.body.trim().length <= maxLength;

/** "★★★★☆". */
export const stars = (rating: number) => "★".repeat(Math.max(0, Math.min(5, Math.round(rating)))) + "☆".repeat(5 - Math.max(0, Math.min(5, Math.round(rating))));

/** Reviews made safe from a stored profile: well-formed only. */
export function reviewsOf(insight: unknown): AppStoreReview[] {
  const list = (insight as { appStore?: { reviews?: unknown } } | null)?.appStore?.reviews;
  if (!Array.isArray(list)) return [];
  return list.filter((r): r is AppStoreReview => Boolean(r) && typeof r.id === "string" && typeof r.body === "string" && typeof r.rating === "number")
    .map((r) => ({ id: r.id, author: typeof r.author === "string" ? r.author : "", rating: r.rating, title: typeof r.title === "string" ? r.title : "", body: r.body, date: typeof r.date === "string" ? r.date : "", ...(typeof r.url === "string" ? { url: r.url } : {}) }));
}

/** Review ids for job params: strings, at most 10. */
export function cleanReviewIds(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((v): v is string => typeof v === "string" && v.length > 0).map((v) => v.slice(0, 64)))].slice(0, 10) : [];
}
