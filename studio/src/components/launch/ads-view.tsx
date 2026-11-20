"use client";
// Launch → Ads: every ad sent from the dashboard, in any ad set, with its creative, where it stands
// (Meta's delivery status, or the draft's progress before it gets there), its numbers for the chosen
// range (the same ranges as Measure), a daily sparkline and a verdict from Launch's promote/pause rules
// and Measure's targets. Filters, sort and CSV export; a row opens the ad's detail (ad-detail.tsx),
// whose link (?ad=) Measure uses too. Reads only: the detail's pause and promote are confirmed first.
import { useMemo, useState } from "react";
import { useCached } from "@/lib/client-cache";
import { useT } from "@/lib/i18n/client";
import { FILTERS, matches, sortAds, summarize, toCsv, type Filter, type LaunchedAd, type SortKey } from "@/lib/launch/tracking";
import { RANGES } from "@/lib/measure";
import type { LaunchedAdsData } from "@/lib/server/launched-ads";
import { workspaceHref } from "@/lib/workspace-schema";
import { IconCalendar, IconDownload, IconRocket } from "../icons";
import { Kpi, Panel, Segmented, StatusChip } from "../measure/kit";
import { useProductName } from "../workspace/product-header";
import { Button, ButtonLink, cx, EmptyState, ErrorNote, Page, PageHeader, SelectPill, Spinner, Thumb } from "../ui";
import { AdDetail } from "./ad-detail";
import { attentionLabel, filterLabel, formats, sortLabel, stageLabel, statusLabel, statusTone, verdictLabel } from "./ads-words";

const SORTS: SortKey[] = ["spend", "created", "cac", "roas", "installs", "purchases", "ctr", "cpi", "name"];
/** Costs read best lowest first; everything else highest first. */
const ASCENDING = new Set<SortKey>(["cac", "cpi", "name"]);

