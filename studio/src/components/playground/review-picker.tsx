"use client";
// The review picker on review-style Style Library and template forms: the product's real App Store
// reviews (products.insight.appStore.reviews, fetched verbatim by the insight function), newest first.
// Picking one puts its exact words (and its author, when the form has a slot for one) into the fields;
// the form records its id on the request (lib/reviews.ts). Too-long reviews can't be shortened and stay
// verbatim, so they're shown but can't be picked for that field.
import { useState } from "react";
import { refresh } from "@/lib/client-cache";
import { reviewFits, stars, type AppStoreReview } from "@/lib/reviews";
import { Button, cx, Spinner } from "../ui";
import { useT } from "@/lib/i18n/client";

export function ReviewPicker({ reviews, maxLength, picked, onPick, productId }: {
  reviews: AppStoreReview[]; maxLength: number; picked: AppStoreReview | null; onPick: (review: AppStoreReview) => void;
  /** Offers "Fetch reviews" (the insight function's reviews route) when there are none yet. */
  productId?: string;
}) {
  const { t, tn, intl } = useT();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const fitting = reviews.filter((r) => reviewFits(r, maxLength)).length;

  async function fetchReviews() {
    if (!productId) return;
    setBusy(true);
    setMessage(null);
    const response = await fetch(`/api/products/${productId}/insight`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reviews" }) }).catch(() => null);
    const data = await response?.json().catch(() => null) as { reviews?: number; error?: string } | null;
    setBusy(false);
    if (!response?.ok) return setMessage(data?.error ?? t("Couldn't fetch the reviews. Try again."));
    setMessage(data?.reviews ? null : t("The App Store has no written reviews for this app yet."));
    await refresh(`/api/products/${productId}`).catch(() => {});
  }

  return (
    <div className="rounded-inner border border-line p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-ink">{t("Use a real App Store review")}</span>
        {picked && <span className="text-win">{picked.author ? t("Quoting {author} word for word", { author: picked.author }) : t("Quoting a reviewer word for word")}</span>}
        <span className="ml-auto flex items-center gap-2">
          {reviews.length > 0
            ? <Button size="sm" variant="ghost" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? t("Hide") : tn(fitting, "Pick one ({n} of {total} fits)", "Pick one ({n} of {total} fit)", { total: reviews.length })}</Button>
            : productId && <Button size="sm" variant="secondary" onClick={fetchReviews} disabled={busy}>{busy && <Spinner className="size-3" />}{t("Fetch reviews")}</Button>}
        </span>
      </div>
      {!reviews.length && <p className="mt-1 text-muted">{message ?? t("No App Store reviews saved for this product yet. They're read with your App Store link.")}</p>}
      {open && (
        <ul className="mt-2 grid max-h-72 gap-1.5 overflow-y-auto">
          {reviews.map((r) => {
            const fits = reviewFits(r, maxLength);
            return (
              <li key={r.id}>
                <button type="button" disabled={!fits} onClick={() => { onPick(r); setOpen(false); }}
                  className={cx("w-full rounded-inner border px-2.5 py-2 text-left transition", picked?.id === r.id ? "border-ink" : "border-line hover:border-ink/30", !fits && "cursor-not-allowed opacity-50")}
                  title={fits ? t("Insert its exact words and author") : t("{n} characters: longer than this field's {max}, and a review can't be shortened and stay verbatim", { n: r.body.trim().length, max: maxLength })}>
                  <span className="flex items-baseline gap-2">
                    <span className="text-caution-ink" aria-label={tn(r.rating, "{n} star", "{n} stars")}>{stars(r.rating)}</span>
                    <span className="min-w-0 truncate font-medium text-ink">{r.title}</span>
                    <span className="ml-auto shrink-0 text-faint">{r.author}{r.date ? ` · ${new Date(r.date).toLocaleDateString(intl)}` : ""}</span>
                  </span>
                  <span className="mt-0.5 line-clamp-3 block whitespace-pre-line text-label">{r.body}</span>
                  {!fits && <span className="mt-0.5 block text-faint">{t("Too long for this field ({n}/{max})", { n: r.body.trim().length, max: maxLength })}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
