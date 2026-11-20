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
import { researchHref } from "@/lib/nav-model";
import { useT } from "@/lib/i18n/client";
import { sentenceGap } from "@/lib/i18n/join";
import { m } from "@/lib/i18n/translate";
import { IconCheck, IconPlus, IconSearch, IconSparkles, IconTrendUp, IconX } from "../icons";
import { Badge, Button, ButtonLink, Card, cx, EmptyState, ErrorNote, Page, SearchField, Segmented, SelectPill, Spinner } from "../ui";
import { AppIcon, marketAction, marketUrl, NotSetUp, QuoteLine, Rating } from "./parts";

type Tab = "apps" | "charts" | "opportunities";
const TABS: { value: Tab; label: string }[] = [{ value: "apps", label: m("Competitors' apps") }, { value: "charts", label: m("Top charts") }, { value: "opportunities", label: m("Opportunities") }];
/** A list of choices with their labels in the page's language. */
const translated = <T extends { label: string }>(options: T[], t: (text: string) => string) => options.map((o) => ({ ...o, label: t(o.label) }));

export function MarketView({ productId }: { productId: string }) {
  const { t } = useT();
  const params = useSearchParams();
  const [tab, setTabState] = useState<Tab>(() => (TABS.some((x) => x.value === params.get("tab")) ? params.get("tab") as Tab : "apps"));
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
    <ProductPageHeader productId={productId} page="Research" subtitle={t("Your competitors' apps in the stores: ratings, prices, how often they ship, the top charts, and what their users love and hate.")}
      actions={ready && tab === "apps" && !tracking && overview.apps.length > 0 ? <Button size="sm" onClick={() => setTracking(true)}><IconPlus />{t("Track an app")}</Button> : undefined} />
  );

  if (!overview) return <Page>{header}<MarketBodySkeleton /></Page>;
  if (overview.error) return <Page>{header}<ErrorNote>{overview.error}</ErrorNote></Page>;
  if (!overview.setup) return <Page>{header}<NotSetUp message={overview.message} /></Page>;

  return (
    <Page>
      {header}
      <Segmented options={translated(TABS, t)} value={tab} onChange={setTab} label={t("App stores")} className="mb-5" />
      {tab === "apps" && <AppsTab productId={productId} overview={overview} tracking={tracking} setTracking={setTracking} reload={reload} />}
      {tab === "charts" && <ChartsTab productId={productId} overview={overview} reload={reload} />}
      {tab === "opportunities" && <OpportunitiesTab productId={productId} overview={overview} openApps={() => setTab("apps")} />}
    </Page>
  );
}

// MARK: Competitors' apps

function AppsTab({ productId, overview, tracking, setTracking, reload }: { productId: string; overview: MarketOverview; tracking: boolean; setTracking: (v: boolean) => void; reload: () => Promise<unknown> }) {
  const { t } = useT();
  const untracked = untrackedCompetitors(overview.competitors, overview.apps);
  return (
    <div className="grid gap-8">
      {tracking && <TrackPanel productId={productId} onClose={() => setTracking(false)} onTracked={reload} />}
      {untracked.length > 0 && <Suggestions productId={productId} competitors={untracked} onTracked={reload} />}
      {overview.apps.length
        ? <AppList productId={productId} apps={overview.apps} />
        : !tracking && (
          <EmptyState icon={<IconTrendUp />} title={t("No competitor apps yet")}
            body={t("Track a competitor's app to see its rating, price, how often it ships and what its users love and hate. Start with an App Store link or a name, or pick one from Top charts.")}
            action={<Button size="sm" onClick={() => setTracking(true)}><IconPlus />{t("Track an app")}</Button>} />
        )}
    </div>
  );
}

// Fixed widths: every row is its own grid, so its columns line up only if none sizes to its content.
const rowGrid = "grid grid-cols-[32px_minmax(0,1fr)_120px] items-center gap-x-3 sm:grid-cols-[32px_minmax(0,1fr)_110px_120px] md:grid-cols-[32px_minmax(0,1fr)_110px_140px_150px]";

