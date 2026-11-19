"use client";
// The Market page: what is working in the app stores, for someone about to build an app.
//
//   Apps           the competitors' apps this product tracks (rating, price, version and when it last
//                  shipped, chart rank), with "Track an app" (a name, an App Store link or a Google Play
//                  link) and the apps of the competitors already on the product's list.
//   Top charts     top grossing, free and paid for a category and country, each app's rating and price,
//                  "Track" from a row, and an AI read of the chart.
//   Opportunities  across tracked apps: the complaints and requests their reviewers share, ranked, with
//                  quotes: the gaps a new app could fill.
//
// The App Store needs no key. The AI parts need the OpenAI key; Google Play needs the Apify token.
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { confirmSpend } from "@/components/cost-confirm";
import { notice } from "@/components/dialog";
import { FeatureLock, useFeatures } from "@/components/studio/features";
import { ProductPageHeader } from "@/components/workspace/product-header";
import { MarketBodySkeleton } from "@/components/page-skeletons";
import { chartSummaryUsd, PLAY_REFRESH_USD } from "@/lib/ai-cost";
import { refresh as refreshCached, useCached } from "@/lib/client-cache";
import {
  ago, appSummaries, CHART_KINDS, COUNTRIES, GENRES, opportunities, priceText, untrackedCompetitors,
  type ChartKind, type ChartRow, type ChartSummary, type FoundApp, type MarketApp, type MarketOverview, type Opportunity,
} from "@/lib/market";
import { workspaceHref } from "@/lib/workspace-schema";
import { IconCheck, IconPlus, IconSearch, IconSparkles, IconTrendUp, IconX } from "../icons";
import { Badge, Button, ButtonLink, Card, cx, EmptyState, ErrorNote, Page, SearchField, Segmented, SelectPill, Spinner } from "../ui";
import { AppIcon, marketAction, marketUrl, NotSetUp, QuoteLine, Rating } from "./parts";

type Tab = "apps" | "charts" | "opportunities";
const TABS: { value: Tab; label: string }[] = [{ value: "apps", label: "Competitors' apps" }, { value: "charts", label: "Top charts" }, { value: "opportunities", label: "Opportunities" }];
const SUBTITLE = "What's working in the app stores: your competitors' apps, the top charts, and what their users love and hate.";

