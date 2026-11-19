"use client";
// The Measure page: a product's paid growth in one place (Meta spend and delivery, AppStack's and
// Meta's attributed conversions side by side, RevenueCat's money) with CAC, ROAS, LTV:CAC and payback
// worked out on the page and each formula one click away.
//
// Three sources, none of them required: each one that isn't connected shows where to connect it in
// place of its numbers, and the rest of the page works with what is there. With none connected the
// page is one "connect a source" state.
import Link from "next/link";
import { useMemo, useState } from "react";
import { notice } from "@/components/dialog";
import { IconCalendar, IconChart, IconDownload, IconRefresh } from "@/components/icons";
import { useFeatures } from "@/components/studio/features";
import { Button, ConnectState, ErrorNote, Locked, Page, SelectPill, Spinner, Thumb, cx, fmt } from "@/components/ui";
import { ProductPageHeader } from "@/components/workspace/product-header";
import { MeasureBodySkeleton } from "@/components/page-skeletons";
import { PlaybookTips } from "@/components/playbook-tip";
import type { FeatureState } from "@/lib/capabilities";
import { useCached } from "@/lib/client-cache";
import {
  addDays, alerts, blended, change, dayList, economics, groups, HOW, isMetaSource, metrics, money, RANGES, revenuecat, totals, truthFor, verdict,
  type Group, type Headline, type Level, type MeasureData, type Role, type Source, type Truth,
} from "@/lib/measure";
import { BandLegend, BandLine, HatchedBars, Readout, SplitBar, TargetGauge, TargetTrack, Waterfall } from "./charts";
import { DeltaChip, HowLabel, KeyValue, Kpi, NeedsYou, Panel, PanelHead, Segmented, SourceDot, StatusChip, type NeedsYouItem } from "./kit";

type Conversion = "installs" | "trials" | "purchases";
const CONVERSION_LABEL: Record<Conversion, string> = { installs: "Installs", trials: "Trials", purchases: "Paying customers" };
const SOURCE_LABEL: Record<Source, string> = { meta: "Meta", appstack: "AppStack", revenuecat: "RevenueCat" };
const SOURCES: Source[] = ["meta", "revenuecat", "appstack"];
const SOURCE_GIVES: Record<Source, string> = { meta: "Ad spend, delivery and cost per customer", revenuecat: "Trials, purchases and revenue", appstack: "Installs and customers for each ad" };
const SOURCE_FEATURE = { meta: "measure.meta", revenuecat: "measure.revenuecat", appstack: "measure.appstack" } as const;
const SUBTITLE = "What your ads cost next to what they earn: spend, installs, trials and revenue, with CAC, ROAS, LTV:CAC and payback.";

/** Where to connect a source that isn't connected yet, in the words the page shows. */
type Gate = Pick<FeatureState, "title" | "body" | "href" | "action">;
type Gates = Record<Source, Gate | null>;

// When the install can't be read, the data itself says what is missing (the backend's health check and the app's saved IDs).
const SOURCE_READS: Record<Source, string> = { meta: "read ad spend from Meta", revenuecat: "read trials and revenue from RevenueCat", appstack: "read installs from AppStack" };
const SOURCE_ID: Record<Source, string> = { meta: "your Meta ad account", revenuecat: "your RevenueCat project", appstack: "your AppStack app" };
function gateFromData(data: MeasureData, s: Source): Gate | null {
  const row = data.sync[s];
  if (row && row.status !== "not_connected") return null;
  if (data.health && !data.health[s]) return { title: `Connect ${SOURCE_LABEL[s]} to ${SOURCE_READS[s]}`, body: "Add the key in Settings > API keys. It is checked when you save it.", href: "/app/settings/keys", action: "Add the key" };
  if (!data.workspace.connected[s]) return { title: `Add ${SOURCE_ID[s]} to ${SOURCE_READS[s]}`, body: "Fill it in under this app's connections.", href: `/app/settings/apps/${data.workspace.id}`, action: "Open connections" };
  return null;
}
const LEVELS: { value: Level; label: string }[] = [
  { value: "campaign", label: "Campaigns" }, { value: "adset", label: "Ad sets" }, { value: "ad", label: "Ads" },
  { value: "creative", label: "Creatives" }, { value: "format", label: "Formats" }, { value: "hook", label: "Hooks" },
];
const ROLE_LABEL: Record<Role | "none", string> = { testing: "Testing campaign", scaling: "Scaling campaign", none: "No role yet" };

// MARK: Formatting

function moneyFormat(currency: string) {
  return (n: number) => {
    const abs = Math.abs(n);
    const options: Intl.NumberFormatOptions = abs >= 10_000 ? { notation: "compact", maximumFractionDigits: 1 } : abs >= 100 ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 };
    try { return new Intl.NumberFormat("en-US", { style: "currency", currency, ...options }).format(n); } catch { return `${fmt(n)} ${currency}`; }
  };
}
const count = (n: number | null | undefined) => (n == null ? "–" : n > 0 && n < 10 && n % 1 ? n.toFixed(1) : fmt(n));
const pct = (n: number | null | undefined, digits = 1) => (n == null ? "–" : `${(n * 100).toFixed(digits)}%`);
const times = (n: number | null | undefined) => (n == null ? "–" : `${n.toFixed(2)}×`);
const shortDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const ago = (iso: string) => {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  return minutes < 1 ? "just now" : minutes < 60 ? `${minutes} min ago` : minutes < 1440 ? `${Math.round(minutes / 60)} h ago` : `${Math.round(minutes / 1440)} d ago`;
};

// MARK: The model

