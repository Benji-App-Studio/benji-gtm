"use client";
// The landing page's product pictures, drawn with the app's own pieces (measure charts and KPIs, the
// research placement icons and fit dots, the shared badges and pills) on made-up sample data, so they
// follow the theme, the language and every screen width like the app does. The data is the example app's
// (Trailmix, a hike planner, and its competitors: components/preview/sample-world.ts), so the cards and
// /example tell the same story; the numbers are in sample-numbers.ts. Nothing here is a customer.
import type { ReactNode } from "react";
import { useT } from "@/lib/i18n/client";
import { HatchedBars, Waterfall } from "../measure/charts";
import { KeyValue, Kpi, StatusChip } from "../measure/kit";
import { FitDot } from "../research/fit";
import { PlacementIcons } from "../research/placement-icons";
import { IconArrowRight, IconCarousel, IconImage, IconPlay } from "../icons";
import { Badge, cx, StatusPill } from "../ui";
import { LANDING_SAMPLE as S } from "./sample-numbers";

const usd = (n: number) => `$${n.toFixed(2)}`;

/** The frame every picture sits in: a small "Sample data" note so nobody mistakes it for real numbers. */
function Frame({ children, className }: { children: ReactNode; className?: string }) {
  const { t } = useT();
  return (
    <div inert className={cx("relative min-w-0 select-none", className)}>
      <span className="absolute -top-2.5 right-3 z-[2] rounded-full border border-line bg-canvas px-2 text-[11px] leading-5 text-muted">{t("Sample data")}</span>
      {children}
    </div>
  );
}

/** A creative's stand-in: a tinted 4:5 tile with its hook written on it. */
function AdTile({ hook, kind, tone = "accent", className }: { hook: string; kind: "video" | "image" | "carousel"; tone?: "accent" | "win" | "caution"; className?: string }) {
  const Icon = kind === "video" ? IconPlay : kind === "carousel" ? IconCarousel : IconImage;
  return (
    <span className={cx("relative flex aspect-[4/5] flex-col justify-end overflow-hidden rounded-small border border-line p-2",
      tone === "accent" ? "bg-accent-soft" : tone === "win" ? "bg-win-soft" : "bg-caution-soft", className)}>
      <span className={cx("hatch absolute inset-x-0 top-0 h-1/2 opacity-40", tone === "accent" ? "text-accent-muted" : tone === "win" ? "text-win" : "text-caution")} />
      <span className="absolute top-1.5 left-1.5 grid size-5 place-items-center rounded-full bg-raised/90 text-ink [&_svg]:size-3"><Icon /></span>
      <span className="relative line-clamp-3 text-[11px] leading-snug font-medium text-ink">{hook}</span>
    </span>
  );
}

// MARK: Research