export function MarketView({ productId }: { productId: string }) {
  const params = useSearchParams();
  const [tab, setTabState] = useState<Tab>(() => (TABS.some((t) => t.value === params.get("tab")) ? params.get("tab") as Tab : "apps"));
  const [overview, reload] = useCached<MarketOverview & { error?: string }>(marketUrl(productId));
  const [tracking, setTracking] = useState(false);

  const setTab = (next: Tab) => {
    setTabState(next);
    const query = new URLSearchParams(window.location.search);
    if (next === "apps") query.delete("tab"); else query.set("tab", next);
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${query.size ? `?${query}` : ""}`);
  };

  const ready = overview && !overview.error && overview.setup;
  const header = (
    <ProductPageHeader productId={productId} page="Market" subtitle={SUBTITLE}
      actions={ready && tab === "apps" && !tracking && overview.apps.length > 0 ? <Button size="sm" onClick={() => setTracking(true)}><IconPlus />Track an app</Button> : undefined} />
  );

  if (!overview) return <Page>{header}<MarketBodySkeleton /></Page>;
  if (overview.error) return <Page>{header}<ErrorNote>{overview.error}</ErrorNote></Page>;
  if (!overview.setup) return <Page>{header}<NotSetUp message={overview.message} /></Page>;

  return (
    <Page>
      {header}
      <Segmented options={TABS} value={tab} onChange={setTab} label="Market" className="mb-5" />
      {tab === "apps" && <AppsTab productId={productId} overview={overview} tracking={tracking} setTracking={setTracking} reload={reload} />}
      {tab === "charts" && <ChartsTab productId={productId} overview={overview} reload={reload} />}
      {tab === "opportunities" && <OpportunitiesTab productId={productId} overview={overview} openApps={() => setTab("apps")} />}
    </Page>
  );
}

// MARK: Competitors' apps

function AppsTab({ productId, overview, tracking, setTracking, reload }: { productId: string; overview: MarketOverview; tracking: boolean; setTracking: (v: boolean) => void; reload: () => Promise<unknown> }) {
  const untracked = untrackedCompetitors(overview.competitors, overview.apps);
  return (
    <div className="grid gap-8">
      {tracking && <TrackPanel productId={productId} onClose={() => setTracking(false)} onTracked={reload} />}
      {untracked.length > 0 && <Suggestions productId={productId} competitors={untracked} onTracked={reload} />}
      {overview.apps.length
        ? <AppList productId={productId} apps={overview.apps} />
        : !tracking && (
          <EmptyState icon={<IconTrendUp />} title="No competitor apps yet"
            body="Track a competitor's app to see its rating, price, how often it ships and what its users love and hate. Start with an App Store link or a name, or pick one from Top charts."
            action={<Button size="sm" onClick={() => setTracking(true)}><IconPlus />Track an app</Button>} />
        )}
    </div>
  );
}

// Fixed widths: every row is its own grid, so its columns line up only if none sizes to its content.
const rowGrid = "grid grid-cols-[32px_minmax(0,1fr)_120px] items-center gap-x-3 sm:grid-cols-[32px_minmax(0,1fr)_110px_120px] md:grid-cols-[32px_minmax(0,1fr)_110px_140px_150px]";

function AppList({ productId, apps }: { productId: string; apps: MarketApp[] }) {
  return (
    <section>
      <div className={cx(rowGrid, "h-8 border-b border-line text-xs text-muted")}>
        <span className="col-span-2">App</span>
        <span className="max-sm:hidden">Rating</span>
        <span className="max-md:hidden">Price</span>
        <span className="text-right md:text-left">Version</span>
      </div>
      <ul>
        {apps.map((app) => (
          <li key={app.id}>
            <Link href={`${workspaceHref(productId, "market")}/${app.id}`} className={cx(rowGrid, "-mx-2 min-h-12 rounded-control px-2 py-1.5 transition-colors hover:bg-hover")}>
              <AppIcon url={app.icon_url} name={app.name} />
              <span className="min-w-0">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm font-medium">{app.name}</span>
                  {app.store === "google_play" && <Badge className="max-sm:hidden">Google Play</Badge>}
                </span>
                <span className="block truncate text-caption text-muted">
                  {app.chart_rank && app.chart_label && <span className="font-medium text-accent">#{app.chart_rank} in {app.chart_label}{app.developer && " · "}</span>}
                  {(app.chart_rank && app.chart_label ? [app.developer] : [app.developer, app.category]).filter(Boolean).join(" · ") || (app.chart_rank ? "" : app.store_id)}
                </span>
              </span>
              <Rating rating={app.rating} count={app.rating_count} className="text-sm max-sm:hidden" />
              <span className="truncate text-sm text-label max-md:hidden">{priceText(app) || "–"}</span>
              <span className="min-w-0 text-right md:text-left">
                <span className="block truncate text-sm text-label tabular-nums">{app.version ? `v${app.version}` : "–"}</span>
                <span className="block truncate text-xs text-muted">{app.store_updated_at ? `updated ${ago(app.store_updated_at)}` : app.refreshed_at ? `read ${ago(app.refreshed_at)}` : "not read yet"}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** "Track an app": a name, an App Store link or id, a bundle id, or a Google Play link. */
function TrackPanel({ productId, onClose, onTracked }: { productId: string; onClose: () => void; onTracked: () => Promise<unknown> }) {
  const features = useFeatures(productId);
  const play = features.state("market.play");
  const [query, setQuery] = useState("");
  const [country, setCountry] = useState("us");
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<{ results: FoundApp[]; play: { pkg: string; available: boolean } | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const search = async (event: FormEvent) => {
    event.preventDefault();
    if (!query.trim()) return;
    setBusy(true);
    setError(null);
    const answer = await marketAction<{ results?: FoundApp[]; play?: { pkg: string; available: boolean } | null }>(productId, "search", { query, country });
    setBusy(false);
    if (answer.error) { setError(answer.error); setFound(null); return; }
    setFound({ results: answer.results ?? [], play: answer.play ?? null });
  };

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-title font-medium">Track an app</h2>
          <p className="mt-0.5 text-caption text-muted">Type a name, or paste an App Store link. Each app is read once now, then whenever you refresh it.</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="grid size-7 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-hover hover:text-ink"><IconX className="size-3.5" /></button>
      </div>
      <form onSubmit={search} className="mt-3 flex flex-wrap items-center gap-2">
        <SearchField autoFocus value={query} onChange={(e) => setQuery(e.target.value)} aria-label="App name or link" className="min-w-0 flex-[1_1_240px]" />
        <SelectPill label="Store country" value={country} onChange={setCountry} options={COUNTRIES} />
        <Button type="submit" variant="secondary" disabled={busy || !query.trim()}>{busy ? <Spinner className="size-3.5" /> : <IconSearch />}Find</Button>
      </form>
      {play.ok || play.unknown
        ? <p className="mt-2 text-xs text-muted">Google Play has no free official API: paste a Play link and its reviews are read through Apify, with your Apify token.</p>
        : <FeatureLock state={play} className="mt-2" />}
      {error && <ErrorNote className="mt-3 mb-0">{error}</ErrorNote>}
      {found && (
        found.play
          ? <PlayResult productId={productId} pkg={found.play.pkg} available={found.play.available} country={country} onTracked={onTracked} />
          : found.results.length
            ? <ul className="mt-3">{found.results.map((app) => <FoundRow key={`${app.store}:${app.storeId}`} productId={productId} app={app} country={country} onTracked={onTracked} />)}</ul>
            : <p className="mt-3 text-sm text-muted">No apps found in the {COUNTRIES.find((c) => c.value === country)?.label ?? country} store. Try another name, or paste the app&apos;s link.</p>
      )}
    </Card>
  );
}

function PlayResult({ productId, pkg, available, country, onTracked }: { productId: string; pkg: string; available: boolean; country: string; onTracked: () => Promise<unknown> }) {
  const [name, setName] = useState("");
  if (!available) return <p className="mt-3 text-sm text-muted">Add your Apify token in Settings &gt; API keys to track this Google Play app ({pkg}). App Store apps need no key.</p>;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <input value={name} onChange={(e) => setName(e.target.value)} aria-label="The app's name" placeholder="The app's name" className="h-[30px] min-w-0 flex-[1_1_200px] rounded-control border border-hairline bg-raised px-2.5 text-sm outline-none focus:border-focus/70 focus:ring-2 focus:ring-focus/20" />
      <TrackButton productId={productId} body={{ store: "google_play", storeId: pkg, name: name.trim() || pkg, country }} onTracked={onTracked} />
      <span className="w-full text-xs text-muted">{pkg} · reviews only (the newest 150 per refresh, a few cents of Apify credit)</span>
    </div>
  );
}

function FoundRow({ productId, app, country, competitor, onTracked }: { productId: string; app: FoundApp; country: string; competitor?: string; onTracked: () => Promise<unknown> }) {
  return (
    <li className="-mx-2 flex min-h-12 items-center gap-3 rounded-control px-2 py-1.5 transition-colors hover:bg-hover">
      <AppIcon url={app.iconUrl} name={app.name} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{app.name}</span>
        <span className="block truncate text-caption text-muted">{[competitor && `For ${competitor}`, app.developer, app.category, app.priceLabel].filter(Boolean).join(" · ")}</span>
      </span>
      <Rating rating={app.rating} count={app.ratingCount} className="text-sm max-sm:hidden" />
      {app.trackedId
        ? <Link href={`${workspaceHref(productId, "market")}/${app.trackedId}`} className="shrink-0 rounded-xs text-xs font-medium text-accent hover:underline">Tracked</Link>
        : <TrackButton productId={productId} body={{ store: app.store, storeId: app.storeId, country, competitor }} onTracked={onTracked} />}
    </li>
  );
}

/** Tracks one app (it is read straight away, which takes a few seconds). */
function TrackButton({ productId, body, onTracked }: { productId: string; body: Record<string, unknown>; onTracked: () => Promise<unknown> }) {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const track = async () => {
    // A Google Play app is read through Apify straight away: say what that costs first.
    if (body.store === "google_play" && !(await confirmSpend({ title: "Track this Google Play app?", payer: "Apify", usd: PLAY_REFRESH_USD,
      rows: [["Reads now", "Its newest 150 Google Play reviews"]], note: "Each refresh later costs the same. App Store apps are free." }))) return;
    setState("busy");
    const answer = await marketAction<{ appId?: string; refreshed?: { error?: string } }>(productId, "track", body);
    if (answer.error) { setState("idle"); await notice(answer.error, "Couldn't track this app"); return; }
    setState("done");
    await onTracked();
    if (answer.refreshed?.error) await notice(answer.refreshed.error, "Tracked, but its reviews couldn't be read yet");
  };
  if (state === "done") return <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-win"><IconCheck className="size-3.5" />Tracked</span>;
  return <Button size="sm" variant="secondary" onClick={track} disabled={state === "busy"}>{state === "busy" ? <Spinner className="size-3" /> : <IconPlus />}{state === "busy" ? "Reading…" : "Track"}</Button>;
}

/** The competitors on the product's list that have no app tracked yet: find their App Store apps. */
function Suggestions({ productId, competitors, onTracked }: { productId: string; competitors: string[]; onTracked: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<{ suggestions: { competitor: string; app: FoundApp }[]; missed: string[]; country: string } | null>(null);
  const find = async () => {
    setBusy(true);
    const answer = await marketAction<{ suggestions?: { competitor: string; app: FoundApp }[]; missed?: string[]; country?: string }>(productId, "suggest", { country: "us" });
    setBusy(false);
    if (answer.error) { await notice(answer.error, "Couldn't look up your competitors' apps"); return; }
    setFound({ suggestions: answer.suggestions ?? [], missed: answer.missed ?? [], country: answer.country ?? "us" });
  };
  const names = competitors.slice(0, 4).join(", ") + (competitors.length > 4 ? ` and ${competitors.length - 4} more` : "");
  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-title font-medium">From your competitor list</h2>
          <p className="text-caption text-muted">{names} {competitors.length === 1 ? "has" : "have"} no app tracked yet.</p>
        </div>
        {!found && <Button size="sm" variant="secondary" onClick={find} disabled={busy}>{busy ? <Spinner className="size-3" /> : <IconSearch />}{busy ? "Looking…" : "Find their apps"}</Button>}
      </div>
      {found && (
        <>
          {found.suggestions.length > 0 && <ul className="mt-2">{found.suggestions.map((s) => <FoundRow key={s.app.storeId} productId={productId} app={s.app} competitor={s.competitor} country={found.country} onTracked={onTracked} />)}</ul>}
          {found.missed.length > 0 && <p className="mt-2 text-xs text-muted">No App Store app clearly belongs to {found.missed.join(", ")}. Use Track an app with their exact app name or link.</p>}
          {!found.suggestions.length && !found.missed.length && <p className="mt-2 text-xs text-muted">Their apps are already tracked.</p>}
        </>
      )}
    </section>
  );
}

// MARK: Top charts

interface ChartAnswer { rows?: ChartRow[]; label?: string; error?: string }

function ChartsTab({ productId, overview, reload }: { productId: string; overview: MarketOverview; reload: () => Promise<unknown> }) {
  const features = useFeatures(productId);
  const ai = features.state("market.summary");
  const [kind, setKind] = useState<ChartKind>("grossing");
  const [genre, setGenre] = useState("");
  const [country, setCountry] = useState("us");
  const [chart, setChart] = useState<{ key: string; answer: ChartAnswer } | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const key = `${kind}:${genre || "all"}:${country}`;
  const genreName = GENRES.find((g) => g.value === genre)?.label ?? "All apps";

  useEffect(() => {
    let live = true;
    marketAction<ChartAnswer>(productId, "charts", { kind, genre, country, genreName }).then((answer) => { if (live) setChart({ key, answer }); });
    return () => { live = false; };
  }, [productId, kind, genre, country, genreName, key]);

  const loading = !chart || chart.key !== key;
  const rows = chart?.answer.rows ?? [];
  const stored = overview.summaries.find((s) => s.kind === "category" && s.scope === key)?.summary as ChartSummary | undefined;

  const summarize = async () => {
    if (!(await confirmSpend({ title: stored ? "Read this chart again?" : "Summarize this chart?", payer: "OpenAI", usd: chartSummaryUsd(),
      rows: [["Reads", `The top 50 in ${genreName}`], ["Writes", "What they share, how they charge, and the gaps"]] }))) return;
    setSummarizing(true);
    const answer = await marketAction(productId, "chart-summary", { kind, genre, country, genreName });
    setSummarizing(false);
    if (answer.error) { await notice(answer.error, "Couldn't summarize this chart"); return; }
    await reload();
  };

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented options={CHART_KINDS.map((k) => ({ value: k.value, label: k.label }))} value={kind} onChange={setKind} label="Chart" />
        <SelectPill label="Category" value={genre} onChange={setGenre} options={GENRES} />
        <SelectPill label="Country" value={country} onChange={setCountry} options={COUNTRIES} />
      </div>
      <p className="-mt-2 text-sm text-muted">{CHART_KINDS.find((k) => k.value === kind)?.why}</p>

      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-1.5 text-title font-medium"><IconSparkles className="size-3.5 text-accent" />What wins in this chart</h2>
            <p className="text-caption text-muted">{stored ? `Read ${ago(overview.summaries.find((s) => s.scope === key)?.created_at)}: patterns, pricing and gaps in the top 50.` : "The AI reads the top 50: what they have in common, how they charge, and where a new app could fit."}</p>
          </div>
          {ai.ok || ai.unknown
            ? <Button size="sm" variant="secondary" onClick={summarize} disabled={summarizing || loading || !rows.length}>{summarizing ? <Spinner className="size-3" /> : <IconSparkles />}{summarizing ? "Reading…" : stored ? "Read again" : "Summarize"}</Button>
            : <FeatureLock state={ai} />}
        </div>
        {stored && <ChartSummaryView summary={stored} />}
      </Card>

      {loading
        ? <div className="flex items-center gap-2 py-6 text-sm text-muted"><Spinner className="size-3.5" />Reading the chart…</div>
        : chart.answer.error
          ? <ErrorNote>{chart.answer.error}</ErrorNote>
          : !rows.length
            ? <EmptyState icon={<IconTrendUp />} title="This chart is empty" body="The App Store has no chart for this category in this country right now. Try another one." />
            : <ChartList productId={productId} rows={rows} country={country} onTracked={reload} />}
    </div>
  );
}

function ChartSummaryView({ summary }: { summary: ChartSummary }) {
  return (
    <div className="mt-4 grid gap-4 border-t border-line pt-4">
      {summary.overview && <p className="text-sm">{summary.overview}</p>}
      {summary.patterns.length > 0 && (
        <ul className="grid gap-2.5">
          {summary.patterns.map((p) => (
            <li key={p.title}>
              <p className="text-sm font-medium">{p.title}</p>
              <p className="text-caption text-muted">{p.detail}{p.apps.length ? ` ${p.apps.join(", ")}.` : ""}</p>
            </li>
          ))}
        </ul>
      )}
      {summary.pricing && <p className="text-sm"><span className="font-medium">How they charge: </span><span className="text-label">{summary.pricing}</span></p>}
      {summary.gaps.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted">Openings</p>
          <ul className="mt-1 list-disc pl-5 text-sm text-label">{summary.gaps.map((g) => <li key={g}>{g}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

const chartGrid = "grid grid-cols-[20px_32px_minmax(0,1fr)_84px] items-center gap-x-3 sm:grid-cols-[20px_32px_minmax(0,1fr)_110px_84px] md:grid-cols-[20px_32px_minmax(0,1fr)_110px_80px_100px_84px]";

function ChartList({ productId, rows, country, onTracked }: { productId: string; rows: ChartRow[]; country: string; onTracked: () => Promise<unknown> }) {
  return (
    <section>
      <div className={cx(chartGrid, "h-8 border-b border-line text-xs text-muted")}>
        <span>#</span><span className="col-span-2">App</span>
        <span className="max-sm:hidden">Rating</span><span className="max-md:hidden">Price</span><span className="max-md:hidden">Updated</span><span />
      </div>
      <ol>
        {rows.map((row) => (
          <li key={row.storeId} className={cx(chartGrid, "-mx-2 min-h-12 rounded-control px-2 py-1.5 transition-colors hover:bg-hover")}>
            <span className="text-xs text-muted tabular-nums">{row.rank}</span>
            <AppIcon url={row.iconUrl} name={row.name} />
            <span className="min-w-0">
              {row.url
                ? <a href={row.url} target="_blank" rel="noreferrer" className="block truncate rounded-xs text-sm font-medium hover:underline">{row.name}</a>
                : <span className="block truncate text-sm font-medium">{row.name}</span>}
              <span className="block truncate text-caption text-muted">{row.developer}</span>
            </span>
            <Rating rating={row.rating} count={row.ratingCount} className="text-sm max-sm:hidden" />
            <span className="truncate text-sm text-label max-md:hidden">{row.priceLabel ?? "–"}</span>
            <span className="truncate text-xs text-muted max-md:hidden">{row.updatedAt ? ago(row.updatedAt) : "–"}</span>
            {row.trackedId
              ? <Link href={`${workspaceHref(productId, "market")}/${row.trackedId}`} className="shrink-0 justify-self-end rounded-xs text-xs font-medium text-accent hover:underline">Tracked</Link>
              : <span className="justify-self-end"><TrackButton productId={productId} body={{ store: "app_store", storeId: row.storeId, country }} onTracked={onTracked} /></span>}
          </li>
        ))}
      </ol>
    </section>
  );
}

// MARK: Opportunities

const KIND_LABEL: Record<Opportunity["kind"], string> = { complaints: "Complaint", requests: "Request", pricing: "Price" };

function OpportunitiesTab({ productId, overview, openApps }: { productId: string; overview: MarketOverview; openApps: () => void }) {
  const features = useFeatures(productId);
  const ai = features.state("market.summary");
  const summaries = useMemo(() => appSummaries(overview), [overview]);
  const list = useMemo(() => opportunities(summaries), [summaries]);
  const pending = overview.apps.filter((a) => !summaries.some((s) => s.appId === a.id));

  if (!overview.apps.length) {
    return <EmptyState icon={<IconSparkles />} title="Track a few competitors' apps first"
      body="Opportunities are the complaints and requests their users share. Track two or three apps, summarize their reviews, and the gaps show up here, ranked."
      action={<Button size="sm" onClick={openApps}>See competitors&apos; apps</Button>} />;
  }
  if (!list.length) {
    return (
      <EmptyState icon={<IconSparkles />} title="No review summaries yet"
        body="Open a tracked app and summarize its reviews. Its users' complaints and requests show up here, ranked across every app you track."
        action={ai.ok || ai.unknown ? <ButtonLink href={`${workspaceHref(productId, "market")}/${overview.apps[0].id}`} size="sm">Open {overview.apps[0].name}</ButtonLink> : <FeatureLock state={ai} />} />
    );
  }
  return (
    <div className="grid gap-5">
      <p className="text-sm text-muted">
        What reviewers of {summaries.length} app{summaries.length === 1 ? "" : "s"} keep complaining about or asking for, the ones shared by most apps first. Each is a gap a new app could fill.
        {pending.length > 0 && <> {pending.length} tracked app{pending.length === 1 ? " has" : "s have"} no summary yet: {pending.slice(0, 3).map((a, i) => <span key={a.id}>{i > 0 && ", "}<Link href={`${workspaceHref(productId, "market")}/${a.id}`} className="rounded-xs font-medium text-accent hover:underline">{a.name}</Link></span>)}.</>}
      </p>
      <ol className="divide-y divide-line">
        {list.map((o, i) => (
          <li key={`${o.kind}:${o.theme}`} className="grid grid-cols-[24px_minmax(0,1fr)] gap-x-3 py-4">
            <span className="pt-px text-xs text-muted tabular-nums">{i + 1}</span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium">{o.theme}</p>
                <Badge tone={o.kind === "complaints" ? "warn" : o.kind === "pricing" ? "caution" : "accent"}>{KIND_LABEL[o.kind]}</Badge>
              </div>
              {o.detail && <p className="mt-0.5 text-caption text-muted">{o.detail}</p>}
              <p className="mt-1 text-xs text-muted">{o.count} review{o.count === 1 ? "" : "s"} across {o.apps.length} app{o.apps.length === 1 ? "" : "s"}: {o.apps.map((a) => a.name).join(", ")}</p>
              <ul className="mt-2.5 grid gap-2">{o.quotes.map((q) => <QuoteLine key={`${q.appName}:${q.reviewId}`} text={q.text} rating={q.rating} version={q.version} source={q.appName} />)}</ul>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

// Keeps the overview fresh after an action elsewhere (the detail page's refresh or summary).
export const reloadMarket = (productId: string) => refreshCached(marketUrl(productId)).catch(() => undefined);