export function LaunchAdsView({ productId, initialAd }: { productId: string; initialAd?: string | null }) {
  const tr = useT();
  const { t, tn } = tr;
  const [days, setDays] = useState(28);
  const [data, reload] = useCached<LaunchedAdsData & { error?: string }>(`/api/launch/${productId}/ads?days=${days}`);
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<SortKey>("spend");
  const [open, setOpen] = useState<string | null>(initialAd ?? null);
  const name = useProductName(productId);

  const shown = useMemo(() => (data?.ads ? sortAds(data.ads.filter((a) => matches(a, filter)), sort, !ASCENDING.has(sort)) : []), [data, filter, sort]);
  const selected = open ? data?.ads?.find((a) => a.key === open || a.adId === open) ?? null : null;

  /** Keeps ?ad= in the address, so the open ad can be shared and Measure can link to it. */
  function show(key: string | null) {
    setOpen(key);
    const url = new URL(window.location.href);
    if (key) url.searchParams.set("ad", key); else url.searchParams.delete("ad");
    history.replaceState(history.state, "", url.pathname + url.search);
  }

  const header = (
    <PageHeader
      crumbs={[{ label: name ?? t("App"), href: workspaceHref(productId) }, { label: t("Launch"), href: workspaceHref(productId, "launch") }, { label: t("Ads") }]}
      title={t("Ads")}
      subtitle={t("Every ad sent from here, in any ad set: where it stands on Meta, what it costs and what it brings in, and the creative it came from.")}
      actions={<>
        <SelectPill icon={<IconCalendar />} label={t("Date range")} value={String(days)} onChange={(v) => setDays(Number(v))} options={RANGES.map((r) => ({ value: String(r), label: t("Last {n} days", { n: r }) }))} />
        <Button variant="secondary" size="sm" disabled={!shown.length} onClick={() => data && download(toCsv(shown, data.currency), `launched-ads-${filter}-${data.range.since}-to-${data.range.until}.csv`)}>
          <IconDownload /><span className="max-sm:sr-only">{t("Export CSV")}</span>
        </Button>
      </>}
    />
  );

  if (!data) return <Page>{header}<div className="grid place-items-center py-24 text-muted"><Spinner /></div></Page>;
  if (data.error) return <Page>{header}<ErrorNote>{data.error}</ErrorNote></Page>;

  const $ = formats(tr, data.currency);
  const total = summarize(shown);

  if (!data.ads.length) {
    return (
      <Page>
        {header}
        <EmptyState className="py-16" icon={<IconRocket />} title={t("No ads sent yet")}
          body={t("Approve creatives in Studio, then press Send to Meta on the Launch page. Each ad arrives in your ad account paused; once you publish it in Ads Manager, its numbers show up here after the next Measure sync.")}
          action={<ButtonLink href={workspaceHref(productId, "launch")} size="sm">{t("Open Launch")}</ButtonLink>} />
      </Page>
    );
  }

  return (
    <Page>
      {header}
      <div className="mb-4 grid grid-cols-2 gap-px overflow-hidden rounded-card border border-line bg-line sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label={t("Spend")} value={$.money(total.spend)} hint={tn(shown.length, "{n} ad", "{n} ads")} />
        <Kpi label={t("Installs")} value={$.count(total.installs)} hint={t("CPI {value}", { value: $.money(total.cpi) })} />
        <Kpi label={t("Trials")} value={$.count(total.trials)} />
        <Kpi label={t("Purchases")} value={$.count(total.purchases)} />
        <Kpi label={t("CAC")} value={$.money(total.cac)} />
        <Kpi label={t("ROAS")} value={$.times(total.roas)} hint={t("{value} revenue", { value: $.money(total.revenue) })} />
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <Segmented<Filter> label={t("Show")} value={filter} onChange={setFilter}
          options={FILTERS.map((f) => ({ value: f, label: `${filterLabel(tr, f)} ${data.counts[f]}` }))} />
        <SelectPill label={t("Sort by")} value={sort} onChange={(v) => setSort(v as SortKey)} options={SORTS.map((s) => ({ value: s, label: t("Sort: {key}", { key: sortLabel(tr, s) }) }))} />
      </div>

      {shown.length === 0 ? (
        <EmptyState className="py-12" title={t("No ads match this filter")} body={t("Pick another filter or a longer date range.")} />
      ) : (
        <>
          {/* Wide screens: a table. */}
          <Panel className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[1060px] text-sm">
              <caption className="sr-only">{t("Ads sent from Launch, {since} to {until}. Select a row to open the ad.", { since: $.day(data.range.since), until: $.day(data.range.until) })}</caption>
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th scope="col" className="h-9 border-b border-line pr-3 pl-4 font-book">{t("Ad")}</th>
                  <th scope="col" className="h-9 border-b border-line px-2 font-book">{t("Status and verdict")}</th>
                  {[t("Spend"), t("Impr."), t("CTR"), t("Installs"), t("CPI"), t("Trials"), t("Purchases"), t("CAC"), t("ROAS")].map((h) => <th key={h} scope="col" className="h-9 border-b border-line px-2 text-right font-book whitespace-nowrap">{h}</th>)}
                  <th scope="col" className="h-9 border-b border-line pr-4 pl-2 font-book whitespace-nowrap">{t("Daily spend")}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((a) => (
                  <tr key={a.key} tabIndex={0} onClick={() => show(a.key)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); show(a.key); } }}
                    className={cx("h-16 cursor-pointer align-middle outline-none transition-colors hover:bg-hover focus-visible:bg-hover", open === a.key && "bg-active")}>
                    <td className="max-w-[260px] py-2 pr-3 pl-4">
                      <div className="flex items-center gap-3">
                        <Thumb src={a.thumbnail} alt="" size={80} className="size-9 shrink-0 rounded-md" />
                        <div className="min-w-0">
                          <p className="truncate font-mono text-xs text-ink" title={a.name}>{a.name}</p>
                          <p className="truncate text-xs text-muted">{stageLabel(tr, a)}{a.adSetName ? ` · ${a.adSetName}` : ""}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex flex-col items-start gap-1">
                        <StatusChip label={statusLabel(tr, a.status)} tone={statusTone(a.status)} />
                        <VerdictCell ad={a} />
                      </div>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{$.money(a.m.spend)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{$.compact(a.m.impressions)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{$.pct(a.m.ctr)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{$.count(a.m.installs)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{$.money(a.m.cpi)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{$.count(a.m.trials)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{$.count(a.m.purchases)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{$.money(a.m.cac)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{$.times(a.m.roas)}</td>
                    <td className="py-2 pr-4 pl-2"><Sparkline ad={a} label={t("Daily spend of {name}", { name: a.name })} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>

          {/* Phones: one card per ad. */}
          <div className="grid gap-2 md:hidden">
            {shown.map((a) => (
              <button key={a.key} type="button" onClick={() => show(a.key)} className="flex min-w-0 flex-col gap-2.5 rounded-card border border-line bg-card p-3 text-left transition-colors hover:bg-hover">
                <div className="flex min-w-0 items-start gap-3">
                  <Thumb src={a.thumbnail} alt="" size={80} className="size-11 shrink-0 rounded-md" />
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-[11px] break-all text-ink">{a.name}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5"><StatusChip label={statusLabel(tr, a.status)} tone={statusTone(a.status)} /><VerdictCell ad={a} /></div>
                  </div>
                </div>
                <dl className="grid grid-cols-3 gap-x-3 gap-y-1.5 text-xs">
                  {([[t("Spend"), $.money(a.m.spend)], [t("Installs"), $.count(a.m.installs)], [t("CPI"), $.money(a.m.cpi)], [t("Purchases"), $.count(a.m.purchases)], [t("CAC"), $.money(a.m.cac)], [t("ROAS"), $.times(a.m.roas)]] as const).map(([k, v]) => (
                    <div key={k} className="min-w-0"><dt className="text-muted">{k}</dt><dd className="font-medium text-ink tabular-nums">{v}</dd></div>
                  ))}
                </dl>
                <Sparkline ad={a} label={t("Daily spend of {name}", { name: a.name })} wide />
              </button>
            ))}
          </div>
        </>
      )}
      <p className="mt-3 text-xs text-muted">
        {data.split === "appstack"
          ? t("Installs, trials, purchases and revenue are AppStack's attribution; spend, impressions and clicks are Meta's. Amounts are in {currency}.", { currency: data.currency })
          : t("Every number is Meta's (the source of truth Measure uses for this app). Amounts are in {currency}.", { currency: data.currency })}
        {" "}{data.syncedAt ? t("Meta last synced {when}.", { when: new Date(data.syncedAt).toLocaleString(tr.intl) }) : t("Meta hasn't synced yet: press Sync now in Measure.")}
      </p>

      {selected && <AdDetail productId={productId} ad={selected} data={data} onClose={() => show(null)} onChanged={() => reload()} />}
    </Page>
  );
}

function VerdictCell({ ad }: { ad: LaunchedAd }) {
  const tr = useT();
  return (
    <span className="inline-flex items-center gap-1.5" title={ad.attention.map((r) => attentionLabel(tr, r)).join(" · ") || undefined}>
      <StatusChip label={verdictLabel(tr, ad.verdict.code)} tone={ad.verdict.tone} />
      {ad.attention.length > 0 && <span aria-hidden className="size-1.5 rounded-full bg-warn" />}
      {ad.attention.length > 0 && <span className="sr-only">{tr.t("Needs attention")}</span>}
    </span>
  );
}

/** Spend per day as a tiny line, in the accent colour (theme tokens, so light and dark both work). */
export function Sparkline({ ad, label, wide }: { ad: LaunchedAd; label: string; wide?: boolean }) {
  const values = ad.days.map((d) => d.spend);
  const max = Math.max(...values, 0);
  if (max <= 0) return <span className={cx("block h-6 border-b border-dashed border-line", wide ? "w-full" : "w-20")} role="img" aria-label={label} />;
  const n = values.length;
  const points = values.map((v, i) => `${n <= 1 ? 50 : (i / (n - 1)) * 100},${22 - (v / max) * 20}`).join(" ");
  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" role="img" aria-label={label} className={cx("block h-6", wide ? "w-full" : "w-20")}>
      <polyline points={`0,24 ${points} 100,24`} fill="var(--color-accent)" fillOpacity={0.12} stroke="none" />
      <polyline points={points} fill="none" stroke="var(--color-accent)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

function download(text: string, filename: string) {
  const blob = new Blob([text], { type: "text/csv" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