export function ResearchPreview() {
  const { t, tn } = useT();
  const ads = [
    { key: "peak-1", brand: "Peakfinder", hook: t("Find a trail in 30 seconds"), kind: "image" as const, days: 64, placements: ["facebook", "instagram"], fit: "fits" as const },
    { key: "ridge-1", brand: "Ridgeline", hook: t("No signal? No problem."), kind: "carousel" as const, days: 45, placements: ["facebook", "instagram"], fit: "partly" as const },
    { key: "peak-2", brand: "Peakfinder", hook: t("The app hikers rate 4.7"), kind: "image" as const, days: 31, placements: ["facebook", "instagram", "threads"], fit: "fits" as const },
  ];
  const kindLabel = { video: t("Video"), image: t("Image"), carousel: t("Carousel") };
  return (
    <Frame>
      <div className="rounded-card border border-line bg-card p-1.5">
        <div className="flex items-center justify-between px-2 pt-1.5 pb-2 text-xs text-muted">
          <span className="font-medium text-ink">{t("Longest-running ads")}</span>
          <span>{t("Meta Ad Library")}</span>
        </div>
        <ul className="grid gap-0.5">
          {ads.map((ad, i) => (
            <li key={ad.key} className={cx("flex min-w-0 items-center gap-3 rounded-control px-2 py-1.5", i === 0 && "bg-hover")}>
              <AdTile hook={ad.hook} kind={ad.kind} tone={i === 1 ? "caution" : "accent"} className="w-11 shrink-0 p-1 [&>span:last-child]:hidden" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-sm font-medium text-ink"><span className="truncate">{ad.brand}</span><Badge className="hidden sm:inline-flex">{kindLabel[ad.kind]}</Badge></span>
                <span className="block truncate text-caption text-muted">“{ad.hook}”</span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1">
                <span className="text-xs font-medium text-ink tabular-nums">{tn(ad.days, "{n} day", "{n} days")}</span>
                <span className="flex items-center gap-1.5">
                  <span className="hidden min-[420px]:contents"><PlacementIcons placements={ad.placements} size={12} /></span>
                  <span className="inline-flex items-center gap-1 text-xs text-muted"><FitDot level={ad.fit} />{ad.fit === "fits" ? t("Fits") : t("Partly")}</span>
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Frame>
  );
}

// MARK: Make this for your app

export function MakePreview() {
  const { t } = useT();
  return (
    <Frame>
      <div className="rounded-card border border-line bg-card p-3">
        <div className="mx-auto grid max-w-[320px] grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 sm:gap-3">
          <div className="min-w-0">
            <p className="mb-1.5 truncate text-xs text-muted">{t("Their ad")}</p>
            <AdTile hook={t("Find a trail in 30 seconds")} kind="image" />
          </div>
          <span className="grid size-7 place-items-center rounded-full border border-hairline bg-raised text-muted [&_svg]:size-3.5"><IconArrowRight /></span>
          <div className="min-w-0">
            <p className="mb-1.5 truncate text-xs text-muted">{t("Your version")}</p>
            <AdTile hook={t("Plan a weekend hike in a minute.")} kind="image" tone="win" />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
          <StatusPill tone="win">{t("Checks passed")}</StatusPill>
          <Badge tone="accent">{t("Solution aware")}</Badge>
          <Badge>4:5</Badge>
        </div>
      </div>
    </Frame>
  );
}

// MARK: Launch

export function LaunchPreview() {
  const { t, tn } = useT();
  return (
    <Frame>
      <div className="rounded-card border border-line bg-card px-4 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2 py-1.5">
          <span className="text-sm font-medium text-ink">{t("Send to Meta")}</span>
          <StatusChip label={t("Created paused")} tone="neutral" />
        </div>
        <KeyValue label={t("Campaign")} value={<span className="truncate">{t("Trailmix · App installs")}</span>} />
        <KeyValue label={t("Ad set")} value={t("US · 18–44")} />
        <KeyValue label={t("Daily budget")} value={usd(S.dailyBudget)} />
        <KeyValue label={t("Placements")} value={<PlacementIcons placements={["facebook", "instagram", "audience_network"]} size={13} />} />
        <KeyValue label={t("Ads")} value={tn(3, "{n} creative", "{n} creatives")} />
      </div>
    </Frame>
  );
}

// MARK: Measure

/** Measure's own pieces as its page shows them: the KPI strip, spend per day against the budget, and where a customer's value goes. */
export function MeasurePreview() {
  const { t, tn } = useT();
  const spend = S.spendPerDay;
  return (
    <Frame>
      <div className="grid gap-3">
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-line bg-line lg:grid-cols-4">
          <Kpi label={t("CAC")} value={usd(S.cac)} />
          <Kpi label={t("LTV")} value={usd(S.ltv)} />
          <Kpi label={t("LTV : CAC")} value={`${S.ltvCac.toFixed(1)}×`} tone={S.ltvCac >= 3 ? "win" : undefined} />
          <Kpi label={t("Payback")} value={tn(S.paybackMonth, "{n} month", "{n} months")} />
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="min-w-0 rounded-card border border-line bg-card p-4">
            <p className="text-sm font-medium text-ink">{t("Spend per day")}</p>
            <HatchedBars name={t("Spend per day")} height={132} format={(n) => `$${Math.round(n)}`} target={{ value: S.budgetPerDay, label: t("Budget {amount}", { amount: `$${S.budgetPerDay}` }) }}
              points={spend.map((value, i) => ({ key: String(i), label: t("Day {n}", { n: i + 1 }), value }))} />
          </div>
          <div className="min-w-0 rounded-card border border-line bg-card p-4">
            <p className="text-sm font-medium text-ink">{t("Where a customer's value goes")}</p>
            <p className="mb-3 text-caption text-muted">{t("LTV, less what each kind of campaign costs per customer")}</p>
            <Waterfall format={usd}
              start={{ label: t("LTV"), value: S.ltv }}
              steps={[{ label: t("Testing campaigns"), value: -S.testingCost }, { label: t("Scaling campaigns"), value: -S.scalingCost }]}
              end={{ label: t("Margin per customer"), value: S.margin }} />
          </div>
        </div>
      </div>
    </Frame>
  );
}

// MARK: Data sources

export function SourcesPreview() {
  const { t } = useT();
  const sources = [
    { name: "Meta", mark: "M", what: t("Spend, installs and results per ad") },
    { name: "RevenueCat", mark: "R", what: t("Subscriptions, renewals and refunds") },
    { name: "Superwall", mark: "S", what: t("Paywall views and conversions") },
    { name: "Mixpanel", mark: "Mp", what: t("Sign-ups and what people do in the app") },
  ];
  return (
    <Frame>
      <ul className="rounded-card border border-line bg-card p-1.5">
        {sources.map((source) => (
          <li key={source.name} className="flex items-center gap-3 rounded-control px-2 py-2">
            <span className="grid size-7 shrink-0 place-items-center rounded-control bg-primary text-xs font-semibold text-on-ink">{source.mark}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-ink">{source.name}</span>
              <span className="block truncate text-caption text-muted">{source.what}</span>
            </span>
            <StatusChip label={t("Example")} tone="neutral" />
          </li>
        ))}
      </ul>
    </Frame>
  );
}
