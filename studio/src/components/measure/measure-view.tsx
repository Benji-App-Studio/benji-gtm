"use client";
// The Measure page: a product's paid growth in one place (Meta spend and delivery, AppStack's and
// Meta's attributed conversions side by side, RevenueCat's money) with CAC, ROAS, LTV:CAC and payback
// worked out on the page and each formula one click away.
//
// Five sources, none of them required (Meta, RevenueCat, Superwall, Mixpanel, AppStack): each one that
// isn't connected shows where to connect it in place of its numbers, and the rest of the page works with
// what is there. With none connected the page is one "connect a source" state. Below the ads, the
// operating dashboard (operating.tsx): unit economics, the projection, and a section per source.
import Link from "next/link";
import { useMemo, useState } from "react";
import { notice } from "@/components/dialog";
import { IconCalendar, IconChart, IconDownload, IconRefresh } from "@/components/icons";
import { useFeatures } from "@/components/studio/features";
import { Button, ConnectState, ErrorNote, Locked, Page, SelectPill, Spinner, Term, Thumb, cx } from "@/components/ui";
import { useTermTips, withParts } from "@/components/nav/nav-labels";
import { ProductPageHeader } from "@/components/workspace/product-header";
import { MeasureBodySkeleton } from "@/components/page-skeletons";
import { PlaybookTips } from "@/components/playbook-tip";
import type { FeatureState } from "@/lib/capabilities";
import { operating } from "@/lib/business-summary";
import { useCached } from "@/lib/client-cache";
import { useT } from "@/lib/i18n/client";
import { syncMessage } from "./sync-words";
import { m, type Translator } from "@/lib/i18n/translate";
import {
  addDays, alerts, blended, change, dayList, groups, headlineCustomers, HOW, isMetaSource, metrics, mixpanel, money, RANGES, revenuecat, SOURCE_NAME, SOURCES, superwall, totals, truthFor, verdict,
  type Group, type Headline, type Level, type MeasureData, type Role, type Source, type Truth,
} from "@/lib/measure";
import { EconomicsSection, formatters, MixpanelSection, ProjectionPanel, RevenueTrendsCard, SuperwallSection } from "./operating";
import { BandLegend, BandLine, HatchedBars, Readout, SplitBar, TargetGauge, TargetTrack, Waterfall } from "./charts";
import { DeltaChip, HowLabel, KeyValue, Kpi, NeedsYou, Panel, PanelHead, Segmented, SourceDot, StatusChip, type NeedsYouItem } from "./kit";
import { appSettingsHref } from "@/lib/nav-model";
import { planMonths } from "@/lib/unit-economics";

type Conversion = "installs" | "trials" | "purchases";
const CONVERSION_LABEL: Record<Conversion, string> = { installs: m("Installs"), trials: m("Trials"), purchases: m("Paying customers") };
const CONVERSION_PER_DAY: Record<Conversion, string> = { installs: m("Installs per day"), trials: m("Trials per day"), purchases: m("Paying customers per day") };
const SOURCE_LABEL: Record<Source, string> = SOURCE_NAME;
const sourceGives = (t: Translator["t"]): Record<Source, string> => ({
  meta: t("Ad spend, delivery and cost per customer"), revenuecat: t("Trials, purchases, revenue, MRR and churn"), appstack: t("Installs and customers for each ad"),
  superwall: t("Paywall views and conversion by paywall and placement"), mixpanel: t("Your funnel, retention and active users"),
});
const SOURCE_FEATURE = { meta: "measure.meta", revenuecat: "measure.revenuecat", appstack: "measure.appstack", mixpanel: "measure.mixpanel", superwall: "measure.superwall" } as const;
/** The line under the title: what the page shows, each ad term with its meaning on hover. */
function Subtitle() {
  const { t } = useT();
  const tips = useTermTips();
  return <>{withParts(t("What your ads cost next to what customers pay you: spend, installs, trials and revenue, with {cac}, {roas}, {ltvCac} and {payback}."), {
    cac: <Term tip={tips.cac}>CAC</Term>, roas: <Term tip={tips.roas}>ROAS</Term>, ltvCac: <Term tip={tips.ltvCac}>LTV:CAC</Term>, payback: <Term tip={tips.payback}>{t("payback")}</Term>,
  })}</>;
}

/** Where to connect a source that isn't connected yet, in the words the page shows. */
type Gate = Pick<FeatureState, "title" | "body" | "href" | "action">;
type Gates = Record<Source, Gate | null>;

// When the install can't be read, the data itself says what is missing (the backend's health check and the app's saved IDs).
function gateFromData(data: MeasureData, s: Source, t: Translator["t"]): Gate | null {
  const row = data.sync[s];
  if (row && row.status !== "not_connected") return null;
  const name = SOURCE_LABEL[s];
  if (data.health && data.health[s] === false) return { title: t("Connect {source} to see its numbers here", { source: name }), body: t("Add the key in Settings › Your keys. It is checked when you save it."), href: "/app/settings/keys", action: t("Add the key") };
  if (!data.workspace.connected[s]) return { title: t("Add your {source} IDs to see its numbers here", { source: name }), body: t("Fill them in under this app's connections."), href: appSettingsHref(data.workspace.id, "connections"), action: t("Open connections") };
  return null;
}
const LEVELS: { value: Level; label: string; one: string; by: string }[] = [
  { value: "campaign", label: m("Campaigns"), one: m("Campaign"), by: m("By campaign") },
  { value: "adset", label: m("Ad sets"), one: m("Ad set"), by: m("By ad set") },
  { value: "ad", label: m("Ads"), one: m("Ad"), by: m("By ad") },
  { value: "creative", label: m("Creatives"), one: m("Creative"), by: m("By creative") },
  { value: "format", label: m("Formats"), one: m("Format"), by: m("By format") },
  { value: "hook", label: m("Hooks"), one: m("Hook"), by: m("By hook") },
];
const ROLE_LABEL: Record<Role | "none", string> = { testing: m("Testing campaign"), scaling: m("Scaling campaign"), none: m("No role yet") };