function AppList({ productId, apps }: { productId: string; apps: MarketApp[] }) {
  const tr = useT();
  const { t } = tr;
  return (
    <section>
      <div className={cx(rowGrid, "h-8 border-b border-line text-xs text-muted")}>
        <span className="col-span-2">{t("App")}</span>
        <span className="max-sm:hidden">{t("Rating")}</span>
        <span className="max-md:hidden">{t("Price")}</span>
        <span className="text-right md:text-left">{t("Version")}</span>
      </div>
      <ul>
        {apps.map((app) => (
          <li key={app.id}>
            <Link href={`${researchHref(productId, "app-store")}/${app.id}`} className={cx(rowGrid, "-mx-2 min-h-12 rounded-control px-2 py-1.5 transition-colors hover:bg-hover")}>
              <AppIcon url={app.icon_url} name={app.name} />
              <span className="min-w-0">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm font-medium">{app.name}</span>
                  {app.store === "google_play" && <Badge className="max-sm:hidden">Google Play</Badge>}
                </span>
                <span className="block truncate text-caption text-muted">
                  {app.chart_rank && app.chart_label && <span className="font-medium text-accent">{t("#{rank} in {chart}", { rank: String(app.chart_rank), chart: app.chart_label })}{app.developer && " · "}</span>}
                  {(app.chart_rank && app.chart_label ? [app.developer] : [app.developer, app.category]).filter(Boolean).join(" · ") || (app.chart_rank ? "" : app.store_id)}
                </span>
              </span>
              <Rating rating={app.rating} count={app.rating_count} className="text-sm max-sm:hidden" />
              <span className="truncate text-sm text-label max-md:hidden">{priceText(app, tr) || "–"}</span>
              <span className="min-w-0 text-right md:text-left">
                <span className="block truncate text-sm text-label tabular-nums">{app.version ? `v${app.version}` : "–"}</span>
                <span className="block truncate text-xs text-muted">{app.store_updated_at ? t("updated {ago}", { ago: ago(app.store_updated_at, undefined, tr) }) : app.refreshed_at ? t("read {ago}", { ago: ago(app.refreshed_at, undefined, tr) }) : t("not read yet")}</span>
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
  const { t } = useT();
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
    const answer = await marketAction<{ results?: FoundApp[]; play?: { pkg: string; available: boolean } | null }>(productId, "search", { query, country }, t);
    setBusy(false);
    if (answer.error) { setError(answer.error); setFound(null); return; }
    setFound({ results: answer.results ?? [], play: answer.play ?? null });
  };

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-title font-medium">{t("Track an app")}</h2>
          <p className="mt-0.5 text-caption text-muted">{t("Type a name, or paste an App Store link. Each app is read once now, then whenever you refresh it.")}</p>
        </div>
        <button type="button" onClick={onClose} aria-label={t("Close")} className="grid size-7 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-hover hover:text-ink"><IconX className="size-3.5" /></button>
      </div>
      <form onSubmit={search} className="mt-3 flex flex-wrap items-center gap-2">
        <SearchField autoFocus value={query} onChange={(e) => setQuery(e.target.value)} aria-label={t("App name or link")} className="min-w-0 flex-[1_1_240px]" />
        <SelectPill label={t("Store country")} value={country} onChange={setCountry} options={translated(COUNTRIES, t)} />
        <Button type="submit" variant="secondary" disabled={busy || !query.trim()}>{busy ? <Spinner className="size-3.5" /> : <IconSearch />}{t("Find")}</Button>
      </form>
      {play.ok || play.unknown
        ? <p className="mt-2 text-xs text-muted">{t("Google Play has no free official API: paste a Play link and its reviews are read through Apify, with your Apify token.")}</p>
        : <FeatureLock state={play} className="mt-2" />}
      {error && <ErrorNote className="mt-3 mb-0">{error}</ErrorNote>}
      {found && (
        found.play
          ? <PlayResult productId={productId} pkg={found.play.pkg} available={found.play.available} country={country} onTracked={onTracked} />
          : found.results.length
            ? <ul className="mt-3">{found.results.map((app) => <FoundRow key={`${app.store}:${app.storeId}`} productId={productId} app={app} country={country} onTracked={onTracked} />)}</ul>
            : <p className="mt-3 text-sm text-muted">{t("No apps found in the {country} store. Try another name, or paste the app's link.", { country: t(COUNTRIES.find((c) => c.value === country)?.label ?? country) })}</p>
      )}
    </Card>
  );
}

function PlayResult({ productId, pkg, available, country, onTracked }: { productId: string; pkg: string; available: boolean; country: string; onTracked: () => Promise<unknown> }) {
  const { t } = useT();
  const [name, setName] = useState("");
  if (!available) return <p className="mt-3 text-sm text-muted">{t("Add your Apify token in Settings › Your keys to track this Google Play app ({pkg}). App Store apps need no key.", { pkg })}</p>;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <input value={name} onChange={(e) => setName(e.target.value)} aria-label={t("The app's name")} placeholder={t("The app's name")} className="h-[30px] min-w-0 flex-[1_1_200px] rounded-control border border-hairline bg-raised px-2.5 text-sm outline-none focus:border-focus/70 focus:ring-2 focus:ring-focus/20" />
      <TrackButton productId={productId} body={{ store: "google_play", storeId: pkg, name: name.trim() || pkg, country }} onTracked={onTracked} />
      <span className="w-full text-xs text-muted">{pkg} · {t("reviews only (the newest 150 per refresh, a few cents of Apify credit)")}</span>
    </div>
  );
}

function FoundRow({ productId, app, country, competitor, onTracked }: { productId: string; app: FoundApp; country: string; competitor?: string; onTracked: () => Promise<unknown> }) {
  const { t } = useT();
  return (
    <li className="-mx-2 flex min-h-12 items-center gap-3 rounded-control px-2 py-1.5 transition-colors hover:bg-hover">
      <AppIcon url={app.iconUrl} name={app.name} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{app.name}</span>
        <span className="block truncate text-caption text-muted">{[competitor && t("For {name}", { name: competitor }), app.developer, app.category, app.priceLabel].filter(Boolean).join(" · ")}</span>
      </span>
      <Rating rating={app.rating} count={app.ratingCount} className="text-sm max-sm:hidden" />
      {app.trackedId
        ? <Link href={`${researchHref(productId, "app-store")}/${app.trackedId}`} className="shrink-0 rounded-xs text-xs font-medium text-accent hover:underline">{t("Tracked")}</Link>
        : <TrackButton productId={productId} body={{ store: app.store, storeId: app.storeId, country, competitor }} onTracked={onTracked} />}
    </li>
  );
}

/** Tracks one app (it is read straight away, which takes a few seconds). */
function TrackButton({ productId, body, onTracked }: { productId: string; body: Record<string, unknown>; onTracked: () => Promise<unknown> }) {
  const { t } = useT();
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const track = async () => {
    // A Google Play app is read through Apify straight away: say what that costs first.
    if (body.store === "google_play" && !(await confirmSpend({ title: t("Track this Google Play app?"), payer: "Apify", usd: PLAY_REFRESH_USD,
      rows: [[t("Reads now"), t("Its newest 150 Google Play reviews")]], note: t("Each refresh later costs the same. App Store apps are free.") }))) return;
    setState("busy");
    const answer = await marketAction<{ appId?: string; refreshed?: { error?: string } }>(productId, "track", body, t);
    if (answer.error) { setState("idle"); await notice(answer.error, t("Couldn't track this app")); return; }
    setState("done");
    await onTracked();
    if (answer.refreshed?.error) await notice(answer.refreshed.error, t("Tracked, but its reviews couldn't be read yet"));
  };
  if (state === "done") return <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-win"><IconCheck className="size-3.5" />{t("Tracked")}</span>;
  return <Button size="sm" variant="secondary" onClick={track} disabled={state === "busy"}>{state === "busy" ? <Spinner className="size-3" /> : <IconPlus />}{state === "busy" ? t("Reading…") : t("Track")}</Button>;
}

/** The competitors on the product's list that have no app tracked yet: find their App Store apps. */
function Suggestions({ productId, competitors, onTracked }: { productId: string; competitors: string[]; onTracked: () => Promise<unknown> }) {
  const { t, tn } = useT();
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<{ suggestions: { competitor: string; app: FoundApp }[]; missed: string[]; country: string } | null>(null);
  const find = async () => {
    setBusy(true);
    const answer = await marketAction<{ suggestions?: { competitor: string; app: FoundApp }[]; missed?: string[]; country?: string }>(productId, "suggest", { country: "us" }, t);
    setBusy(false);
    if (answer.error) { await notice(answer.error, t("Couldn't look up your competitors' apps")); return; }
    setFound({ suggestions: answer.suggestions ?? [], missed: answer.missed ?? [], country: answer.country ?? "us" });
  };
  const first = competitors.slice(0, 4).join(", ");
  const names = competitors.length > 4 ? t("{names} and {n} more", { names: first, n: competitors.length - 4 }) : first;
  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-title font-medium">{t("From your competitor list")}</h2>
          <p className="text-caption text-muted">{tn(competitors.length, "{names} has no app tracked yet.", "{names} have no app tracked yet.", { names })}</p>
        </div>
        {!found && <Button size="sm" variant="secondary" onClick={find} disabled={busy}>{busy ? <Spinner className="size-3" /> : <IconSearch />}{busy ? t("Looking…") : t("Find their apps")}</Button>}
      </div>
      {found && (
        <>
          {found.suggestions.length > 0 && <ul className="mt-2">{found.suggestions.map((s) => <FoundRow key={s.app.storeId} productId={productId} app={s.app} competitor={s.competitor} country={found.country} onTracked={onTracked} />)}</ul>}
          {found.missed.length > 0 && <p className="mt-2 text-xs text-muted">{t("No App Store app clearly belongs to {names}. Use Track an app with their exact app name or link.", { names: found.missed.join(", ") })}</p>}
          {!found.suggestions.length && !found.missed.length && <p className="mt-2 text-xs text-muted">{t("Their apps are already tracked.")}</p>}
        </>
      )}
    </section>
  );
}