/** Everything the page shows, worked out once per data load or settings change. */
function build(data: MeasureData) {
  const m = money(data);
  const rate = m.rate ?? 1;
  // Spend left in another currency (no exchange rate yet) can't be compared with RevenueCat's USD.
  const comparable = m.currency === "USD";
  const { headline, split } = truthFor(data);
  const { since, prevSince } = data.range;
  const inRange = (d: string) => d >= since;
  const inPrev = (d: string) => d >= prevSince && d < since;
  const metaCur = data.meta.filter((r) => inRange(r.date));
  const metaPrev = data.meta.filter((r) => inPrev(r.date));
  const paid = data.appstack.filter((r) => isMetaSource(r.media_source));
  const asCur = paid.filter((r) => inRange(r.date));
  const asPrev = paid.filter((r) => inPrev(r.date));
  const organicInstalls = data.appstack.filter((r) => inRange(r.date) && /organic/i.test(r.media_source)).reduce((s, r) => s + r.installs, 0);

  const t = totals(metaCur, asCur, rate);
  const tPrev = totals(metaPrev, asPrev, rate);
  const rc = revenuecat(data, data.revenuecat.filter((r) => inRange(r.date)));
  const rcPrev = revenuecat(data, data.revenuecat.filter((r) => inPrev(r.date)));
  const cur = metrics(t, split);
  const prev = metrics(tPrev, split);
  const bl = blended(t.spend, rc);
  const blPrev = blended(tPrev.spend, rcPrev);

  // The headline CAC counts the chosen source's customers; the range shows both attributions.
  const customers = headline === "revenuecat" ? rc.newPaid : t[headline].purchases;
  const customersPrev = headline === "revenuecat" ? rcPrev.newPaid : tPrev[headline].purchases;
  const cac = customers > 0 ? t.spend / customers : null;
  const cacPrev = customersPrev > 0 ? tPrev.spend / customersPrev : null;
  const econ = economics(data.settings, rc, comparable ? cac : null);
  const range = {
    meta: t.meta.purchases > 0 ? t.spend / t.meta.purchases : null,
    appstack: t.appstack.purchases > 0 ? t.spend / t.appstack.purchases : null,
  };

  const byLevel = (level: Level) => groups(data, level, metaCur, asCur, rate, split);
  const campaigns = byLevel("campaign");
  const creatives = byLevel("creative");

  // Where a paying customer's value goes: LTV, less what testing and scaling spend cost per customer.
  const roleSpend = { testing: 0, scaling: 0, none: 0 };
  for (const c of campaigns) roleSpend[c.role ?? "none"] += c.totals.spend;
  const budget = data.campaigns.filter((c) => c.status === "ACTIVE" && c.daily_budget).reduce((s, c) => s + (c.daily_budget ?? 0) * rate, 0);

  return { m, comparable, headline, split, t, tPrev, rc, rcPrev, cur, prev, bl, blPrev, customers, customersPrev, cac, cacPrev, econ, range, byLevel, campaigns, creatives, roleSpend, budget, organicInstalls, metaCur, asCur };
}

type Model = ReturnType<typeof build>;

// MARK: Page