// MARK: Formatting

/** Money, counts, percentages and days in the page's locale (shared with the operating dashboard). */
function useFormats() {
  const tr = useT();
  return useMemo(() => {
    const f = formatters(tr);
    return {
      ...f,
      moneyFormat: (currency: string) => (n: number) => f.money(n, currency),
      compact: (n: number) => new Intl.NumberFormat(tr.intl, { notation: "compact", maximumFractionDigits: 1 }).format(n),
      shortDay: f.day,
    };
  }, [tr]);
}
/** A RevenueCat plan segment ("P1Y", "annual", "1 month") in words; unknown names stay as written. */
function planWord(t: Translator["t"], segment: string): string {
  const months = planMonths(segment);
  return months === 0 ? t("Lifetime") : months != null && Math.abs(months - 12 / 52) < 0.01 ? t("Weekly") : months === 1 ? t("Monthly") : months === 3 ? t("Quarterly") : months === 12 ? t("Annual") : segment;
}
const ago = ({ t }: Translator, iso: string) => {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  return minutes < 1 ? t("just now") : minutes < 60 ? t("{n} min ago", { n: minutes }) : minutes < 1440 ? t("{n} h ago", { n: Math.round(minutes / 60) }) : t("{n} d ago", { n: Math.round(minutes / 1440) });
};

// MARK: The model