// MARK: Top charts

interface ChartAnswer { rows?: ChartRow[]; label?: string; error?: string }

function ChartsTab({ productId, overview, reload }: { productId: string; overview: MarketOverview; reload: () => Promise<unknown> }) {
  const tr = useT();
  const { t } = tr;
  const features = useFeatures(productId);
  const ai = features.state("market.summary");
  const [kind, setKind] = useState<ChartKind>("grossing");
  const [genre, setGenre] = useState("");
  const [country, setCountry] = useState("us");
  const [chart, setChart] = useState<{ key: string; answer: ChartAnswer } | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const key = `${kind}:${genre || "all"}:${country}`;
  // English for the backend (it labels the chart and the AI's read with it); the page shows t(genreName).
  const genreName = GENRES.find((g) => g.value === genre)?.label ?? "All apps";

  useEffect(() => {
    let live = true;
    marketAction<ChartAnswer>(productId, "charts", { kind, genre, country, genreName }, t).then((answer) => { if (live) setChart({ key, answer }); });
    return () => { live = false; };
  }, [productId, kind, genre, country, genreName, key, t]);

  const loading = !chart || chart.key !== key;
  const rows = chart?.answer.rows ?? [];
  const stored = overview.summaries.find((s) => s.kind === "category" && s.scope === key)?.summary as ChartSummary | undefined;

  const summarize = async () => {
    if (!(await confirmSpend({ title: stored ? t("Read this chart again?") : t("Summarize this chart?"), payer: "OpenAI", usd: chartSummaryUsd(),
      rows: [[t("Reads"), t("The top 50 in {category}", { category: t(genreName) })], [t("Writes"), t("What they share, how they charge, and the gaps")]] }))) return;
    setSummarizing(true);
    const answer = await marketAction(productId, "chart-summary", { kind, genre, country, genreName }, t);
    setSummarizing(false);
    if (answer.error) { await notice(answer.error, t("Couldn't summarize this chart")); return; }
    await reload();
  };

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented options={CHART_KINDS.map((k) => ({ value: k.value, label: t(k.label) }))} value={kind} onChange={setKind} label={t("Chart")} />
        <SelectPill label={t("Category")} value={genre} onChange={setGenre} options={translated(GENRES, t)} />
        <SelectPill label={t("Country")} value={country} onChange={setCountry} options={translated(COUNTRIES, t)} />
      </div>
      <p className="-mt-2 text-sm text-muted">{t(CHART_KINDS.find((k) => k.value === kind)?.why ?? "")}</p>

      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-1.5 text-title font-medium"><IconSparkles className="size-3.5 text-accent" />{t("What wins in this chart")}</h2>
            <p className="text-caption text-muted">{stored ? t("Read {ago}: patterns, pricing and gaps in the top 50.", { ago: ago(overview.summaries.find((s) => s.scope === key)?.created_at, undefined, tr) }) : t("The AI reads the top 50: what they have in common, how they charge, and where a new app could fit.")}</p>
          </div>
          {ai.ok || ai.unknown
            ? <Button size="sm" variant="secondary" onClick={summarize} disabled={summarizing || loading || !rows.length}>{summarizing ? <Spinner className="size-3" /> : <IconSparkles />}{summarizing ? t("Reading…") : stored ? t("Read again") : t("Summarize")}</Button>
            : <FeatureLock state={ai} />}
        </div>
        {stored && <ChartSummaryView summary={stored} />}
      </Card>

      {loading
        ? <div className="flex items-center gap-2 py-6 text-sm text-muted"><Spinner className="size-3.5" />{t("Reading the chart…")}</div>
        : chart.answer.error
          ? <ErrorNote>{chart.answer.error}</ErrorNote>
          : !rows.length
            ? <EmptyState icon={<IconTrendUp />} title={t("This chart is empty")} body={t("The App Store has no chart for this category in this country right now. Try another one.")} />
            : <ChartList productId={productId} rows={rows} country={country} onTracked={reload} />}
    </div>
  );
}

