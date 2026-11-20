"use client";
// One launched ad in a side drawer: its numbers per day (spend against installs or purchases, and CAC
// over a running week), totals, Launch's judgement with its reasons, and the lineage: the competitor
// ad it was made from → the studio creative → the ad on Meta. Pause and "copy to scaling" are the
// launch function's existing writes, each confirmed in a dialog first; both leave things paused.
import { useState, type PointerEvent, type ReactNode } from "react";
import { useT } from "@/lib/i18n/client";
import { allowedActions, cacTrend, type LaunchedAd } from "@/lib/launch/tracking";
import type { LaunchedAdsData } from "@/lib/server/launched-ads";
import { workspaceHref } from "@/lib/workspace-schema";
import { ask, Facts, notice } from "../dialog";
import { IconArrowRight, IconExternal, IconX } from "../icons";
import { BandLine, HoverCard, Readout } from "../measure/charts";
import { Segmented, StatusChip } from "../measure/kit";
import { PANEL, PANEL_OVERLAY, PanelPortal } from "../panel-portal";
import { Button, cx, Spinner, Thumb } from "../ui";
import { attentionLabel, formats, stageLabel, statusLabel, statusTone, verdictLabel } from "./ads-words";
import { checkDetail, checkLabel, summaryText } from "./judgement";
import { send } from "./parts";

type Conversion = "installs" | "purchases";

