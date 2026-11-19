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

export function ReviewPicker({ reviews, maxLength, picked, onPick, productId }: {
  reviews: AppStoreReview[]; maxLength: number; picked: AppStoreReview | null; onPick: (review: AppStoreReview) => void;
  /** Offers "Fetch reviews" (the insight function's reviews route) when there are none yet. */
  productId?: string;
}) {
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
    if (!response?.ok) return setMessage(data?.error ?? "Couldn't fetch the reviews. Try again.");
    setMessage(data?.reviews ? null : "The App Store has no written reviews for this app yet.");
    await refresh(`/api/products/${productId}`).catch(() => {});
  }

  return (
    <div className="rounded-inner border border-line p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-label">Use a real App Store review</span>
        {picked && <span className="text-win">Quoting {picked.author || "a reviewer"} word for word</span>}
        <span className="ml-auto flex items-center gap-2">
          {reviews.length > 0
            ? <Button size="sm" variant="ghost" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? "Hide" : `Pick one (${fitting} fit${fitting === 1 ? "s" : ""} of ${reviews.length})`}</Button>
            : productId && <Button size="sm" variant="secondary" onClick={fetchReviews} disabled={busy}>{busy && <Spinner className="size-3" />}Fetch reviews</Button>}
        </span>
      </div>
      {!reviews.length && <p className="mt-1 text-muted">{message ?? "No App Store reviews saved for this product yet. They're read with your App Store link."}</p>}
      {open && (
        <ul className="mt-2 grid max-h-72 gap-1.5 overflow-y-auto">
          {reviews.map((r) => {
            const fits = reviewFits(r, maxLength);
            return (
              <li key={r.id}>
                <button type="button" disabled={!fits} onClick={() => { onPick(r); setOpen(false); }}
                  className={cx("w-full rounded-inner border px-2.5 py-2 text-left transition", picked?.id === r.id ? "border-ink" : "border-line hover:border-ink/30", !fits && "cursor-not-allowed opacity-50")}
                  title={fits ? "Insert its exact words and author" : `${r.body.trim().length} characters: longer than this field's ${maxLength}, and a review can't be shortened and stay verbatim`}>
                  <span className="flex items-baseline gap-2">
                    <span className="text-caution-ink" aria-label={`${r.rating} stars`}>{stars(r.rating)}</span>
                    <span className="min-w-0 truncate font-medium text-ink">{r.title}</span>
                    <span className="ml-auto shrink-0 text-faint">{r.author}{r.date ? ` · ${new Date(r.date).toLocaleDateString()}` : ""}</span>
                  </span>
                  <span className="mt-0.5 line-clamp-3 block whitespace-pre-line text-label">{r.body}</span>
                  {!fits && <span className="mt-0.5 block text-faint">Too long for this field ({r.body.trim().length}/{maxLength})</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
