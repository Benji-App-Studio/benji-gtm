"use client";
// One competitor's app: its facts (rating, version, how often it ships, chart rank), the rating over
// time from the snapshots, the reviews by stars, what its users say (the AI summary, with real quotes),
// its releases and its newest reviews. Refresh reads it again; Summarize sends its reviews to OpenAI.
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { LineChart } from "@/components/charts";
import { confirmSpend } from "@/components/cost-confirm";
import { ask, notice } from "@/components/dialog";
import { FeatureLock, useFeatures } from "@/components/studio/features";
import { useProductName } from "@/components/workspace/product-header";
import { PLAY_REFRESH_USD, reviewSummaryUsd } from "@/lib/ai-cost";
import { useCached } from "@/lib/client-cache";
import {
  ago, averageOf, cadence, compact, priceText, ratingChange, ratingTrend, type MarketDetail, type ReviewSummary,
} from "@/lib/market";
import { workspaceHref } from "@/lib/workspace-schema";
import { IconExternal, IconRefresh, IconSparkles, IconTrash } from "../icons";
import { Button, Card, columnClass, cx, DeltaChip, EmptyState, ErrorNote, Page, PageHeader, Spinner } from "../ui";
import { reloadMarket } from "./market-view";
import { AppIcon, marketAction, marketAppUrl, NotSetUp, SummarySections } from "./parts";
import { MarketBodySkeleton } from "../page-skeletons";
import { UI_LOCALE } from "@/lib/ui-locale";

const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString(UI_LOCALE, { day: "numeric", month: "short", year: "numeric" }) : "");

