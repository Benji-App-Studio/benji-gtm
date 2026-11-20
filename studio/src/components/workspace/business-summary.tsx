"use client";
// The app Home's "Business" card: the operating overview at a glance (the last 28 days of every
// connected source): spend, revenue, CAC, LTV:CAC, payback, the funnel from impression to paid, the best
// and worst ad, and what needs you. With nothing connected, an invitation to connect a source.
import Link from "next/link";
import type { ReactNode } from "react";
import type { BusinessSummary, NeedItem, Sourced } from "@/lib/business-summary";
import { useCached } from "@/lib/client-cache";
import { useT } from "@/lib/i18n/client";
import { SOURCE_NAME } from "@/lib/measure";
import { workspaceHref } from "@/lib/workspace-schema";
import { appSettingsHref } from "@/lib/nav-model";
import { IconAlert, IconArrowRight, IconChart, IconCheckCircle } from "../icons";
import { formatters } from "../measure/operating";
import { ButtonLink, Card, cx, Spinner, Term, Thumb } from "../ui";
import { useTermTips } from "../nav/nav-labels";

export function BusinessCard({ id }: { id: string }) {
  const tr = useT();
  const { t } = tr;
  const f = formatters(tr);
  const tips = useTermTips();
  const [summary] = useCached<BusinessSummary & { error?: string }>(`/api/w/${id}/business`);
  const measure = workspaceHref(id, "measure");
  const connectHref = appSettingsHref(id, "connections");

  if (summary === undefined) return <Card className="flex h-28 items-center justify-center"><Spinner className="size-3.5" /></Card>;
  // Measure's backend or tables aren't there yet: the Home stays as it was, without this card.
  if (!summary || summary.error) return null;

  if (!summary.anyConnection) {
    return (
      <Card className="flex flex-wrap items-center gap-4 p-4">
        <span className="grid size-9 shrink-0 place-items-center rounded-md bg-accent-soft text-accent [&_svg]:size-4"><IconChart /></span>
        <div className="min-w-0 flex-[1_1_260px]">
          <p className="text-sm font-medium">{t("Connect RevenueCat, Superwall or Mixpanel")}</p>
          <p className="mt-0.5 text-caption text-muted">{t("See revenue, CAC, LTV and payback for this app in one place. Paste a key, and the last 90 days load on their own. Any one source is enough.")}</p>
        </div>
        <ButtonLink href={connectHref} className="rounded-full">{t("Connect a source")}<IconArrowRight /></ButtonLink>
      </Card>
    );
  }

  const waiting = !summary.connected.length;
  const funnel: { label: string; item: Sourced | null }[] = [
    { label: t("Impressions"), item: summary.funnel.impressions },
    { label: t("Installs"), item: summary.funnel.installs },
    { label: t("Trials"), item: summary.funnel.trials },
    { label: t("Paid"), item: summary.funnel.paid },
  ];
  // Each amount in its own currency: spend (and the ads' cost) in the ad account's unless converted;
  // RevenueCat, Superwall and AppStack report USD; CAC only exists once spend is in USD.
  const money = (n: number | null | undefined) => f.money(n, summary.currency);
  const usd = (n: number | null | undefined) => f.money(n, "USD");
  return (
    <Card className="min-w-0 p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h2 className="text-sm font-medium">{t("Business")}</h2>
          <p className="mt-0.5 text-caption text-muted">
            {waiting ? t("Connected. The first sync loads the last 90 days.") : t("Last {n} days · {sources}", { n: summary.days, sources: summary.connected.map((s) => SOURCE_NAME[s]).join(", ") })}
          </p>
        </div>
        <Link href={measure} className="shrink-0 rounded-xs text-xs font-medium text-accent hover:underline">{t("Open Measure")}</Link>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-inner border border-line bg-line @xl:grid-cols-5">
        <Tile label={t("Spend")} value={summary.spend == null ? "–" : money(summary.spend)} source={summary.spend == null ? null : "Meta"} />
        <Tile label={t("Revenue")} value={f.money(summary.revenue?.value, summary.revenue?.currency ?? "USD")} source={summary.revenue?.source} />
        <Tile label={<Term tip={tips.cac}>{summary.cac?.blended ? t("CAC (blended)") : t("CAC")}</Term>} value={usd(summary.cac?.value)} source={summary.cac?.source} />
        <Tile label={<Term tip={tips.ltvCac}>{t("LTV : CAC")}</Term>} value={f.times(summary.ltvCac)} tone={summary.ltvCac == null ? undefined : summary.ltvCac >= 3 ? "win" : summary.ltvCac < 1 ? "warn" : undefined} />
        <Tile label={<Term tip={tips.payback}>{t("Payback")}</Term>} value={summary.paybackMonth == null ? "–" : f.month(summary.paybackMonth)} className="col-span-2 @xl:col-span-1" />
      </div>

      {funnel.some((s) => s.item) && (
        <ol className="mt-3 grid grid-cols-2 gap-2 @xl:grid-cols-4" aria-label={t("Funnel")}>
          {funnel.map((step, i) => {
            const prev = funnel[i - 1]?.item;
            const rate = step.item && prev && prev.value > 0 ? step.item.value / prev.value : null;
            return (
              <li key={step.label} className="min-w-0 rounded-inner border border-line px-3 py-2">
                <p className="flex items-center justify-between gap-2 text-xs text-muted"><span>{step.label}</span>{rate != null && <span className="tabular-nums">{f.pct(rate)}</span>}</p>
                <p className="mt-0.5 text-sm font-medium tabular-nums">{f.count(step.item?.value)}</p>
                {step.item && <p className="truncate text-[11px] text-faint">{t("from {source}", { source: step.item.source })}</p>}
              </li>
            );
          })}
        </ol>
      )}

      {(summary.best || summary.worst) && (
        <div className="mt-3 grid gap-2 @xl:grid-cols-2">
          {summary.best && <AdRow label={t("Best ad")} ad={summary.best} detail={t("{cac} per customer · {n} customers", { cac: money(summary.best.cac), n: Math.round(summary.best.customers) })} good />}
          {summary.worst && <AdRow label={t("Worst ad")} ad={summary.worst} detail={summary.worst.customers ? t("{cac} per customer · {spend} spent", { cac: money(summary.worst.cac), spend: money(summary.worst.spend) }) : t("{spend} spent, no customer yet", { spend: money(summary.worst.spend) })} />}
        </div>
      )}

      <div className="mt-3 border-t border-line pt-3">
        <p className="text-xs text-muted">{t("Needs you")}</p>
        {summary.needs.length ? (
          <ul className="mt-1.5 grid gap-1.5">
            {summary.needs.map((need, i) => <li key={i} className="flex items-start gap-2 text-sm"><IconAlert className="mt-0.5 size-3.5 shrink-0 text-caution" /><span className="min-w-0">{needText(need, t, money)}</span></li>)}
          </ul>
        ) : (
          <p className="mt-1.5 flex items-center gap-2 text-sm text-muted"><IconCheckCircle className="size-3.5 shrink-0 text-win" />{waiting ? t("Nothing yet: waiting for the first sync.") : t("Nothing urgent.")}</p>
        )}
      </div>
    </Card>
  );
}