/** Everything the page shows, worked out once per data load or settings change. */
function build(data: MeasureData, words: Translator) {
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
  const mpRows = (from: string, to: string | null) => data.mixpanel.filter((r) => r.date >= from && (to == null || r.date < to));
  const swRows = (from: string, to: string | null) => data.superwall.filter((r) => r.date >= from && (to == null || r.date < to));
  const customers = headlineCustomers(headline, t, rc, mixpanel(data, mpRows(since, null)), superwall(data, swRows(since, null)));
  const customersPrev = headlineCustomers(headline, tPrev, rcPrev, mixpanel(data, mpRows(prevSince, since)), superwall(data, swRows(prevSince, since)));
  const cac = customers > 0 ? t.spend / customers : null;
  const cacPrev = customersPrev > 0 ? tPrev.spend / customersPrev : null;
  // One set of unit economics for the whole page: the cost card, the verdicts and the alerts read the
  // operating model (lib/business-summary.ts), which the LTV basis below drives too.
  const op = operating(data);
  const econ = { ltv: op.comparable ? op.ltv.value : null, ltvCac: op.ltvCac, paybackMonth: op.paybackMonth };
  const range = {
    meta: t.meta.purchases > 0 ? t.spend / t.meta.purchases : null,
    appstack: t.appstack.purchases > 0 ? t.spend / t.appstack.purchases : null,
  };

  const byLevel = (level: Level) => groups(data, level, metaCur, asCur, rate, split, words);
  const campaigns = byLevel("campaign");
  const creatives = byLevel("creative");

  // Where a paying customer's value goes: LTV, less what testing and scaling spend cost per customer.
  const roleSpend = { testing: 0, scaling: 0, none: 0 };
  for (const c of campaigns) roleSpend[c.role ?? "none"] += c.totals.spend;
  const budget = data.campaigns.filter((c) => c.status === "ACTIVE" && c.daily_budget).reduce((s, c) => s + (c.daily_budget ?? 0) * rate, 0);

  return { m, comparable, headline, split, t, tPrev, rc, rcPrev, cur, prev, bl, blPrev, customers, customersPrev, cac, cacPrev, econ, range, byLevel, campaigns, creatives, roleSpend, budget, organicInstalls, metaCur, asCur, op };
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
  const tr = useT();
  const { t } = tr;
  const model = useMemo(() => (ready ? build(ready, tr) : null), [ready, tr]);
  const features = useFeatures(productId);
  const locks = useMemo<Record<Source, FeatureState | null>>(() => Object.fromEntries(SOURCES.map((s) => [s, features.locked(SOURCE_FEATURE[s])])) as Record<Source, FeatureState | null>, [features]);
  const gates = useMemo<Gates>(() => Object.fromEntries(SOURCES.map((s) => [s, locks[s] ?? (ready ? gateFromData(ready, s, t) : null)])) as Gates, [locks, ready, t]);

  async function save(body: Record<string, unknown>) {
    const response = await fetch(`/api/w/${productId}/measure`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!response.ok) notice((await response.json().catch(() => ({}))).error ?? t("Couldn't save that."));
    await reload().catch(() => {});
  }

  async function sync() {
    setSyncing(true);
    const response = await fetch(`/api/w/${productId}/measure/sync`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const body = await response.json().catch(() => ({}));
    setSyncing(false);
    if (!response.ok) notice(body.error ?? t("The sync didn't run."), t("Sync didn't run"));
    await reload().catch(() => {});
  }

  function show(nextLevel: Level, key?: string) {
    setLevel(nextLevel);
    setFocus(key ?? null);
    document.getElementById("measure-table")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // Nothing connected: the page is one state that lists the sources and where each is connected.
  if (SOURCES.every((s) => locks[s])) {
    return (
      <Page>
        <ProductPageHeader productId={productId} page="Measure" name={name} subtitle={<Subtitle />} />
        <MeasureLocked locks={locks as Record<Source, FeatureState>} />
      </Page>
    );
  }

  return (
    <Page>
      <Header productId={productId} name={name} data={ready} gates={gates} days={days} setDays={setDays} syncing={syncing} onSync={sync} model={model} level={level} />
      {data?.error && <ErrorNote title={t("Measure can't load")} className="mt-4">{data.error}</ErrorNote>}
      {!data && <MeasureBodySkeleton />}
      {ready && <PlaybookTips ids={["variance", "diagnose-by-layer", "cheap-installs", "headroom"]} className="mt-4" />}
      {ready && model && (
        <Body data={ready} model={model} gates={gates} save={save} sync={sync} syncing={syncing} level={level} setLevel={(l) => { setLevel(l); setFocus(null); }} focus={focus} show={show}
          conversion={conversion} setConversion={setConversion} />
      )}
    </Page>
  );
}

/** Measure with no source connected: what each of the three adds, and where to connect it. */
function MeasureLocked({ locks }: { locks: Record<Source, FeatureState> }) {
  const { t } = useT();
  const gives = sourceGives(t);
  // The button goes where most of the work is: the keys page while a key is missing, else the app's connections.
  const first = SOURCES.map((s) => locks[s]).find((lock) => lock.missingKeys.length) ?? locks.meta;
  return (
    <ConnectState icon={<IconChart />} title={t("Connect a source to see your numbers")} href={first.href} action={first.missingKeys.length ? t("Open your keys") : first.action}
      body={<>
        {t("Measure is your operating dashboard: what your ads cost, what customers are worth, your paywalls, funnel and retention. Any one of these is enough to start, and each adds its own numbers.")}
        <span className="mt-4 grid gap-px overflow-hidden rounded-small border border-line bg-line text-left">
          {SOURCES.map((s) => (
            <span key={s} className="flex items-center justify-between gap-4 bg-card px-3 py-2.5">
              <span className="min-w-0">
                <span className="block font-medium text-ink">{SOURCE_LABEL[s]}</span>
                <span className="block text-caption">{gives[s]}</span>
              </span>
              <Link href={locks[s].href} className="shrink-0 rounded-xs text-xs font-medium text-accent hover:underline">{locks[s].action}<span className="sr-only"> ({SOURCE_LABEL[s]})</span></Link>
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
  const tr = useT();
  const { t } = tr;
  const f = useFormats();
  return (
    <ProductPageHeader productId={productId} page="Measure" name={name} className="mb-0"
      subtitle={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span><Subtitle /></span>
          {data && SOURCES.map((s) => {
            const state = sourceState(data, gates, s);
            return <SourceDot key={s} name={SOURCE_LABEL[s]} state={state} title={state === "off" ? t("{source} isn't connected", { source: SOURCE_LABEL[s] }) : (data.sync[s]?.message ? syncMessage(data.sync[s]?.message, tr) : undefined) ?? (state === "unsynced" ? t("Connected. Press Sync now.") : undefined)} />;
          })}
          {last && <span className="text-xs text-faint">{t("Synced {when}", { when: ago(tr, last) })}</span>}
        </span>
      }
      actions={<>
        <SelectPill icon={<IconCalendar />} label={t("Date range")} value={String(days)} onChange={(value) => setDays(Number(value))} options={RANGES.map((r) => ({ value: String(r), label: t("Last {n} days", { n: r }) }))} />
        {data && <span className="hidden px-1 text-xs text-faint @3xl:inline">{t("vs {since} to {until}", { since: f.shortDay(data.range.prevSince), until: f.shortDay(addDays(data.range.since, -1)) })}</span>}
        <Button variant="secondary" onClick={onSync} disabled={syncing || !data} data-guide="results">
          {syncing ? <Spinner className="size-3.5" /> : <IconRefresh />}<span className="max-sm:sr-only">{syncing ? t("Syncing…") : t("Sync now")}</span>
        </Button>
        <Button variant="secondary" onClick={() => model && data && exportCsv(model, data, level)} disabled={!model || !data?.meta.length}><IconDownload /><span className="max-sm:sr-only">{t("Export")}</span></Button>
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
  const f = useFormats();
  const $ = f.moneyFormat(model.m.currency);
  const usd = f.moneyFormat("USD");
  const hasAds = data.meta.length > 0 || data.campaigns.length > 0;
  const appstackOk = data.sync.appstack?.status === "ok";
  const rcOk = data.sync.revenuecat?.status === "ok";
  const swOk = data.sync.superwall?.status === "ok";
  const mpOk = data.sync.mixpanel?.status === "ok";
  const choice = data.settings.cac_source;
  const { t } = useT();
  // Another source is connected: a missing Meta is one line, not the page's main panel.
  const othersOk = rcOk || swOk || mpOk || appstackOk;

  return (
    <>
      {/* Whose customers CAC counts only matters once there is spend to set them against. */}
      {hasAds && <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <HowLabel label={<span className="text-sm text-muted">{t("Count paying customers from")}</span>} how={t("AppStack and Meta each attribute customers to the ads (AppStack can over-count, Meta under-counts on iOS); RevenueCat counts every new payer, organic included (blended). Per-ad numbers always use AppStack, or Meta when AppStack isn't connected.")} />
        <Segmented<Headline | "auto"> label={t("Source of truth for CAC")} value={choice === "auto" ? model.headline : choice}
          onChange={(value) => save({ settings: { cac_source: value } })}
          options={[
            { value: "appstack", label: "AppStack", disabled: !appstackOk, title: appstackOk ? undefined : t("{source} isn't connected", { source: "AppStack" }) },
            { value: "meta", label: "Meta" },
            { value: "revenuecat", label: t("RevenueCat (blended)"), disabled: !rcOk, title: rcOk ? undefined : t("{source} isn't connected", { source: "RevenueCat" }) },
            ...(swOk || choice === "superwall" ? [{ value: "superwall" as const, label: t("Superwall (blended)"), disabled: !swOk }] : []),
            ...(mpOk || choice === "mixpanel" ? [{ value: "mixpanel" as const, label: t("Mixpanel (blended)"), disabled: !mpOk }] : []),
          ]} />
        {choice === "auto" && <span className="text-xs text-faint">{t("Auto: AppStack when it's connected")}</span>}
        {gates.appstack && <GateLine gate={gates.appstack} />}
      </div>}

      {!hasAds ? (
        <>
          {gates.meta && othersOk ? <GateLine gate={gates.meta} className="mt-3" /> : <NoAds data={data} gate={gates.meta} sync={props.sync} syncing={props.syncing} />}
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

      <EconomicsSection data={data} o={model.op} />
      <ProjectionPanel key={JSON.stringify(model.op.scenario)} o={model.op} save={save} />

      <h2 className="mt-8 mb-3 text-group font-medium text-ink">{t("Revenue and subscriptions")}</h2>
      <div className="grid gap-3 @5xl:grid-cols-2">
        <RevenueTrendsCard data={data} o={model.op} gate={gates.revenuecat} />
        <RevenueCatCard data={data} model={model} usd={usd} gate={gates.revenuecat} />
      </div>
      <SuperwallSection data={data} o={model.op} gate={gates.superwall} />
      <MixpanelSection data={data} o={model.op} gate={gates.mixpanel} />
      <div className="mt-8 grid gap-3">
        <HowCard data={data} model={model} />
      </div>
    </>
  );
}

/** A sync message without its "Meta isn't connected:" lead (the card's title already says it). */
/** Why Meta isn't syncing: the stored message without its "Meta isn't connected:" lead in English, the whole sentence translated otherwise. */
const reason = (message: string | null | undefined, tr: Pick<Translator, "t" | "locale">) => {
  if (!message) return undefined;
  if (tr.locale !== "en") return syncMessage(message, tr);
  const rest = message.replace(/^Meta isn't connected:\s*/, "");
  return rest ? rest[0].toUpperCase() + rest.slice(1) : undefined;
};

function NoAds({ data, gate, sync, syncing }: { data: MeasureData; gate: Gate | null; sync: () => void; syncing: boolean }) {
  const meta = data.sync.meta;
  const tr = useT();
  const { t } = tr;
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
        <h2 className="text-sm font-medium">{connected ? t("Ads haven't started yet") : meta?.status === "error" ? t("{source} didn't sync", { source: "Meta" }) : t("Meta is connected")}</h2>
        <p className="mt-1 max-w-xl text-sm text-muted">
          {connected
            ? `${meta?.message ? syncMessage(meta.message, tr) : t("The ad account has no delivery yet.")} ${t("Once the first campaign spends, its spend, installs and cost per customer appear here, split into testing and scaling.")}`
            : reason(meta?.message, tr) ?? t("Press Sync now to pull spend, installs and cost per customer from your ad account.")}
        </p>
      </div>
      <Button variant="secondary" onClick={sync} disabled={syncing}>{syncing ? <Spinner className="size-3.5" /> : <IconRefresh />}{syncing ? t("Syncing…") : t("Sync now")}</Button>
    </Panel>
  );
}

function KpiStrip({ model, $ }: { model: Model; $: (n: number) => string }) {
  const { t: sum, tPrev, cur, prev, split, bl, blPrev } = model;
  const { t } = useT();
  const { count, times } = useFormats();
  const other: Truth = split === "appstack" ? "meta" : "appstack";
  const both = model.t.appstack.installs > 0 || model.tPrev.appstack.installs > 0;
  const range = (pick: (x: Model["t"]["meta"]) => number) => both ? `${SOURCE_LABEL[other]} ${count(pick(sum[other]))}` : null;
  return (
    <Panel className="mt-3 grid gap-px overflow-hidden bg-line! @2xl:grid-cols-2 @5xl:grid-cols-4">
      <Kpi label={t("Spend")} value={$(sum.spend)} delta={<DeltaChip value={change(sum.spend, tPrev.spend)} goodWhenUp={false} />}
        hint={t("{n} impressions · CPM {cpm}", { n: count(sum.impressions), cpm: cur.cpm == null ? "–" : $(cur.cpm) })} how={t(HOW.spend)} />
      <Kpi label={t("Installs ({source})", { source: SOURCE_LABEL[split] })} value={count(cur.installs)} delta={<DeltaChip value={change(cur.installs, prev.installs)} />}
        hint={[`CPI ${cur.cpi == null ? "–" : $(cur.cpi)}`, range((x) => x.installs)].filter(Boolean).join(" · ")} how={`${t(HOW.installs)} ${t(HOW.cpi)}`} />
      <Kpi label={t("Trials ({source})", { source: SOURCE_LABEL[split] })} value={count(cur.trials)} delta={<DeltaChip value={change(cur.trials, prev.trials)} />}
        hint={[t("{amount} per trial", { amount: cur.costPerTrial == null ? "–" : $(cur.costPerTrial) }), range((x) => x.trials)].filter(Boolean).join(" · ")} how={`${t(HOW.trials)} ${t(HOW.costPerTrial)}`} />
      <Kpi label={t("ROAS (blended)")} value={model.comparable ? times(bl.roas) : "–"} delta={model.comparable ? <DeltaChip value={change(bl.roas, blPrev.roas)} /> : undefined}
        tone={bl.roas != null && model.comparable ? (bl.roas >= 1 ? "win" : undefined) : undefined}
        hint={model.comparable ? t("Attributed {roas} ({source})", { roas: times(cur.roas), source: SOURCE_LABEL[split] }) : t("Needs an exchange rate: sync again")} how={t(HOW.roas)} />
    </Panel>
  );
}

function CacCard({ data, model, $, save }: { data: MeasureData; model: Model; $: (n: number) => string; save: BodyProps["save"] }) {
  const { cac, cacPrev, econ, range, comparable } = model;
  const ltv = econ.ltv;
  const tr = useT();
  const { t } = tr;
  const { times, moneyFormat, month } = useFormats();
  const [draft, setDraft] = useState<string>(data.settings.ltv_manual?.toString() ?? "");
  const lo = Math.min(...[range.meta, range.appstack].filter((v): v is number => v != null));
  const hi = Math.max(...[range.meta, range.appstack].filter((v): v is number => v != null));
  const above = cac != null && ltv != null && cac > ltv;
  return (
    <Panel className="flex flex-col p-4">
      <PanelHead title={t("Cost per paying customer")} sub={t("{source} customers · last {n} days", { source: SOURCE_LABEL[model.headline], n: data.range.days })} />
      <div className="mt-3 text-figure font-medium text-ink tabular-nums">{cac == null ? "–" : $(cac)}</div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <DeltaChip value={change(cac, cacPrev)} goodWhenUp={false} />
        <span className="text-caption text-muted">{t("vs previous {n} days", { n: data.range.days })}</span>
      </div>
      <p className="mt-3 text-sm text-label">
        {cac == null ? t("No paying customers attributed in this period yet.")
          : ltv == null ? t("Set an LTV (or connect RevenueCat) to see the margin per customer.")
          : !comparable ? t("Spend isn't in USD yet, so it can't be set against LTV.")
          : above ? t("{amount} more than a customer is worth ({ltv} LTV). Every new customer loses money at this cost.", { amount: $(cac - ltv), ltv: $(ltv) })
          : t("{amount} kept per customer against {ltv} LTV.", { amount: $(ltv - cac), ltv: $(ltv) })}
      </p>
      {cac != null && ltv != null && comparable && (
        <div className="mt-4"><TargetTrack value={cac} target={ltv} max={Math.max(cac, ltv) * 1.25} leftLabel={$(0)} targetLabel={`LTV ${$(ltv)}`} bad={above} /></div>
      )}
      <div className="mt-3">
        {Number.isFinite(lo) && <KeyValue label={t("Attributed range")} value={lo === hi ? $(lo) : `${$(lo)} – ${$(hi)}`} how={t("AppStack {appstack} · Meta {meta}. The two sources are never added: the true CAC most likely sits between them.", { appstack: range.appstack == null ? "–" : $(range.appstack), meta: range.meta == null ? "–" : $(range.meta) })} />}
        <KeyValue label={t("Blended CAC")} value={model.bl.cac == null ? "–" : $(model.bl.cac)} how={t(HOW.blendedCac)} />
        <KeyValue label="LTV : CAC" value={times(econ.ltvCac)} how={t(HOW.ltvCac)} chip={econ.ltvCac != null ? <StatusChip label={econ.ltvCac >= 3 ? t("Healthy") : econ.ltvCac >= 1 ? t("Thin") : t("Losing")} tone={econ.ltvCac >= 3 ? "win" : econ.ltvCac >= 1 ? "accent" : "warn"} /> : undefined} />
        <KeyValue label={t("Payback")} value={month(econ.paybackMonth)} how={t(HOW.payback)} />
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-2.5">
          <HowLabel label={<span className="text-sm text-label">LTV</span>} how={t(HOW.ltv)} />
          <div className="flex items-center gap-2">
            <Segmented label={t("LTV basis")} value={data.settings.ltv_basis} onChange={(v) => save({ settings: { ltv_basis: v } })}
              options={[{ value: "first_purchase", label: t("From your data") }, { value: "manual", label: t("Set") }]} />
            {data.settings.ltv_basis === "manual"
              ? <input inputMode="decimal" aria-label={t("LTV in USD")} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => draft !== (data.settings.ltv_manual?.toString() ?? "") && save({ settings: { ltv_manual: draft } })}
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
  const { t, tn } = useT();
  const { count } = useFormats();
  if (ltv == null || !customers || !comparable) {
    return (
      <Panel className="flex flex-col p-4">
        <PanelHead title={t("Where a customer's value goes")} sub={t("LTV, less what each kind of campaign costs per customer")} />
        <p className="mt-4 text-sm text-muted">
          {!comparable ? t("Spend needs converting to USD first: sync again to fetch the exchange rate.")
            : ltv == null ? t("Needs an LTV: connect RevenueCat or set one in the cost card.")
            : t("Appears once the ads have brought a paying customer.")}
        </p>
      </Panel>
    );
  }
  const steps = (["testing", "scaling", "none"] as const).filter((r) => roleSpend[r] > 0).map((r) => ({
    label: r === "none" ? t("Campaigns without a role") : r === "testing" ? t("Testing spend") : t("Scaling spend"),
    value: -roleSpend[r] / customers,
    note: tn(customers, "{amount} over {count} customer", "{amount} over {count} customers", { amount: $(roleSpend[r]), count: count(customers) }),
  }));
  const margin = ltv - (model.t.spend / customers);
  return (
    <Panel className="flex flex-col p-4">
      <PanelHead title={margin >= 0 ? t("What each customer leaves") : t("Why each customer loses money")} sub={margin >= 0 ? t("{amount} kept per paying customer after ad spend", { amount: $(Math.abs(margin)) }) : t("{amount} lost per paying customer after ad spend", { amount: $(Math.abs(margin)) })} />
      <div className="mt-4"><Waterfall start={{ label: "LTV", value: ltv }} steps={steps} end={{ label: t("Margin per customer"), value: margin }} format={$} /></div>
      <p className="mt-4 rounded-inner border border-line bg-raised px-3 py-2 text-caption text-muted">
        {roleSpend.testing > 0 && roleSpend.scaling === 0 ? t("All spend is still in testing: expect CAC to fall once winners move to scaling.") : t(HOW.margin)}
      </p>
    </Panel>
  );
}

function NeedsYouCard({ data, model, $, show }: { data: MeasureData; model: Model; $: (n: number) => string; show: BodyProps["show"] }) {
  const tr = useT();
  const { t, tn } = tr;
  const list = alerts(data, model.creatives, model.campaigns, model.t, model.comparable ? model.econ.ltv : null, $, tr);
  const items: NeedsYouItem[] = list.slice(0, 5).map((a) => ({ ...a, onClick: a.level ? () => show(a.level!, a.key) : undefined }));
  return (
    <Panel className="flex flex-col p-4 @3xl:col-span-2 @6xl:col-span-1">
      <PanelHead title={t("Needs you")} sub={list.length ? tn(list.length, "{n} thing in the last {days} days", "{n} things in the last {days} days", { days: data.range.days }) : t("Nothing urgent")} />
      <NeedsYou items={items} empty={t("No creative is above target CAC and nothing failed to sync.")} />
    </Panel>
  );
}

function ConversionsCard({ data, model, $, conversion, setConversion }: { data: MeasureData; model: Model; $: (n: number) => string; conversion: Conversion; setConversion: (c: Conversion) => void }) {
  const { split } = model;
  const { t } = useT();
  const { count, compact, shortDay } = useFormats();
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
        <Readout value={$(cost)} label={t("spend")} />
        {value > 0 && <Readout value={$(cost / value)} label={t("each")} />}
      </>,
    };
  });
  return (
    <Panel className="flex flex-col p-4 @6xl:col-span-2">
      <PanelHead title={t(CONVERSION_PER_DAY[conversion])} sub={bothSources ? t("{source} solid, {other} dashed; hover a day for its spend", { source: SOURCE_LABEL[split], other: SOURCE_LABEL[other] }) : model.metaCur.length ? t("Attributed by {source}; hover a day for its spend", { source: SOURCE_LABEL[split] }) : t("Attributed by {source}", { source: SOURCE_LABEL[split] })}
        right={<Segmented label={t("Conversion")} value={conversion} onChange={setConversion} options={(Object.keys(CONVERSION_LABEL) as Conversion[]).map((c) => ({ value: c, label: t(CONVERSION_LABEL[c]) }))} />} />
      <div className="mt-3"><BandLegend solid={SOURCE_LABEL[split]} dashed={bothSources ? SOURCE_LABEL[other] : undefined} /></div>
      <div className="mt-4"><BandLine points={points} name={t(CONVERSION_PER_DAY[conversion])} format={compact} /></div>
    </Panel>
  );
}

function SpendCard({ data, model, $ }: { data: MeasureData; model: Model; $: (n: number) => string }) {
  const days = dayList(data.range.since, data.range.until);
  const { t } = useT();
  const { shortDay } = useFormats();
  const byDay = new Map<string, number>();
  for (const r of model.metaCur) byDay.set(r.date, (byDay.get(r.date) ?? 0) + r.spend * (model.m.rate ?? 1));
  const points = days.map((d) => ({ key: d, label: shortDay(d), value: byDay.get(d) ?? 0 }));
  return (
    <Panel className="flex flex-col p-4">
      <PanelHead title={t("Daily spend")} sub={model.budget ? t("Today solid; dashed line is today's daily budget") : t("Today solid")}
        right={<span className="text-xs text-muted">{model.m.converted ? `${model.m.accountCurrency} → USD` : model.m.currency}</span>} />
      <HatchedBars points={points} target={model.budget ? { value: model.budget, label: t("Budget {amount}", { amount: $(model.budget) }) } : null} format={$} name={t("Spend per day")} />
    </Panel>
  );
}

// MARK: Table

function TableCard({ data, model, $, level, setLevel, focus, save }: { data: MeasureData; model: Model; $: (n: number) => string; level: Level; setLevel: (l: Level) => void; focus: string | null; save: BodyProps["save"] }) {
  const rows = useMemo(() => model.byLevel(level), [model, level]);
  const { t } = useT();
  const { count, pct, times } = useFormats();
  const levelInfo = LEVELS.find((l) => l.value === level)!;
  // Ads Launch sent open their detail in Launch → Ads (the creative they came from, pause, promote).
  const launchedIds = useMemo(() => new Set(data.ads.filter((a) => a.launched).map((a) => a.ad_id)), [data.ads]);
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
      <PanelHead title={t(levelInfo.by)}
        sub={level === "format" ? t("Ads grouped by the format their creative was made from") : level === "hook" ? t("Ads grouped by the hook in Launch's ad name") : t("Testing and scaling campaigns apart; CAC against LTV on the gauge")}
        right={<Segmented label={t("Level")} value={level} onChange={setLevel} options={LEVELS.map((l) => ({ value: l.value, label: t(l.label) }))} />} />
      <div className="-mx-4 mt-3 overflow-x-auto px-4">
        <table className="w-full min-w-[980px] text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="h-8 border-b border-line pr-4 pl-2 font-book">{t(levelInfo.one)}</th>
              {[t("Spend"), "CTR", "CPM", "CPC", t("Installs"), "CPI", t("Customers"), "CAC", "", "ROAS"].map((h, i) => <th key={i} className="h-8 border-b border-line px-2 text-right font-book whitespace-nowrap">{h}</th>)}
              <th className="h-8 border-b border-line pr-2 pl-4 font-book">{t("Status")}</th>
            </tr>
          </thead>
          {sections.map((section) => (
            <tbody key={section.key}>
              {section.label && (
                <tr><td colSpan={12} className="pt-4 pb-1.5 pl-2 text-xs font-medium text-muted">{t(section.label)} · {section.rows.length}</td></tr>
              )}
              {section.rows.map((g) => {
                const v = verdict(g.m, ltv, g.role);
                return (
                  <tr key={g.key} className={cx("h-11 align-middle transition-colors hover:bg-hover", focus === g.key && "bg-caution-soft")}>
                    <td className="max-w-[300px] py-2 pr-4 pl-2">
                      <div className="flex items-center gap-3">
                        {g.thumbnail && <Thumb src={g.thumbnail} alt="" className="size-7 shrink-0 rounded-md" />}
                        <div className="min-w-0">
                          {level === "ad" && launchedIds.has(g.key)
                            ? <Link href={`/app/w/${data.workspace.id}/launch/ads?ad=${encodeURIComponent(g.key)}`} className="block truncate font-medium text-ink hover:underline" title={g.name}>{g.name}</Link>
                            : <p className="truncate font-medium text-ink" title={g.name}>{g.name}</p>}
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
                    <td className="px-2 py-2"><TargetGauge value={g.m.cac} target={ltv} label={g.m.cac != null && ltv != null ? t("CAC {cac} against {ltv} LTV", { cac: $(g.m.cac), ltv: $(ltv) }) : ""} /></td>
                    <td className="px-2 py-2 text-right tabular-nums">{times(g.m.roas)}</td>
                    <td className="py-2 pr-2 pl-4">
                      <div className="flex items-center gap-2">
                        <StatusChip label={t(v.label)} tone={v.tone} />
                        {level === "campaign" && g.campaignId && (
                          <select aria-label={t("Role of {name}", { name: g.name })} value={g.role ?? ""} onChange={(e) => save({ campaign: { id: g.campaignId, role: e.target.value || null } })}
                            className="h-6 cursor-pointer rounded-control border border-hairline bg-raised pl-2 text-xs text-ink">
                            <option value="">{t("No role")}</option><option value="testing">{t("Testing")}</option><option value="scaling">{t("Scaling")}</option>
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
        {!rows.length && <p className="py-8 text-center text-sm text-muted">{t("No delivery in this period. Pick a longer range, or press Sync now.")}</p>}
      </div>
      <p className="mt-3 text-xs text-muted">
        {both
          ? t("Customers and CAC per row count {source}'s attribution; the small figure is {other}'s, never added. Meta reports iOS (SKAdNetwork / AEM) results 1–3 days late, so the last days run low.", { source: SOURCE_LABEL[split], other: SOURCE_LABEL[other] })
          : t("Customers and CAC per row count {source}'s attribution. Meta reports iOS (SKAdNetwork / AEM) results 1–3 days late, so the last days run low.", { source: SOURCE_LABEL[split] })}
      </p>
    </Panel>
  );
}

// MARK: RevenueCat and the formulas

function RevenueCatCard({ data, model, usd, gate }: { data: MeasureData; model: Model; usd: (n: number) => string; gate: Gate | null }) {
  const { rc, rcPrev } = model;
  const sync = data.sync.revenuecat;
  const tr = useT();
  const { t } = tr;
  const { count, pct } = useFormats();
  if (sync?.status !== "ok") {
    return (
      <Panel className="p-4">
        <PanelHead title={t("Subscriptions")} sub={t("From RevenueCat")} />
        {gate
          ? <><p className="mt-4 text-sm text-muted">{t("Trials, new paid subscriptions, revenue and LTV appear here. Without it, set an LTV by hand in the cost card.")}</p><GateLine gate={gate} className="mt-3" /></>
          : <p className="mt-4 text-sm text-muted">{sync?.message ? syncMessage(sync.message, tr) : t("Connected. Press Sync now to pull trials, revenue and LTV.")}</p>}
      </Panel>
    );
  }
  const quiet = rc.revenue === 0 && rc.newPaid === 0;
  const split = rc.split.filter((s) => s.proceeds > 0 || s.newPaid > 0);
  return (
    <Panel className="p-4">
      <PanelHead title={t("Subscriptions")} sub={t("From RevenueCat · last {n} days", { n: data.range.days })} right={<span className="text-xs text-muted">USD</span>} />
      <div className="mt-3 grid gap-x-8 @xl:grid-cols-2">
        <div>
          <KeyValue label={t("New trials")} value={count(rc.trials)} chip={<DeltaChip value={change(rc.trials, rcPrev.trials)} />} />
          <KeyValue label={t("Trial → paid")} value={pct(rc.conversionRate)} how={t("Trials started in the period that converted to paid ÷ those trials (RevenueCat's trial conversion rate). Recent trials are still pending, so this rises over time.")} />
          <KeyValue label={t("New paid subscriptions")} value={count(rc.newPaid)} chip={<DeltaChip value={change(rc.newPaid, rcPrev.newPaid)} />} />
          <KeyValue label={t("New customers")} value={count(rc.newCustomers)} />
        </div>
        <div>
          <KeyValue label={t("Revenue")} value={usd(rc.revenue)} chip={<DeltaChip value={change(rc.revenue, rcPrev.revenue)} />} how={t("Gross revenue in the period, net of refunds RevenueCat recorded in it.")} />
          <KeyValue label={t("Proceeds")} value={usd(rc.proceeds)} how={t("Revenue after the store's commission and taxes: what reaches the bank. LTV uses this.")} />
          <KeyValue label={t("Refunds")} value={rc.refunds ? `${usd(rc.refunds)} · ${count(rc.refundedTransactions)}` : usd(0)} />
          <KeyValue label={t("Active now")} value={t("{subs} subs · {trials} trials", { subs: count(rc.activeSubscriptions), trials: count(rc.activeTrials) })} how={t("Right now, not for the period (RevenueCat's overview). MRR feeds the payback estimate.")} chip={rc.mrr != null ? <span className="text-xs font-normal text-muted">MRR {usd(rc.mrr)}</span> : undefined} />
        </div>
      </div>
      <div className="mt-3 border-t border-line pt-3">
        <p className="mb-2 text-xs text-muted">{t("Annual vs monthly, by proceeds")}</p>
        {split.length ? <SplitBar parts={split.map((s) => ({ label: planWord(t, s.segment), value: s.proceeds || s.newPaid }))} format={(n) => (split.some((s) => s.proceeds) ? usd(n) : count(n))} />
          : <p className="text-sm text-muted">{quiet ? t("No paid subscriptions in this period yet.") : t("No split by plan yet.")}</p>}
      </div>
    </Panel>
  );
}

function HowCard({ data, model }: { data: MeasureData; model: Model }) {
  const { m } = model;
  const { t } = useT();
  const rows: [string, string][] = [
    ["CAC", t(HOW.cac)], [t("Blended CAC"), t(HOW.blendedCac)], ["ROAS", t(HOW.roas)], ["LTV", t(HOW.ltv)], ["LTV : CAC", t(HOW.ltvCac)], [t("Payback"), t(HOW.payback)],
    ["CPI", t(HOW.cpi)], ["CTR / CPM / CPC", `${t(HOW.ctr)} ${t(HOW.cpm)} ${t(HOW.cpc)}`],
  ];
  return (
    <Panel className="p-4">
      <PanelHead title={t("How these numbers are calculated")} sub={t("Spend from Meta, money from RevenueCat, attribution from AppStack and Meta")} />
      <dl className="mt-2 divide-y divide-line">
        {rows.map(([term, text]) => (
          <div key={term} className="grid gap-1 py-2.5 @xl:grid-cols-[120px_1fr] @xl:gap-4">
            <dt className="text-sm font-medium text-ink">{term}</dt>
            <dd className="text-sm text-muted">{text}</dd>
          </div>
        ))}
        <div className="grid gap-1 py-2.5 @xl:grid-cols-[120px_1fr] @xl:gap-4">
          <dt className="text-sm font-medium text-ink">{t("Currency")}</dt>
          <dd className="text-sm text-muted">
            {m.converted
              ? m.fxDate
                ? t("The ad account bills in {currency}; spend is converted at 1 {currency} = {rate} USD (ECB rate of {date}).", { currency: m.accountCurrency ?? "", rate: m.rate?.toPrecision(3) ?? "–", date: m.fxDate })
                : t("The ad account bills in {currency}; spend is converted at 1 {currency} = {rate} USD (ECB rate).", { currency: m.accountCurrency ?? "", rate: m.rate?.toPrecision(3) ?? "–" })
              : m.accountCurrency && m.accountCurrency !== "USD" ? t("The ad account bills in {currency} and no exchange rate is stored yet, so spend is shown in {currency} and nothing is set against RevenueCat's USD.", { currency: m.accountCurrency })
              : t("Everything is in USD.")}
            {data.sync.meta?.details?.account?.name ? ` ${t("Ad account: {name}.", { name: data.sync.meta.details.account.name })}` : ""}
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