export function MarketAppView({ productId, appId }: { productId: string; appId: string }) {
  const router = useRouter();
  const productName = useProductName(productId);
  const [detail, reload] = useCached<MarketDetail & { error?: string }>(marketAppUrl(productId, appId));
  const features = useFeatures(productId);
  const ai = features.state("market.summary");
  const [busy, setBusy] = useState<"refresh" | "summary" | "remove" | null>(null);
  const marketHref = workspaceHref(productId, "market");
  const crumbs = [{ label: productName ?? "App", href: workspaceHref(productId) }, { label: "Market", href: marketHref }];

  const header = (title: ReactNode, rest: Partial<Parameters<typeof PageHeader>[0]> = {}) => <PageHeader crumbs={[...crumbs, { label: detail?.app?.name ?? "App" }]} title={title} {...rest} />;
  if (!detail) return <Page>{header("App")}<MarketBodySkeleton /></Page>;
  if (detail.error) return <Page className={columnClass}>{header("App")}<ErrorNote>{detail.error}</ErrorNote></Page>;
  if (!detail.setup || !detail.app) return <Page>{header("App")}<NotSetUp message={detail.message} /></Page>;
  const app = detail.app;

  const run = async (action: "refresh" | "summary") => {
    // Paid steps say what they cost first: a summary at OpenAI, a Google Play refresh at Apify (App Store refreshes are free).
    if (action === "summary") {
      const reviews = Math.min(detail.reviewCount, 300);
      if (!(await confirmSpend({ title: `Summarize ${app.name}'s reviews?`, payer: "OpenAI", usd: reviewSummaryUsd(reviews),
        rows: [["Reviews read", `The newest ${reviews.toLocaleString(UI_LOCALE)}`], ["Writes", "What users love, complain about, ask for and say about price"]] }))) return;
    } else if (app.store === "google_play") {
      if (!(await confirmSpend({ title: `Refresh ${app.name}?`, payer: "Apify", usd: PLAY_REFRESH_USD,
        rows: [["Reads", "Its newest 150 Google Play reviews"]], note: "App Store apps refresh free." }))) return;
    }
    setBusy(action);
    const answer = await marketAction<{ message?: string | null }>(productId, action, { appId });
    setBusy(null);
    if (answer.error) { await notice(answer.error, action === "refresh" ? "Couldn't refresh this app" : "Couldn't summarize the reviews"); return; }
    await Promise.all([reload(), reloadMarket(productId)]);
    if (answer.message) await notice(answer.message, "Refreshed");
  };
  const remove = async () => {
    if (!(await ask({ title: `Stop tracking ${app.name}?`, body: "Its snapshots, reviews and summary are deleted. You can track it again later.", confirm: "Stop tracking", danger: true }))) return;
    setBusy("remove");
    const answer = await marketAction(productId, "untrack", { appId });
    setBusy(null);
    if (answer.error) { await notice(answer.error, "Couldn't stop tracking it"); return; }
    await reloadMarket(productId);
    router.push(marketHref);
  };

  const trend = ratingTrend(detail.snapshots);
  const change = ratingChange(detail.snapshots);
  const ships = cadence(detail.releases);
  const summary = detail.summary?.summary as ReviewSummary | undefined;
  const latestRank = detail.snapshots.find((s) => s.rank != null);
  const play = app.store === "google_play";
  const rating = play ? averageOf(detail.stars) : app.rating;

  return (
    <Page className={columnClass}>
      {header(
        <span className="flex min-w-0 items-center gap-3"><AppIcon url={app.icon_url} name={app.name} className="size-10" /><span className="min-w-0">{app.name}</span></span>,
        {
          subtitle: [app.developer, app.category, priceText(app), play ? "Google Play" : null].filter(Boolean).join(" · ") || undefined,
          actions: (
            <>
              {app.url && <a href={app.url} target="_blank" rel="noreferrer" className="inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium text-label transition-colors hover:bg-hover hover:text-ink [&_svg]:size-3.5"><IconExternal /><span className="max-sm:sr-only">Store page</span></a>}
              <Button size="sm" variant="secondary" onClick={() => run("refresh")} disabled={busy !== null}>{busy === "refresh" ? <Spinner className="size-3" /> : <IconRefresh />}{busy === "refresh" ? "Reading…" : "Refresh"}</Button>
            </>
          ),
        },
      )}

      {app.refresh_message && <ErrorNote>{app.refresh_message}</ErrorNote>}

      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-card border border-line bg-card p-4 sm:grid-cols-4">
        <Fact label={play ? "Rating of recent reviews" : "Rating"} value={rating != null ? rating.toFixed(1) : "–"}
          note={<>{play ? `${detail.reviewCount} reviews read` : `${compact(app.rating_count)} ratings`}{change && change.delta !== 0 && <DeltaChip className="ml-1.5" value={Math.abs(change.delta).toFixed(2)} direction={change.delta > 0 ? "up" : "down"} />}</>} />
        <Fact label="Version" value={app.version ? `v${app.version}` : "–"} note={app.store_updated_at ? `updated ${ago(app.store_updated_at)}` : "not known"} />
        <Fact label="Ships" value={ships.medianDays != null ? `${Math.round(ships.medianDays)} days` : "–"} note={ships.medianDays != null ? "between releases (median)" : ships.releases ? "one release seen" : "no releases seen"} />
        <Fact label="Chart rank" value={app.chart_rank ? `#${app.chart_rank}` : "–"} note={app.chart_label ?? (latestRank?.chart ? latestRank.chart : "not in a chart you opened")} />
      </dl>
      <p className="mt-2 text-xs text-muted">
        {app.released_at && `First released ${day(app.released_at)}. `}
        {app.refreshed_at ? `Read ${ago(app.refreshed_at)}.` : "Not read yet: press Refresh."} The trend fills in as you refresh on different days.
      </p>

      <Section title="Rating over time">
        {trend.length >= 2
          ? <LineChart height={180} labels={trend.map((p) => new Date(`${p.day}T12:00:00Z`).toLocaleDateString(UI_LOCALE, { day: "numeric", month: "short", timeZone: "UTC" }))}
              series={[{ key: "rating", label: "Rating", values: trend.map((p) => p.rating), color: "accent" }]}
              domain={[Math.max(0, Math.min(...trend.map((p) => p.rating)) - 0.2), Math.min(5, Math.max(...trend.map((p) => p.rating)) + 0.2)]}
              format={(v) => v.toFixed(1)} tip={(i) => [trend[i].day, `${trend[i].rating.toFixed(2)}★`, trend[i].count ? `${compact(trend[i].count)} ratings` : ""].filter(Boolean)} />
          : <p className="text-sm text-muted">{trend.length ? `${trend[0].rating.toFixed(2)} on ${day(trend[0].day)}. ` : ""}A trend needs snapshots from two different days: refresh again tomorrow.</p>}
      </Section>

      <Section title="Reviews by stars" note={detail.reviewCount ? `${detail.reviewCount} recent reviews read` : undefined}>
        {detail.reviewCount ? <Stars stars={detail.stars} /> : <p className="text-sm text-muted">No reviews read yet. Some apps get none in Apple&apos;s feed; Refresh tries again.</p>}
      </Section>

      <Section title="What users say" note={detail.summary ? `From ${detail.summary.review_count ?? 0} reviews, ${ago(detail.summary.created_at)}` : undefined}
        action={ai.ok || ai.unknown
          ? detail.reviewCount >= 5 && <Button size="sm" variant={summary ? "secondary" : "primary"} onClick={() => run("summary")} disabled={busy !== null}>{busy === "summary" ? <Spinner className="size-3" /> : <IconSparkles />}{busy === "summary" ? "Reading reviews…" : summary ? "Summarize again" : `Summarize ${Math.min(detail.reviewCount, 300)} reviews`}</Button>
          : summary && <FeatureLock state={ai} />}>
        {/* A summary already written stays readable without the key; only a new one needs it. */}
        {summary
          ? <SummarySections summary={summary} />
          : !ai.ok && !ai.unknown
            ? <FeatureLock state={ai} />
            : <p className="text-sm text-muted">{detail.reviewCount >= 5 ? "The AI groups these reviews into what users love, complain about, ask for and say about price, each with real quotes." : "There are too few reviews to summarize yet."}</p>}
      </Section>

      <Section title="Releases" note={ships.label}>
        {detail.releases.length
          ? (
            <ul className="divide-y divide-line">
              {detail.releases.map((r) => (
                <li key={r.version} className="py-2.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <p className="text-sm font-medium tabular-nums">v{r.version}</p>
                    <p className="text-xs text-muted">{r.released_at ? `${r.source === "reviews" ? "by " : ""}${day(r.released_at)}` : "date unknown"}{r.source === "reviews" && " · seen in reviews"}</p>
                  </div>
                  {r.notes && <p className="mt-1 line-clamp-3 text-caption whitespace-pre-line text-muted">{r.notes}</p>}
                </li>
              ))}
            </ul>
          )
          : <p className="text-sm text-muted">No releases seen yet.</p>}
      </Section>

      <Section title="Newest reviews">
        {detail.reviews.length
          ? (
            <ul className="divide-y divide-line">
              {detail.reviews.slice(0, 12).map((r) => (
                <li key={r.store_review_id} className="py-2.5">
                  <p className="text-xs text-muted"><span className="font-medium text-ink">{r.rating}★</span>{[r.version && `v${r.version}`, r.reviewed_at && day(r.reviewed_at), r.country?.toUpperCase()].filter(Boolean).map((p) => ` · ${p}`).join("")}</p>
                  {r.title && <p className="mt-0.5 text-sm font-medium">{r.title}</p>}
                  <p className="mt-0.5 line-clamp-4 text-sm text-label">{r.body}</p>
                </li>
              ))}
            </ul>
          )
          : <EmptyState className="py-6" title="No reviews yet" body="Refresh reads the newest reviews from the US, UK, Canadian and Australian stores." />}
      </Section>

      <div className="mt-10 border-t border-line pt-4">
        <Button size="sm" variant="ghost" onClick={remove} disabled={busy !== null} className="text-warn hover:text-warn"><IconTrash />Stop tracking</Button>
      </div>
    </Page>
  );
}