function Tile({ label, value, source, tone, className }: { label: ReactNode; value: ReactNode; source?: string | null; tone?: "win" | "warn"; className?: string }) {
  const { t } = useT();
  return (
    <div className={cx("min-w-0 bg-card px-3 py-2.5", className)}>
      <p className="truncate text-xs text-muted">{label}</p>
      <p className={cx("mt-0.5 text-figure font-medium tabular-nums", tone === "win" ? "text-win" : tone === "warn" ? "text-warn" : "text-ink")}>{value}</p>
      {source && <p className="truncate text-[11px] text-faint">{t("from {source}", { source })}</p>}
    </div>
  );
}

function AdRow({ label, ad, detail, good }: { label: string; ad: NonNullable<BusinessSummary["best"]>; detail: string; good?: boolean }) {
  const { t } = useT();
  // A stand-in name Measure filled in ("Unnamed creative") is translated; real names stay as they are.
  const name = ad.fallbackName ? t(ad.fallbackName) : ad.name;
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-inner border border-line px-3 py-2">
      {ad.thumbnail ? <Thumb src={ad.thumbnail} alt="" className="size-8 shrink-0 rounded-md" /> : <span className={cx("size-2 shrink-0 rounded-full", good ? "bg-win" : "bg-warn")} aria-hidden />}
      <div className="min-w-0">
        <p className="text-xs text-muted">{label}</p>
        <p className="truncate text-sm font-medium" title={name}>{name}</p>
        <p className="truncate text-xs text-muted">{detail}</p>
      </div>
    </div>
  );
}

function needText(need: NeedItem, t: (text: string, vars?: Record<string, string | number>) => string, money: (n: number) => string): string {
  switch (need.kind) {
    case "sync_failed": return t("{source} didn't sync: {message}", { source: SOURCE_NAME[need.source], message: need.message || t("the last sync failed.") });
    case "above_target": return t("CAC ({cac}) is above LTV ({ltv}): every new customer loses money.", { cac: money(need.cac), ltv: money(need.ltv) });
    case "no_customers": return t("{name} spent {spend} without a customer. Pause it or change the hook.", { name: need.fallbackName ? t(need.fallbackName) : need.name, spend: money(need.spend) });
    case "ready_to_scale": return t("{name} is ready to scale ({cac} per customer in testing).", { name: need.fallbackName ? t(need.fallbackName) : need.name, cac: money(need.cac) });
    case "missing_events": return t("Mixpanel: no one did {events}. Check the event names on its connection card.", { events: need.events.map((e) => `"${e}"`).join(", ") });
  }
}
