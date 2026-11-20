"use client";
// Pieces the Market pages share: the call to the market API, an app's icon and its one-line facts, a
// review summary with its quotes, and the states for a database that doesn't have Market yet.
import type { ReactNode } from "react";
import { useT } from "@/lib/i18n/client";
import { fill, type Translator } from "@/lib/i18n/translate";
import { compact, SECTION_LABEL, SUMMARY_SECTIONS, type ReviewSummary, type Theme } from "@/lib/market";
import { IconStack } from "../icons";
import { cx, EmptyState } from "../ui";

export const marketUrl = (productId: string) => `/api/w/${productId}/market`;
export const marketAppUrl = (productId: string, appId: string) => `/api/w/${productId}/market/${appId}`;

const english: Translator["t"] = (text, vars) => fill(text, vars);

/**
 * One market action (search, track, refresh, summary…). Never throws: a failure comes back as `error`,
 * in the page's language when the caller passes its `t`.
 */
export async function marketAction<T = Record<string, unknown>>(productId: string, action: string, body: Record<string, unknown> = {}, t: Translator["t"] = english): Promise<T & { error?: string }> {
  try {
    const response = await fetch(marketUrl(productId), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, action }) });
    const answered = t("The server answered {status}. Try again in a moment.", { status: String(response.status) });
    const data = await response.json().catch(() => ({ error: answered }));
    if (!response.ok && !data?.error) return { ...data, error: answered };
    return data;
  } catch {
    return { error: t("Couldn't reach the server. Check your connection and try again.") } as T & { error: string };
  }
}

/** The app's icon (store artwork), or its initial on a plain tile. */
export function AppIcon({ url, name, className = "size-8" }: { url: string | null | undefined; name: string; className?: string }) {
  return url
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={url} alt="" loading="lazy" decoding="async" className={cx("shrink-0 rounded-[22%] border border-line object-cover", className)} />
    : <span aria-hidden className={cx("grid shrink-0 place-items-center rounded-[22%] bg-control text-xs font-semibold text-muted", className)}>{name.trim().charAt(0).toUpperCase() || "?"}</span>;
}

/** "4.8 ★ 149K" in the list's quiet style; "No ratings" when there are none. */
export function Rating({ rating, count, className }: { rating: number | null | undefined; count: number | null | undefined; className?: string }) {
  const { t } = useT();
  if (rating == null || !count) return <span className={cx("text-muted", className)}>{t("No ratings")}</span>;
  return (
    <span className={cx("inline-flex items-baseline gap-1 tabular-nums", className)}>
      <span className="font-medium text-ink">{rating.toFixed(1)}</span>
      <span aria-hidden className="text-faint">★</span>
      <span className="text-muted">{compact(count)}<span className="sr-only"> {t("ratings")}</span></span>
    </span>
  );
}

/** Market's tables aren't in this database yet: what to do, in place of the page. */
export function NotSetUp({ message }: { message?: string }) {
  const { t } = useT();
  return (
    <EmptyState icon={<IconStack />} title={t("Market isn't set up in your database yet")}
      body={message ?? t("Run the update (docs/UPDATING.md in your copy) to add its tables. Nothing else changes.")} />
  );
}

/** A quote from a review, word for word, with its stars and version. */
export function QuoteLine({ text, rating, version, source }: { text: string; rating: number | null; version?: string | null; source?: ReactNode }) {
  return (
    <li className="border-l-2 border-line pl-3">
      <p className="text-sm text-ink">&ldquo;{text}&rdquo;</p>
      <p className="mt-0.5 text-xs text-muted">{[source, rating ? `${rating}★` : null, version ? `v${version}` : null].filter(Boolean).map((part, i) => <span key={i}>{i > 0 && " · "}{part}</span>)}</p>
    </li>
  );
}

function ThemeRow({ theme }: { theme: Theme }) {
  const { tn } = useT();
  return (
    <li className="py-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <p className="text-sm font-medium">{theme.theme}</p>
        <span className="text-xs text-muted tabular-nums">{tn(theme.count, "{n} review", "{n} reviews")}</span>
      </div>
      {theme.detail && <p className="mt-0.5 text-caption text-muted">{theme.detail}</p>}
      <ul className="mt-2 grid gap-2">{theme.quotes.map((q) => <QuoteLine key={q.reviewId} text={q.text} rating={q.rating} version={q.version} />)}</ul>
    </li>
  );
}

/** "What users love / complain about / ask for / say about price", each theme with its real quotes. */
export function SummarySections({ summary }: { summary: ReviewSummary }) {
  const { t } = useT();
  return (
    <div className="grid gap-6">
      {summary.overview && <p className="text-sm text-ink">{summary.overview}</p>}
      {SUMMARY_SECTIONS.map((section) => (
        <section key={section}>
          <h3 className="text-xs font-medium text-muted">{t(SECTION_LABEL[section])}</h3>
          {summary[section]?.length
            ? <ul className="divide-y divide-line">{summary[section].map((theme) => <ThemeRow key={theme.theme} theme={theme} />)}</ul>
            : <p className="mt-1.5 text-sm text-muted">{t("Nothing clear in these reviews.")}</p>}
        </section>
      ))}
    </div>
  );
}