function Fact({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 text-figure font-medium tabular-nums">{value}</dd>
      {note && <dd className="mt-0.5 flex flex-wrap items-center text-xs text-muted">{note}</dd>}
    </div>
  );
}

function Section({ title, note, action, children }: { title: string; note?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-8">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <h2 className="text-title font-medium">{title}</h2>
          {note && <p className="text-caption text-muted">{note}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** One bar per star, five down to one. */
function Stars({ stars }: { stars: number[] }) {
  const total = stars.reduce((s, n) => s + n, 0) || 1;
  return (
    <Card className="grid gap-1.5 p-4">
      {[5, 4, 3, 2, 1].map((star) => {
        const n = stars[star - 1];
        return (
          <div key={star} className="grid grid-cols-[28px_minmax(0,1fr)_64px] items-center gap-3 text-xs">
            <span className="text-muted tabular-nums">{star}★</span>
            <span className="h-2 overflow-hidden rounded-full bg-control"><span className={cx("block h-full rounded-full", star >= 4 ? "bg-win" : star === 3 ? "bg-caution" : "bg-warn")} style={{ width: `${(n / total) * 100}%` }} /></span>
            <span className="text-right text-muted tabular-nums">{n} · {Math.round((n / total) * 100)}%</span>
          </div>
        );
      })}
    </Card>
  );
}