export function MeasureView({ productId, name }: { productId: string; name: string }) {
  const [days, setDays] = useState<number>(28);
  const url = `/api/w/${productId}/measure?days=${days}`;
  const [data, reload] = useCached<MeasureData & { error?: string }>(url);
  const [syncing, setSyncing] = useState(false);
  const [level, setLevel] = useState<Level>("campaign");
  const [focus, setFocus] = useState<string | null>(null);
  const [conversion, setConversion] = useState<Conversion>("installs");
  const ready = data && !data.error ? data : null;
  const model = useMemo(() => (ready ? build(ready) : null), [ready]);
  const features = useFeatures(productId);
  const locks = useMemo<Record<Source, FeatureState | null>>(() => ({
    meta: features.locked(SOURCE_FEATURE.meta), revenuecat: features.locked(SOURCE_FEATURE.revenuecat), appstack: features.locked(SOURCE_FEATURE.appstack),
  }), [features]);
  const gates = useMemo<Gates>(() => ({
    meta: locks.meta ?? (ready ? gateFromData(ready, "meta") : null),
    revenuecat: locks.revenuecat ?? (ready ? gateFromData(ready, "revenuecat") : null),
    appstack: locks.appstack ?? (ready ? gateFromData(ready, "appstack") : null),
  }), [locks, ready]);

  async function save(body: Record<string, unknown>) {
    const response = await fetch(`/api/w/${productId}/measure`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!response.ok) notice((await response.json().catch(() => ({}))).error ?? "Couldn't save that.");
    await reload().catch(() => {});
  }

  async function sync() {
    setSyncing(true);
    const response = await fetch(`/api/w/${productId}/measure/sync`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const body = await response.json().catch(() => ({}));
    setSyncing(false);
    if (!response.ok) notice(body.error ?? "The sync didn't run.", "Sync didn't run");
    await reload().catch(() => {});
  }

  function show(nextLevel: Level, key?: string) {
    setLevel(nextLevel);
    setFocus(key ?? null);
    document.getElementById("measure-table")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // Nothing connected: the page is one state that lists the three sources and where each is connected.
  if (SOURCES.every((s) => locks[s])) {
    return (
      <Page>
        <ProductPageHeader productId={productId} page="Measure" name={name} subtitle={SUBTITLE} />
        <MeasureLocked locks={locks as Record<Source, FeatureState>} />
      </Page>
    );
  }

  return (
    <Page>
      <Header productId={productId} name={name} data={ready} gates={gates} days={days} setDays={setDays} syncing={syncing} onSync={sync} model={model} level={level} />
      {data?.error && <ErrorNote title="Measure can't load" className="mt-5">{data.error}</ErrorNote>}
      {!data && <MeasureBodySkeleton />}
      {ready && <PlaybookTips ids={["variance", "diagnose-by-layer", "cheap-installs", "headroom"]} className="mt-5" />}
      {ready && model && (
        <Body data={ready} model={model} gates={gates} save={save} sync={sync} syncing={syncing} level={level} setLevel={(l) => { setLevel(l); setFocus(null); }} focus={focus} show={show}
          conversion={conversion} setConversion={setConversion} />
      )}
    </Page>
  );
}

/** Measure with no source connected: what each of the three adds, and where to connect it. */
function MeasureLocked({ locks }: { locks: Record<Source, FeatureState> }) {
  // The button goes where most of the work is: the keys page while a key is missing, else the app's connections.
  const first = SOURCES.map((s) => locks[s]).find((lock) => lock.missingKeys.length) ?? locks.meta;
  return (
    <ConnectState icon={<IconChart />} title="Connect a source to see your numbers" href={first.href} action={first.missingKeys.length ? "Open API keys" : first.action}
      body={<>
        Measure puts what your ads cost next to what they earn. Any one of these is enough to start, and each adds its own numbers.
        <span className="mt-4 grid gap-px overflow-hidden rounded-card border border-line bg-line text-left">
          {SOURCES.map((s) => (
            <span key={s} className="flex items-center justify-between gap-4 bg-card px-3 py-2.5">
              <span className="min-w-0">
                <span className="block font-medium text-ink">{SOURCE_LABEL[s]}</span>
                <span className="block text-caption">{SOURCE_GIVES[s]}</span>
              </span>
              <Link href={locks[s].href} className="shrink-0 rounded-xs text-xs font-medium text-accent hover:underline">{locks[s].action}<span className="sr-only"> for {SOURCE_LABEL[s]}</span></Link>
            </span>
          ))}
        </span>
      </>} />
  );
}

function sourceState(data: MeasureData, gates: Gates, s: Source): "ok" | "error" | "off" | "unsynced" {
  if (gates[s]) return "off";
  const row = data.sync[s];
  if (row?.status === "ok") return "ok";
  if (row?.status === "error") return "error";
  return row?.status === "not_connected" ? "off" : "unsynced";
}

/** A source that isn't connected, inline: what connecting it gives, and the link to where. */
function GateLine({ gate, className }: { gate: Gate; className?: string }) {
  return <Locked href={gate.href} action={gate.action} className={className}>{gate.title}</Locked>;
}

function Header({ productId, name, data, gates, days, setDays, syncing, onSync, model, level }: { productId: string; name: string; data: MeasureData | null; gates: Gates; days: number; setDays: (d: number) => void; syncing: boolean; onSync: () => void; model: Model | null; level: Level }) {
  const last = data ? Object.values(data.sync).map((s) => s!.synced_at).sort().pop() : undefined;
  return (
    <ProductPageHeader productId={productId} page="Measure" name={name} className="mb-0"
      subtitle={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>{SUBTITLE}</span>
          {data && SOURCES.map((s) => {
            const state = sourceState(data, gates, s);
            return <SourceDot key={s} name={SOURCE_LABEL[s]} state={state} title={state === "off" ? `${SOURCE_LABEL[s]} isn't connected` : data.sync[s]?.message ?? (state === "unsynced" ? "Connected. Press Sync now." : undefined)} />;
          })}
          {last && <span className="text-xs text-faint">Synced {ago(last)}</span>}
        </span>
      }
      actions={<>
        <SelectPill icon={<IconCalendar />} label="Date range" value={String(days)} onChange={(value) => setDays(Number(value))} options={RANGES.map((r) => ({ value: String(r), label: `Last ${r} days` }))} />
        {data && <span className="hidden px-1 text-xs text-faint @3xl:inline">vs {shortDay(data.range.prevSince)} to {shortDay(addDays(data.range.since, -1))}</span>}
        <Button variant="secondary" onClick={onSync} disabled={syncing || !data}>
          {syncing ? <Spinner className="size-3.5" /> : <IconRefresh />}{syncing ? "Syncing…" : "Sync now"}
        </Button>
        <Button variant="secondary" onClick={() => model && data && exportCsv(model, data, level)} disabled={!model || !data?.meta.length}><IconDownload />Export</Button>
      </>} />
  );
}

// MARK: Body

interface BodyProps {
  data: MeasureData; model: Model; gates: Gates; save: (body: Record<string, unknown>) => Promise<void>; sync: () => void; syncing: boolean;
  level: Level; setLevel: (l: Level) => void; focus: string | null; show: (l: Level, key?: string) => void;
  conversion: Conversion; setConversion: (c: Conversion) => void;
}

function Body(props: BodyProps) {
  const { data, model, gates, save } = props;
  const $ = moneyFormat(model.m.currency);
  const usd = moneyFormat("USD");
  const hasAds = data.meta.length > 0 || data.campaigns.length > 0;
  const appstackOk = data.sync.appstack?.status === "ok";
  const rcOk = data.sync.revenuecat?.status === "ok";
  const choice = data.settings.cac_source;

  return (
    <>
      {/* Whose customers CAC counts only matters once there is spend to set them against. */}
      {hasAds && <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2">
        <HowLabel label={<span className="text-sm text-muted">Count paying customers from</span>} how="AppStack and Meta each attribute customers to the ads (AppStack can over-count, Meta under-counts on iOS); RevenueCat counts every new payer, organic included (blended). Per-ad numbers always use AppStack, or Meta when AppStack isn't connected." />
        <Segmented<Headline | "auto"> label="Source of truth for CAC" value={choice === "auto" ? model.headline : choice}
          onChange={(value) => save({ settings: { cac_source: value } })}
          options={[
            { value: "appstack", label: "AppStack", disabled: !appstackOk, title: appstackOk ? undefined : "AppStack isn't connected" },
            { value: "meta", label: "Meta" },
            { value: "revenuecat", label: "RevenueCat (blended)", disabled: !rcOk, title: rcOk ? undefined : "RevenueCat isn't connected" },
          ]} />
        {choice === "auto" && <span className="text-xs text-faint">Auto: AppStack when it&apos;s connected</span>}
        {gates.appstack && <GateLine gate={gates.appstack} />}
      </div>}

      {!hasAds ? (
        <>
          <NoAds data={data} gate={gates.meta} sync={props.sync} syncing={props.syncing} />
          {gates.appstack && <GateLine gate={gates.appstack} className="mt-3" />}
          {/* AppStack alone still shows what it counted, before any spend is connected. */}
          {model.asCur.length > 0 && <div className="mt-3 grid"><ConversionsCard data={data} model={model} $={$} conversion={props.conversion} setConversion={props.setConversion} /></div>}
        </>
      ) : (
        <>
          <KpiStrip model={model} $={$} />
          <div className="mt-3 grid gap-3 @3xl:grid-cols-2 @6xl:grid-cols-3">
            <CacCard data={data} model={model} $={$} save={save} />
            <WaterfallCard model={model} $={$} />
            <NeedsYouCard data={data} model={model} $={$} show={props.show} />
          </div>
          <div className="mt-3 grid gap-3 @6xl:grid-cols-3">
            <ConversionsCard data={data} model={model} $={$} conversion={props.conversion} setConversion={props.setConversion} />
            <SpendCard data={data} model={model} $={$} />
          </div>
          <div id="measure-table" className="scroll-mt-6">
            <TableCard data={data} model={model} $={$} level={props.level} setLevel={props.setLevel} focus={props.focus} save={save} />
          </div>
        </>
      )}

      <div className="mt-3 grid gap-3 @5xl:grid-cols-[3fr_2fr]">
        <RevenueCatCard data={data} model={model} usd={usd} gate={gates.revenuecat} />
        <HowCard data={data} model={model} />
      </div>
    </>
  );
}

/** A sync message without its "Meta isn't connected:" lead (the card's title already says it). */
const reason = (message: string | null | undefined) => {
  const rest = message?.replace(/^Meta isn't connected:\s*/, "");
  return rest ? rest[0].toUpperCase() + rest.slice(1) : undefined;
};

function NoAds({ data, gate, sync, syncing }: { data: MeasureData; gate: Gate | null; sync: () => void; syncing: boolean }) {
  const meta = data.sync.meta;
  if (gate) {
    return (
      <Panel className="mt-3">
        <ConnectState icon={<IconChart />} title={gate.title} body={gate.body} href={gate.href} action={gate.action} className="py-10" />
      </Panel>
    );
  }
  const connected = meta?.status === "ok";
  return (
    <Panel className="mt-3 flex flex-wrap items-center justify-between gap-4 p-4">
      <div className="min-w-0">
        <h2 className="text-title font-medium">{connected ? "Ads haven't started yet" : meta?.status === "error" ? "Meta didn't sync" : "Meta is connected"}</h2>
        <p className="mt-1 max-w-xl text-sm text-muted">
          {connected
            ? `${meta?.message ?? "The ad account has no delivery yet."} Once the first campaign spends, its spend, installs and cost per customer appear here, split into testing and scaling.`
            : reason(meta?.message) ?? "Press Sync now to pull spend, installs and cost per customer from your ad account."}
        </p>
      </div>
      <Button variant="secondary" onClick={sync} disabled={syncing}>{syncing ? <Spinner className="size-3.5" /> : <IconRefresh />}{syncing ? "Syncing…" : "Sync now"}</Button>
    </Panel>
  );
}

function KpiStrip({ model, $ }: { model: Model; $: (n: number) => string }) {
  const { t, tPrev, cur, prev, split, bl, blPrev } = model;
  const other: Truth = split === "appstack" ? "meta" : "appstack";
  const both = model.t.appstack.installs > 0 || model.tPrev.appstack.installs > 0;
  const range = (pick: (x: Model["t"]["meta"]) => number) => both ? `${SOURCE_LABEL[other]} ${count(pick(t[other]))}` : null;
  return (
    <Panel className="mt-3 grid gap-px overflow-hidden bg-line! @2xl:grid-cols-2 @5xl:grid-cols-4">
      <Kpi label="Spend" value={$(t.spend)} delta={<DeltaChip value={change(t.spend, tPrev.spend)} goodWhenUp={false} />}
        hint={`${fmt(t.impressions)} impressions · CPM ${cur.cpm == null ? "–" : $(cur.cpm)}`} how={HOW.spend} />
      <Kpi label={`Installs (${SOURCE_LABEL[split]})`} value={count(cur.installs)} delta={<DeltaChip value={change(cur.installs, prev.installs)} />}
        hint={[`CPI ${cur.cpi == null ? "–" : $(cur.cpi)}`, range((x) => x.installs)].filter(Boolean).join(" · ")} how={`${HOW.installs} ${HOW.cpi}`} />
      <Kpi label={`Trials (${SOURCE_LABEL[split]})`} value={count(cur.trials)} delta={<DeltaChip value={change(cur.trials, prev.trials)} />}
        hint={[`${cur.costPerTrial == null ? "–" : $(cur.costPerTrial)} per trial`, range((x) => x.trials)].filter(Boolean).join(" · ")} how={`${HOW.trials} ${HOW.costPerTrial}`} />
      <Kpi label="ROAS (blended)" value={model.comparable ? times(bl.roas) : "–"} delta={model.comparable ? <DeltaChip value={change(bl.roas, blPrev.roas)} /> : undefined}
        tone={bl.roas != null && model.comparable ? (bl.roas >= 1 ? "win" : undefined) : undefined}
        hint={model.comparable ? `Attributed ${times(cur.roas)} (${SOURCE_LABEL[split]})` : "Needs an exchange rate: sync again"} how={HOW.roas} />
    </Panel>
  );
}

function CacCard({ data, model, $, save }: { data: MeasureData; model: Model; $: (n: number) => string; save: BodyProps["save"] }) {
  const { cac, cacPrev, econ, range, comparable } = model;
  const ltv = econ.ltv;
  const [draft, setDraft] = useState<string>(data.settings.ltv_manual?.toString() ?? "");
  const lo = Math.min(...[range.meta, range.appstack].filter((v): v is number => v != null));
  const hi = Math.max(...[range.meta, range.appstack].filter((v): v is number => v != null));
  const above = cac != null && ltv != null && cac > ltv;
  return (
    <Panel className="flex flex-col p-4">
      <PanelHead title="Cost per paying customer" sub={`${SOURCE_LABEL[model.headline]} customers · last ${data.range.days} days`} />
      <div className="mt-4 text-kpi font-medium text-ink tabular-nums">{cac == null ? "–" : $(cac)}</div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <DeltaChip value={change(cac, cacPrev)} goodWhenUp={false} />
        <span className="text-caption text-muted">vs previous {data.range.days} days</span>
      </div>
      <p className="mt-3 text-sm text-label">
        {cac == null ? "No paying customers attributed in this period yet."
          : ltv == null ? "Set an LTV (or connect RevenueCat) to see the margin per customer."
          : !comparable ? "Spend isn't in USD yet, so it can't be set against LTV."
          : above ? `${$(cac - ltv)} more than a customer is worth (${$(ltv)} LTV). Every new customer loses money at this cost.`
          : `${$(ltv - cac)} kept per customer against ${$(ltv)} LTV.`}
      </p>
      {cac != null && ltv != null && comparable && (
        <div className="mt-4"><TargetTrack value={cac} target={ltv} max={Math.max(cac, ltv) * 1.25} leftLabel={$(0)} targetLabel={`LTV ${$(ltv)}`} bad={above} /></div>
      )}
      <div className="mt-3">
        {Number.isFinite(lo) && <KeyValue label="Attributed range" value={lo === hi ? $(lo) : `${$(lo)} – ${$(hi)}`} how={`AppStack ${range.appstack == null ? "–" : $(range.appstack)} · Meta ${range.meta == null ? "–" : $(range.meta)}. The two sources are never added: the true CAC most likely sits between them.`} />}
        <KeyValue label="Blended CAC" value={model.bl.cac == null ? "–" : $(model.bl.cac)} how={HOW.blendedCac} />
        <KeyValue label="LTV : CAC" value={times(econ.ltvCac)} how={HOW.ltvCac} chip={econ.ltvCac != null ? <StatusChip label={econ.ltvCac >= 3 ? "Healthy" : econ.ltvCac >= 1 ? "Thin" : "Losing"} tone={econ.ltvCac >= 3 ? "win" : econ.ltvCac >= 1 ? "accent" : "warn"} /> : undefined} />
        <KeyValue label="Payback" value={econ.paybackMonths == null ? "–" : ltv != null && cac != null && ltv >= cac ? "First purchase" : `${econ.paybackMonths.toFixed(1)} mo`} how={HOW.payback} />
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-2.5">
          <HowLabel label={<span className="text-sm text-label">LTV</span>} how={HOW.ltv} />
          <div className="flex items-center gap-2">
            <Segmented label="LTV basis" value={data.settings.ltv_basis} onChange={(v) => save({ settings: { ltv_basis: v } })}
              options={[{ value: "first_purchase", label: "First purchase" }, { value: "manual", label: "Set" }]} />
            {data.settings.ltv_basis === "manual"
              ? <input inputMode="decimal" aria-label="LTV in USD" value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => draft !== (data.settings.ltv_manual?.toString() ?? "") && save({ settings: { ltv_manual: draft } })}
                  placeholder="49.99" className="h-7 w-20 rounded-control border border-hairline bg-raised px-2 text-right text-sm text-ink tabular-nums outline-none transition-colors placeholder:text-faint focus:border-focus/70 focus:ring-2 focus:ring-focus/20" />
              : <span className="text-sm font-medium tabular-nums">{ltv == null ? "–" : moneyFormat("USD")(ltv)}</span>}
          </div>
        </div>
      </div>
    </Panel>
  );
}

function WaterfallCard({ model, $ }: { model: Model; $: (n: number) => string }) {
  const { econ, customers, roleSpend, comparable } = model;
  const ltv = econ.ltv;
  if (ltv == null || !customers || !comparable) {
    return (
      <Panel className="flex flex-col p-4">
        <PanelHead title="Where a customer&apos;s value goes" sub="LTV, less what each kind of campaign costs per customer" />
        <p className="mt-4 text-sm text-muted">
          {!comparable ? "Spend needs converting to USD first: sync again to fetch the exchange rate."
            : ltv == null ? "Needs an LTV: connect RevenueCat or set one in the cost card."
            : "Appears once the ads have brought a paying customer."}
        </p>
      </Panel>
    );
  }
  const steps = (["testing", "scaling", "none"] as const).filter((r) => roleSpend[r] > 0).map((r) => ({
    label: r === "none" ? "Campaigns without a role" : `${r === "testing" ? "Testing" : "Scaling"} spend`,
    value: -roleSpend[r] / customers,
    note: `${$(roleSpend[r])} over ${count(customers)} customers`,
  }));
  const margin = ltv - (model.t.spend / customers);
  return (
    <Panel className="flex flex-col p-4">
      <PanelHead title={margin >= 0 ? "What each customer leaves" : "Why each customer loses money"} sub={`${$(Math.abs(margin))} ${margin >= 0 ? "kept" : "lost"} per paying customer after ad spend`} />
      <div className="mt-4"><Waterfall start={{ label: "LTV", value: ltv }} steps={steps} end={{ label: "Margin per customer", value: margin }} format={$} /></div>
      <p className="mt-4 rounded-inner border border-line bg-raised px-3 py-2.5 text-caption text-muted">
        {roleSpend.testing > 0 && roleSpend.scaling === 0 ? "All spend is still in testing: expect CAC to fall once winners move to scaling." : HOW.margin}
      </p>
    </Panel>
  );
}

function NeedsYouCard({ data, model, $, show }: { data: MeasureData; model: Model; $: (n: number) => string; show: BodyProps["show"] }) {
  const list = alerts(data, model.creatives, model.campaigns, model.t, model.comparable ? model.econ.ltv : null, $);
  const items: NeedsYouItem[] = list.slice(0, 5).map((a) => ({ ...a, onClick: a.level ? () => show(a.level!, a.key) : undefined }));
  return (
    <Panel className="flex flex-col p-4 @3xl:col-span-2 @6xl:col-span-1">
      <PanelHead title="Needs you" sub={list.length ? `${list.length} thing${list.length === 1 ? "" : "s"} in the last ${data.range.days} days` : "Nothing urgent"} />
      <NeedsYou items={items} empty="No creative is above target CAC and nothing failed to sync." />
    </Panel>
  );
}

function ConversionsCard({ data, model, $, conversion, setConversion }: { data: MeasureData; model: Model; $: (n: number) => string; conversion: Conversion; setConversion: (c: Conversion) => void }) {
  const { split } = model;
  const other: Truth = split === "appstack" ? "meta" : "appstack";
  const bothSources = data.sync.appstack?.status === "ok" && data.sync.meta?.status === "ok";
  const days = dayList(data.range.since, data.range.until);
  const perDay = (rows: { date: string }[], pick: (r: never) => number) => {
    const out = new Map<string, number>();
    for (const r of rows) out.set(r.date, (out.get(r.date) ?? 0) + (Number(pick(r as never)) || 0));
    return out;
  };
  const meta = perDay(model.metaCur, (r: { [k: string]: number }) => r[conversion]);
  const appstack = perDay(model.asCur, (r: { [k: string]: number }) => r[conversion]);
  const spend = perDay(model.metaCur, (r: { spend: number }) => r.spend * (model.m.rate ?? 1));
  const series = (s: Truth) => (s === "meta" ? meta : appstack);
  const points = days.map((d) => {
    const value = series(split).get(d) ?? 0;
    const otherValue = bothSources ? series(other).get(d) ?? 0 : null;
    const cost = spend.get(d) ?? 0;
    return {
      key: d, label: shortDay(d), value, other: otherValue,
      tip: <>
        <Readout first value={shortDay(d)} />
        <Readout value={count(value)} label={SOURCE_LABEL[split]} />
        {otherValue != null && <Readout value={count(otherValue)} label={SOURCE_LABEL[other]} />}
        <Readout value={$(cost)} label="spend" />
        {value > 0 && <Readout value={$(cost / value)} label="each" />}
      </>,
    };
  });
  return (
    <Panel className="flex flex-col p-4 @6xl:col-span-2">
      <PanelHead title={`${CONVERSION_LABEL[conversion]} per day`} sub={bothSources ? `${SOURCE_LABEL[split]} solid, ${SOURCE_LABEL[other]} dashed; hover a day for its spend` : `Attributed by ${SOURCE_LABEL[split]}${model.metaCur.length ? "; hover a day for its spend" : ""}`}
        right={<Segmented label="Conversion" value={conversion} onChange={setConversion} options={(Object.keys(CONVERSION_LABEL) as Conversion[]).map((c) => ({ value: c, label: CONVERSION_LABEL[c] }))} />} />
      <div className="mt-3"><BandLegend solid={SOURCE_LABEL[split]} dashed={bothSources ? SOURCE_LABEL[other] : undefined} /></div>
      <div className="mt-6"><BandLine points={points} name={`${CONVERSION_LABEL[conversion]} per day`} format={(n) => fmt(n)} /></div>
    </Panel>
  );
}

function SpendCard({ data, model, $ }: { data: MeasureData; model: Model; $: (n: number) => string }) {
  const days = dayList(data.range.since, data.range.until);
  const byDay = new Map<string, number>();
  for (const r of model.metaCur) byDay.set(r.date, (byDay.get(r.date) ?? 0) + r.spend * (model.m.rate ?? 1));
  const points = days.map((d) => ({ key: d, label: shortDay(d), value: byDay.get(d) ?? 0 }));
  return (
    <Panel className="flex flex-col p-4">
      <PanelHead title="Daily spend" sub={model.budget ? "Today solid; dashed line is today's daily budget" : "Today solid"}
        right={<span className="text-xs text-muted">{model.m.converted ? `${model.m.accountCurrency} → USD` : model.m.currency}</span>} />
      <HatchedBars points={points} target={model.budget ? { value: model.budget, label: `Budget ${$(model.budget)}` } : null} format={$} name="Spend per day" />
    </Panel>
  );
}

// MARK: Table

function TableCard({ data, model, $, level, setLevel, focus, save }: { data: MeasureData; model: Model; $: (n: number) => string; level: Level; setLevel: (l: Level) => void; focus: string | null; save: BodyProps["save"] }) {
  const rows = useMemo(() => model.byLevel(level), [model, level]);
  const ltv = model.comparable ? model.econ.ltv : null;
  const split = model.split;
  const other: Truth = split === "appstack" ? "meta" : "appstack";
  const both = data.sync.appstack?.status === "ok" && data.sync.meta?.status === "ok";
  const sections: { key: string; label: string | null; rows: Group[] }[] = level === "format" || level === "hook"
    ? [{ key: "all", label: null, rows }]
    : (["testing", "scaling", "none"] as const).map((r) => ({ key: r, label: ROLE_LABEL[r], rows: rows.filter((g) => (g.role ?? "none") === r) })).filter((s) => s.rows.length);
  const conv = (g: Group, kind: "installs" | "purchases") => (
    <span className="flex flex-col items-end">
      <span>{count(g.totals[split][kind])}</span>
      {both && <span className="text-xs text-faint">{SOURCE_LABEL[other]} {count(g.totals[other][kind])}</span>}
    </span>
  );

  return (
    <Panel className="mt-3 p-4">
      <PanelHead title={`By ${LEVELS.find((l) => l.value === level)!.label.toLowerCase().replace(/s$/, "")}`}
        sub={level === "format" ? "Ads grouped by the format their creative was made from" : level === "hook" ? "Ads grouped by the hook in Launch's ad name" : "Testing and scaling campaigns apart; CAC against LTV on the gauge"}
        right={<Segmented label="Level" value={level} onChange={setLevel} options={LEVELS} />} />
      <div className="-mx-4 mt-3 overflow-x-auto px-4">
        <table className="w-full min-w-[980px] text-sm">
          <thead>
            <tr className="text-left text-xs text-faint">
              <th className="py-2 pr-4 pl-2 font-medium">{LEVELS.find((l) => l.value === level)!.label.replace(/s$/, "")}</th>
              {["Spend", "CTR", "CPM", "CPC", "Installs", "CPI", "Customers", "CAC", "", "ROAS"].map((h, i) => <th key={i} className="px-2 py-2 text-right font-medium">{h}</th>)}
              <th className="py-2 pr-2 pl-4 font-medium">Status</th>
            </tr>
          </thead>
          {sections.map((section) => (
            <tbody key={section.key}>
              {section.label && (
                <tr><td colSpan={12} className="pt-4 pb-1.5 pl-2 text-xs font-medium text-faint">{section.label} · {section.rows.length}</td></tr>
              )}
              {section.rows.map((g) => {
                const v = verdict(g.m, ltv, g.role);
                return (
                  <tr key={g.key} className={cx("border-t border-line align-middle transition-colors hover:bg-hover", focus === g.key && "bg-caution-soft")}>
                    <td className="max-w-[300px] py-2 pr-4 pl-2">
                      <div className="flex items-center gap-3">
                        {g.thumbnail && <Thumb src={g.thumbnail} alt="" className="size-8 shrink-0 rounded-md" />}
                        <div className="min-w-0">
                          <p className="truncate font-medium text-ink" title={g.name}>{g.name}</p>
                          {g.sub && <p className="truncate text-xs text-muted">{g.sub}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{$(g.m.spend)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{pct(g.m.ctr, 2)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{g.m.cpm == null ? "–" : $(g.m.cpm)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{g.m.cpc == null ? "–" : $(g.m.cpc)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{conv(g, "installs")}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{g.m.cpi == null ? "–" : $(g.m.cpi)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{conv(g, "purchases")}</td>
                    <td className={cx("px-2 py-2 text-right tabular-nums", ltv != null && g.m.cac != null && g.m.cac > ltv && "text-warn")}>{g.m.cac == null ? "–" : $(g.m.cac)}</td>
                    <td className="px-2 py-2"><TargetGauge value={g.m.cac} target={ltv} label={g.m.cac != null && ltv != null ? `CAC ${$(g.m.cac)} against ${$(ltv)} LTV` : ""} /></td>
                    <td className="px-2 py-2 text-right tabular-nums">{times(g.m.roas)}</td>
                    <td className="py-2 pr-2 pl-4">
                      <div className="flex items-center gap-2">
                        <StatusChip label={v.label} tone={v.tone} />
                        {level === "campaign" && g.campaignId && (
                          <select aria-label={`Role of ${g.name}`} value={g.role ?? ""} onChange={(e) => save({ campaign: { id: g.campaignId, role: e.target.value || null } })}
                            className="h-6 cursor-pointer rounded-control border border-hairline bg-raised px-1.5 text-xs text-ink">
                            <option value="">No role</option><option value="testing">Testing</option><option value="scaling">Scaling</option>
                          </select>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          ))}
        </table>
        {!rows.length && <p className="py-8 text-center text-sm text-muted">No delivery in this period. Pick a longer range, or press Sync now.</p>}
      </div>
      <p className="mt-3 text-xs text-muted">
        Customers and CAC per row count {SOURCE_LABEL[split]}&apos;s attribution{both ? `; the small figure is ${SOURCE_LABEL[other]}'s, never added` : ""}. Meta reports iOS (SKAdNetwork / AEM) results 1–3 days late, so the last days run low.
      </p>
    </Panel>
  );
}

// MARK: RevenueCat and the formulas

function RevenueCatCard({ data, model, usd, gate }: { data: MeasureData; model: Model; usd: (n: number) => string; gate: Gate | null }) {
  const { rc, rcPrev } = model;
  const sync = data.sync.revenuecat;
  if (sync?.status !== "ok") {
    return (
      <Panel className="p-4">
        <PanelHead title="Subscriptions" sub="From RevenueCat" />
        {gate
          ? <><p className="mt-4 text-sm text-muted">Trials, new paid subscriptions, revenue and LTV appear here. Without it, set an LTV by hand in the cost card.</p><GateLine gate={gate} className="mt-3" /></>
          : <p className="mt-4 text-sm text-muted">{sync?.message ?? "Connected. Press Sync now to pull trials, revenue and LTV."}</p>}
      </Panel>
    );
  }
  const quiet = rc.revenue === 0 && rc.newPaid === 0;
  const split = rc.split.filter((s) => s.proceeds > 0 || s.newPaid > 0);
  return (
    <Panel className="p-4">
      <PanelHead title="Subscriptions" sub={`From RevenueCat · last ${data.range.days} days`} right={<span className="text-xs text-muted">USD</span>} />
      <div className="mt-3 grid gap-x-8 @xl:grid-cols-2">
        <div>
          <KeyValue label="New trials" value={count(rc.trials)} chip={<DeltaChip value={change(rc.trials, rcPrev.trials)} />} />
          <KeyValue label="Trial → paid" value={pct(rc.conversionRate)} how="Trials started in the period that converted to paid ÷ those trials (RevenueCat's trial conversion rate). Recent trials are still pending, so this rises over time." />
          <KeyValue label="New paid subscriptions" value={count(rc.newPaid)} chip={<DeltaChip value={change(rc.newPaid, rcPrev.newPaid)} />} />
          <KeyValue label="New customers" value={count(rc.newCustomers)} />
        </div>
        <div>
          <KeyValue label="Revenue" value={usd(rc.revenue)} chip={<DeltaChip value={change(rc.revenue, rcPrev.revenue)} />} how="Gross revenue in the period, net of refunds RevenueCat recorded in it." />
          <KeyValue label="Proceeds" value={usd(rc.proceeds)} how="Revenue after the store's commission and taxes: what reaches the bank. LTV uses this." />
          <KeyValue label="Refunds" value={rc.refunds ? `${usd(rc.refunds)} · ${count(rc.refundedTransactions)}` : usd(0)} />
          <KeyValue label="Active now" value={`${count(rc.activeSubscriptions)} subs · ${count(rc.activeTrials)} trials`} how="Right now, not for the period (RevenueCat's overview). MRR feeds the payback estimate." chip={rc.mrr != null ? <span className="text-xs font-normal text-muted">MRR {usd(rc.mrr)}</span> : undefined} />
        </div>
      </div>
      <div className="mt-3 border-t border-line pt-3">
        <p className="mb-2.5 text-sm text-label">Annual vs monthly, by proceeds</p>
        {split.length ? <SplitBar parts={split.map((s) => ({ label: s.segment, value: s.proceeds || s.newPaid }))} format={(n) => (split.some((s) => s.proceeds) ? usd(n) : count(n))} />
          : <p className="text-sm text-muted">{quiet ? "No paid subscriptions in this period yet." : "No split by plan yet."}</p>}
      </div>
    </Panel>
  );
}

function HowCard({ data, model }: { data: MeasureData; model: Model }) {
  const { m } = model;
  const rows: [string, string][] = [
    ["CAC", HOW.cac], ["Blended CAC", HOW.blendedCac], ["ROAS", HOW.roas], ["LTV", HOW.ltv], ["LTV : CAC", HOW.ltvCac], ["Payback", HOW.payback],
    ["CPI", HOW.cpi], ["CTR / CPM / CPC", `${HOW.ctr} ${HOW.cpm} ${HOW.cpc}`],
  ];
  return (
    <Panel className="p-4">
      <PanelHead title="How these numbers are calculated" sub="Spend from Meta, money from RevenueCat, attribution from AppStack and Meta" />
      <dl className="mt-2 divide-y divide-line">
        {rows.map(([term, text]) => (
          <div key={term} className="grid gap-1 py-2.5 @xl:grid-cols-[120px_1fr] @xl:gap-4">
            <dt className="text-sm font-medium text-ink">{term}</dt>
            <dd className="text-sm text-muted">{text}</dd>
          </div>
        ))}
        <div className="grid gap-1 py-2.5 @xl:grid-cols-[120px_1fr] @xl:gap-4">
          <dt className="text-sm font-medium text-ink">Currency</dt>
          <dd className="text-sm text-muted">
            {m.converted ? `The ad account bills in ${m.accountCurrency}; spend is converted at 1 ${m.accountCurrency} = ${m.rate?.toPrecision(3)} USD (ECB rate${m.fxDate ? ` of ${m.fxDate}` : ""}).`
              : m.accountCurrency && m.accountCurrency !== "USD" ? `The ad account bills in ${m.accountCurrency} and no exchange rate is stored yet, so spend is shown in ${m.accountCurrency} and nothing is set against RevenueCat's USD.`
              : "Everything is in USD."}
            {data.sync.meta?.details?.account?.name ? ` Ad account: ${data.sync.meta.details.account.name}.` : ""}
          </dd>
        </div>
      </dl>
    </Panel>
  );
}

// MARK: Export

function exportCsv(model: Model, data: MeasureData, level: Level) {
  const rows = model.byLevel(level);
  const header = ["level", "name", "role", "spend_" + model.m.currency.toLowerCase(), "impressions", "clicks", "ctr", "cpm", "cpc", "installs_meta", "installs_appstack", "trials_meta", "trials_appstack", "customers_meta", "customers_appstack", "cac", "roas", "counted_from"];
  const cell = (v: unknown) => {
    const s = v == null ? "" : typeof v === "number" ? String(Math.round(v * 10000) / 10000) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [header.join(","), ...rows.map((g) => [
    level, g.name, g.role ?? "", g.m.spend, g.m.impressions, g.m.clicks, g.m.ctr, g.m.cpm, g.m.cpc,
    g.totals.meta.installs, g.totals.appstack.installs, g.totals.meta.trials, g.totals.appstack.trials, g.totals.meta.purchases, g.totals.appstack.purchases,
    g.m.cac, g.m.roas, model.split,
  ].map(cell).join(","))];
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `measure-${data.workspace.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${level}-${data.range.since}-to-${data.range.until}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