function ChartSummaryView({ summary }: { summary: ChartSummary }) {
  const { t } = useT();
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
      {summary.pricing && <p className="text-sm"><span className="font-medium">{t("How they charge:")} </span><span className="text-label">{summary.pricing}</span></p>}
      {summary.gaps.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted">{t("Openings")}</p>
          <ul className="mt-1 list-disc pl-5 text-sm text-label">{summary.gaps.map((g) => <li key={g}>{g}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

const chartGrid = "grid grid-cols-[20px_32px_minmax(0,1fr)_96px] items-center gap-x-3 sm:grid-cols-[20px_32px_minmax(0,1fr)_110px_96px] md:grid-cols-[20px_32px_minmax(0,1fr)_110px_80px_100px_96px]";

function ChartList({ productId, rows, country, onTracked }: { productId: string; rows: ChartRow[]; country: string; onTracked: () => Promise<unknown> }) {
  const tr = useT();
  const { t } = tr;
  return (
    <section>
      <div className={cx(chartGrid, "h-8 border-b border-line text-xs text-muted")}>
        <span>#</span><span className="col-span-2">{t("App")}</span>
        <span className="max-sm:hidden">{t("Rating")}</span><span className="max-md:hidden">{t("Price")}</span><span className="max-md:hidden">{t("Updated")}</span><span />
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
            <span className="truncate text-xs text-muted max-md:hidden">{row.updatedAt ? ago(row.updatedAt, undefined, tr) : "–"}</span>
            {row.trackedId
              ? <Link href={`${researchHref(productId, "app-store")}/${row.trackedId}`} className="shrink-0 justify-self-end rounded-xs text-xs font-medium text-accent hover:underline">{t("Tracked")}</Link>
              : <span className="justify-self-end"><TrackButton productId={productId} body={{ store: "app_store", storeId: row.storeId, country }} onTracked={onTracked} /></span>}
          </li>
        ))}
      </ol>
    </section>
  );
}

// MARK: Opportunities

const KIND_LABEL: Record<Opportunity["kind"], string> = { complaints: m("Complaint"), requests: m("Request"), pricing: m("Price") };

function OpportunitiesTab({ productId, overview, openApps }: { productId: string; overview: MarketOverview; openApps: () => void }) {
  const { t, tn, locale } = useT();
  // Chinese and Japanese: no spaces between sentences, 、 between names and 。 at the end.
  const gap = sentenceGap(locale), cjk = gap === "";
  const features = useFeatures(productId);
  const ai = features.state("market.summary");
  const summaries = useMemo(() => appSummaries(overview), [overview]);
  const list = useMemo(() => opportunities(summaries), [summaries]);
  const pending = overview.apps.filter((a) => !summaries.some((s) => s.appId === a.id));

  if (!overview.apps.length) {
    return <EmptyState icon={<IconSparkles />} title={t("Track a few competitors' apps first")}
      body={t("Opportunities are the complaints and requests their users share. Track two or three apps, summarize their reviews, and the gaps show up here, ranked.")}
      action={<Button size="sm" onClick={openApps}>{t("See competitors' apps")}</Button>} />;
  }
  if (!list.length) {
    return (
      <EmptyState icon={<IconSparkles />} title={t("No review summaries yet")}
        body={t("Open a tracked app and summarize its reviews. Its users' complaints and requests show up here, ranked across every app you track.")}
        action={ai.ok || ai.unknown ? <ButtonLink href={`${researchHref(productId, "app-store")}/${overview.apps[0].id}`} size="sm">{t("Open {name}", { name: overview.apps[0].name })}</ButtonLink> : <FeatureLock state={ai} />} />
    );
  }
  return (
    <div className="grid gap-5">
      <p className="text-sm text-muted">
        {tn(summaries.length, "What reviewers of {n} app keep complaining about or asking for, the ones shared by most apps first. Each is a gap a new app could fill.", "What reviewers of {n} apps keep complaining about or asking for, the ones shared by most apps first. Each is a gap a new app could fill.")}
        {pending.length > 0 && <>{gap}{tn(pending.length, "{n} tracked app has no summary yet:", "{n} tracked apps have no summary yet:")}{gap}{pending.slice(0, 3).map((a, i) => <span key={a.id}>{i > 0 && (cjk ? "、" : ", ")}<Link href={`${researchHref(productId, "app-store")}/${a.id}`} className="rounded-xs font-medium text-accent hover:underline">{a.name}</Link></span>)}{cjk ? "。" : "."}</>}
      </p>
      <ol className="divide-y divide-line">
        {list.map((o, i) => (
          <li key={`${o.kind}:${o.theme}`} className="grid grid-cols-[24px_minmax(0,1fr)] gap-x-3 py-4">
            <span className="pt-px text-xs text-muted tabular-nums">{i + 1}</span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium">{o.theme}</p>
                <Badge tone={o.kind === "complaints" ? "warn" : o.kind === "pricing" ? "caution" : "accent"}>{t(KIND_LABEL[o.kind])}</Badge>
              </div>
              {o.detail && <p className="mt-0.5 text-caption text-muted">{o.detail}</p>}
              <p className="mt-1 text-xs text-muted">{t("{reviews} across {apps}: {names}", { reviews: tn(o.count, "{n} review", "{n} reviews"), apps: tn(o.apps.length, "{n} app", "{n} apps"), names: o.apps.map((a) => a.name).join(", ") })}</p>
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