export function AdDetail({ productId, ad, data, onClose, onChanged }: {
  productId: string;
  ad: LaunchedAd;
  data: LaunchedAdsData;
  onClose: () => void;
  onChanged: () => Promise<unknown>;
}) {
  const tr = useT();
  const { t } = tr;
  const $ = formats(tr, ad.currency);
  const [conversion, setConversion] = useState<Conversion>(ad.m.purchases > 0 ? "purchases" : "installs");
  const [busy, setBusy] = useState<"pause" | "promote" | null>(null);

  // Only what the launch function will accept (the same rules, lib/launch/scope.ts).
  const { pause: canPause, promote: canPromote } = allowedActions(ad, data);

  async function act(action: "pause" | "promote") {
    const promote = action === "promote";
    const ok = await ask({
      title: promote ? t("Copy this ad to the scaling campaign?") : t("Pause this ad?"),
      body: (
        <div className="space-y-3">
          <p className="font-mono text-[11px] break-all text-ink">{ad.name}</p>
          <Facts rows={[[t("Spend"), $.money(ad.m.spend)], [t("Purchases"), $.count(ad.m.purchases)], [t("CAC"), $.money(ad.m.cac)], [t("ROAS"), $.times(ad.m.roas)]]} />
          <p className="text-xs">{promote
            ? t("Meta duplicates the ad into the scaling ad set, paused, named with SCALE. This ad keeps running until you pause it.")
            : t("The ad stops delivering. You can turn it back on in Ads Manager.")}</p>
        </div>
      ),
      confirm: promote ? t("Copy to scaling (paused)") : t("Pause ad"),
      cancel: t("Cancel"),
      danger: !promote,
    });
    if (!ok) return;
    setBusy(action);
    try {
      await send(`/api/launch/${productId}/actions`, { action, adId: ad.adId, reason: ad.suggestion?.summary });
      await onChanged();
    } catch (error) {
      notice(error instanceof Error ? error.message : String(error), t("Something went wrong"));
    } finally {
      setBusy(null);
    }
  }

  const trend = cacTrend(ad.days);
  return (
    <PanelPortal onClose={onClose}>
      <div className={`${PANEL_OVERLAY} z-40`} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <aside role="dialog" aria-modal="true" aria-labelledby="ad-detail-title" className={`${PANEL} @container max-w-3xl`}>
          <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-line bg-card px-4 py-3">
            <div className="flex min-w-0 items-start gap-3">
              <Thumb src={ad.thumbnail} alt="" size={120} className="size-12 shrink-0 rounded-md" />
              <div className="min-w-0">
                <h2 id="ad-detail-title" className="font-mono text-xs break-all text-ink">{ad.name}</h2>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <StatusChip label={statusLabel(tr, ad.status)} tone={statusTone(ad.status)} />
                  <StatusChip label={verdictLabel(tr, ad.verdict.code)} tone={ad.verdict.tone} />
                  <span className="text-xs text-muted">{stageLabel(tr, ad)}{ad.adSetName ? ` · ${ad.adSetName}` : ""}</span>
                </div>
              </div>
            </div>
            <button type="button" onClick={onClose} aria-label={t("Close")} className="grid size-7 shrink-0 place-items-center rounded-control text-muted transition hover:bg-hover hover:text-ink"><IconX className="size-3.5" /></button>
          </div>

          <div className="grid gap-6 p-4">
            <div className="flex flex-wrap items-center gap-2">
              {ad.lineage.meta && (
                <a href={ad.lineage.meta.url} target="_blank" rel="noreferrer" className="inline-flex h-7 items-center gap-1.5 rounded-control border border-hairline bg-raised px-2.5 text-xs font-medium text-ink hover:bg-hover">
                  {t("Open in Ads Manager")}<IconExternal className="size-3" />
                </a>
              )}
              {canPromote && (
                <Button size="sm" variant={ad.verdict.code === "promote" ? "primary" : "secondary"} disabled={busy !== null} onClick={() => act("promote")}>
                  {busy === "promote" && <Spinner />}{t("Copy to scaling (paused)")}
                </Button>
              )}
              {canPause && (
                <Button size="sm" variant={ad.verdict.code === "pause" ? "danger" : "secondary"} disabled={busy !== null} onClick={() => act("pause")}>
                  {busy === "pause" && <Spinner />}{t("Pause ad")}
                </Button>
              )}
            </div>

            {(ad.attention.length > 0 || ad.issues.length > 0 || ad.draftError) && (
              <div className="grid gap-1 rounded-inner border border-line bg-caution-soft px-3 py-2.5 text-xs">
                {ad.attention.map((r) => <p key={r} className="font-medium text-ink">{attentionLabel(tr, r)}</p>)}
                {ad.draftError && <p className="text-label">{ad.draftError}</p>}
                {ad.issues.map((i) => <p key={i} className="text-label">{t("Meta: {issue}", { issue: i })}</p>)}
              </div>
            )}

            <section>
              <h3 className="text-sm font-medium text-ink">{t("Totals")}</h3>
              <p className="text-caption text-muted">{t("{since} to {until}", { since: $.day(data.range.since), until: $.day(data.range.until) })}</p>
              <dl className="mt-2 grid grid-cols-2 gap-px overflow-hidden rounded-inner border border-line bg-line @md:grid-cols-5">
                {([
                  [t("Spend"), $.money(ad.m.spend)], [t("Impressions"), $.count(ad.m.impressions)], [t("CTR"), $.pct(ad.m.ctr)], [t("Installs"), $.count(ad.m.installs)], [t("CPI"), $.money(ad.m.cpi)],
                  [t("Trials"), $.count(ad.m.trials)], [t("Purchases"), $.count(ad.m.purchases)], [t("CAC"), $.money(ad.m.cac)], [t("Revenue"), $.money(ad.m.revenue)], [t("ROAS"), $.times(ad.m.roas)],
                ] as const).map(([k, v]) => (
                  <div key={k} className="bg-card px-3 py-2"><dt className="text-caption text-muted">{k}</dt><dd className="text-sm font-medium text-ink tabular-nums">{v}</dd></div>
                ))}
              </dl>
            </section>

            <section>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-medium text-ink">{t("Day by day")}</h3>
                <Segmented<Conversion> label={t("Against spend")} value={conversion} onChange={setConversion}
                  options={[{ value: "installs", label: t("Installs") }, { value: "purchases", label: t("Purchases") }]} />
              </div>
              <SpendChart ad={ad} conversion={conversion} money={$.money} count={$.count} day={$.day}
                labels={{ spend: t("Spend"), conv: conversion === "installs" ? t("Installs") : t("Purchases"), name: t("Spend and conversions per day") }} />
              <h3 className="mt-6 text-sm font-medium text-ink">{t("CAC, running 7 days")}</h3>
              {trend.some((p) => p.cac != null) ? (
                <div className="mt-3">
                  <BandLine name={t("CAC over a running 7 days")} height={150} format={(n) => $.money(n)}
                    points={trend.map((p) => ({ key: p.date, label: $.day(p.date), value: p.cac, other: null, tip: <Readout first value={$.money(p.cac)} label={$.day(p.date)} /> }))} />
                </div>
              ) : (
                <p className="mt-1 text-xs text-muted">{t("No purchases in this range yet, so there is no CAC to chart.")}</p>
              )}
            </section>

            {ad.suggestion && (
              <section>
                <h3 className="text-sm font-medium text-ink">{t("Launch's judgement")}</h3>
                <p className="mt-1 text-sm">{summaryText(tr, ad.suggestion)}</p>
                <ul className="mt-2 grid gap-1 text-xs">
                  {ad.suggestion.checks.map((c) => (
                    <li key={c.code} className="flex gap-2">
                      <span aria-hidden className={cx("w-3 shrink-0 text-center font-medium", c.pass === true ? "text-win" : c.pass === false ? "text-warn" : "text-faint")}>{c.pass === true ? "✓" : c.pass === false ? "✗" : "–"}</span>
                      <span className="min-w-0"><span className="font-medium">{t("{label}:", { label: checkLabel(tr, c, ad.suggestion!.event) })}</span> <span className="text-muted">{checkDetail(tr, c, ad.suggestion!.event, ad.currency)}</span></span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <Lineage productId={productId} ad={ad} />
          </div>
        </aside>
      </div>
    </PanelPortal>
  );
}

/** Competitor ad → studio creative → Meta ad, each step with what is known about it. */
function Lineage({ productId, ad }: { productId: string; ad: LaunchedAd }) {
  const tr = useT();
  const { t } = tr;
  const { source, creative, meta, promotedFrom } = ad.lineage;
  return (
    <section>
      <h3 className="text-sm font-medium text-ink">{t("Where it came from")}</h3>
      <ol className="mt-2 grid gap-2 @xl:grid-cols-[1fr_auto_1fr_auto_1fr] @xl:items-stretch">
        <Step title={t("Competitor ad")} thumb={source?.thumb ?? null}>
          {source ? (
            <>
              <p className="truncate font-medium text-ink">{source.pageName || t("A competitor")}</p>
              {source.headline && <p className="line-clamp-2 text-muted">{source.headline}</p>}
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                {source.url && <a href={source.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-accent hover:underline">{t("Ad Library")}<IconExternal className="size-3" /></a>}
                {source.paidAdId && <a href={workspaceHref(productId, "research")} className="font-medium text-accent hover:underline">{t("Research")}</a>}
              </div>
            </>
          ) : <p className="text-muted">{t("Not made from a competitor ad.")}</p>}
        </Step>
        <Arrow />
        <Step title={t("Studio creative")} thumb={creative?.thumbnail ?? null}>
          {creative ? (
            <>
              <p className="truncate font-medium text-ink">{creative.title || t("Untitled creative")}</p>
              {(creative.format || creative.hook) && <p className="truncate text-muted">{[creative.format, creative.hook].filter(Boolean).join(" · ")}</p>}
              {creative.prompt && <p className="line-clamp-2 text-muted" title={creative.prompt}>{creative.prompt}</p>}
              {creative.deleted
                ? <p className="mt-1 text-warn">{t("Deleted from Studio; this is the copy Launch kept.")}</p>
                : <a href={workspaceHref(productId, "studio")} className="mt-1 inline-block font-medium text-accent hover:underline">{t("Studio")}</a>}
            </>
          ) : <p className="text-muted">{t("No studio creative is linked to this ad.")}</p>}
        </Step>
        <Arrow />
        <Step title={t("Meta ad")} thumb={null}>
          {meta ? (
            <>
              <p className="truncate font-mono text-ink">{meta.adId}</p>
              {ad.adSetName && <p className="truncate text-muted">{t("Ad set: {name}", { name: ad.adSetName })}</p>}
              {promotedFrom && <p className="truncate text-muted" title={promotedFrom.name ?? promotedFrom.adId}>{t("Copied from {name}", { name: promotedFrom.name ?? promotedFrom.adId })}</p>}
              <a href={meta.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 font-medium text-accent hover:underline">{t("Open in Ads Manager")}<IconExternal className="size-3" /></a>
            </>
          ) : <p className="text-muted">{t("Not on Meta yet: {status}", { status: statusLabel(tr, ad.status) })}</p>}
        </Step>
      </ol>
    </section>
  );
}

function Step({ title, thumb, children }: { title: string; thumb: string | null; children: ReactNode }) {
  return (
    <li className="flex min-w-0 gap-2.5 rounded-inner border border-line bg-raised p-2.5 text-xs">
      {thumb && <Thumb src={thumb} alt="" size={96} className="size-12 shrink-0 rounded-md" />}
      <div className="min-w-0 flex-1">
        <p className="mb-0.5 text-caption font-medium tracking-wide text-faint uppercase">{title}</p>
        {children}
      </div>
    </li>
  );
}

function Arrow() {
  return <li aria-hidden className="hidden items-center text-faint @xl:flex"><IconArrowRight className="size-3.5" /></li>;
}

/**
 * Spend per day as columns, and installs or purchases as a line on its own scale, with a hover card.
 * Sized in percentages and drawn from theme tokens, like Measure's charts.
 */
function SpendChart({ ad, conversion, money, count, day, labels }: {
  ad: LaunchedAd; conversion: Conversion; money: (n: number) => string; count: (n: number) => string; day: (iso: string) => string;
  labels: { spend: string; conv: string; name: string };
}) {
  const [hover, setHover] = useState<number | null>(null);
  const days = ad.days;
  const n = days.length;
  const maxSpend = Math.max(...days.map((d) => d.spend), 0) * 1.1 || 1;
  const maxConv = Math.max(...days.map((d) => d[conversion]), 0) * 1.1 || 1;
  const X = (i: number) => (n <= 1 ? 50 : ((i + 0.5) / n) * 100);
  const line = days.map((d, i) => `${i ? "L" : "M"}${X(i) * 10},${100 - (d[conversion] / maxConv) * 100}`).join("");
  const pick = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    setHover(Math.min(n - 1, Math.max(0, Math.floor(((event.clientX - box.left) / box.width) * n))));
  };
  const h = hover != null ? days[hover] : null;
  return (
    <div className="mt-6">
      <div className="relative h-[170px]" role="img" aria-label={labels.name} onPointerMove={pick} onPointerLeave={() => setHover(null)}>
        <span aria-hidden className="absolute inset-x-0 bottom-0 border-t border-line" />
        <div aria-hidden className="absolute inset-0 flex items-end gap-px">
          {days.map((d, i) => (
            <span key={d.date} className={cx("flex-1 rounded-t-[2px] bg-accent/25", hover === i && "bg-accent/45")} style={{ height: `${(d.spend / maxSpend) * 100}%` }} />
          ))}
        </div>
        <svg viewBox="0 0 1000 100" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible" aria-hidden>
          <path d={line} fill="none" stroke="var(--color-ink)" strokeOpacity={0.75} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
        {h && hover != null && (
          <HoverCard style={{ left: `${X(hover)}%`, top: -8, transform: X(hover) < 25 ? "translate(-12px, -100%)" : X(hover) > 75 ? "translate(calc(-100% + 12px), -100%)" : "translate(-50%, -100%)" }}>
            <Readout first value={day(h.date)} />
            <Readout value={money(h.spend)} label={labels.spend} />
            <Readout value={count(h[conversion])} label={labels.conv} />
          </HoverCard>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between gap-3 text-xs text-muted">
        <span>{n ? day(days[0].date) : ""}</span>
        <span className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-[2px] bg-accent/40" />{labels.spend}</span>
          <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-0.5 w-3 bg-ink/75" />{labels.conv}</span>
        </span>
        <span>{n ? day(days[n - 1].date) : ""}</span>
      </div>
    </div>
  );
}
