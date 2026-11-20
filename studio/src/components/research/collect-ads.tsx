"use client";
// Collect ads: one dialog for one competitor or all of them. Before anything runs it shows which sources
// will be used, how many ads each reads at most and what that costs at most (the research function's
// `plan`), and what can't be collected and why; then it starts the collection (`pull`), follows its
// pulls while they run, and ends with one plain sentence ("41 Meta ads, 12 Google ads, TikTok: …").
// With no source on (no key, or all switched off) it says what to connect instead, and points to the
// free route: the Chrome extension's file, dropped on this page.
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { repoFileUrl } from "@/lib/brand-config";
import { featureState } from "@/lib/capabilities";
import { approxUsd } from "@/lib/ai-cost";
import {
  COLLECTING_GUIDE, collectSummary, installSources, networkOfSource, SOURCE_FEATURE, sourceInfo, SOURCES, usd, type SourceId,
} from "@/lib/ad-sources";
import { useT } from "@/lib/i18n/client";
import { researchText } from "./research-source-words";
import { sentenceGap } from "@/lib/i18n/join";
import type { InstallState } from "@/lib/install/types";
import type { PullRow } from "@/lib/research";
import { IconExternal, IconX } from "../icons";
import { MODAL, MODAL_OVERLAY, PanelPortal } from "../panel-portal";
import { Badge, Button, cx, Spinner } from "../ui";
import { rich } from "../rich";
import { LockedNote } from "./gates";
import { ReadingCostLine, readingUsd } from "./reading-cost";
import { StorageNotice, useStorageGuard } from "../storage-notice";

/** What the research function's `plan` answers (`sources` and `skipped` are absent on an older backend). */
export interface CollectPlan {
  free: number; paid: number; paidAds: number; usd: number; notes: string[];
  sources?: { id: SourceId; label: string; paid: boolean; competitors: number; maxAds: number; usd: number }[];
  skipped?: { watchId: string; name: string; source: string; reason: string }[];
}

export interface CollectTarget { ids: string[] | null; name: string | null }

type Phase = { kind: "planning" } | { kind: "ready"; plan: CollectPlan } | { kind: "starting"; plan: CollectPlan } | { kind: "running"; plan: CollectPlan; pullIds: string[]; since: number } | { kind: "error"; message: string };

type T = ReturnType<typeof useT>["t"];

async function post<R>(url: string, body: unknown, t: T): Promise<R & { error?: string }> {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  if (!response) return { error: t("Couldn't reach the server. Try again.") } as R & { error?: string };
  const data = await response.json().catch(() => ({ error: t("The server answered {status}.", { status: String(response.status) }) }));
  if (!response.ok && !data.error) data.error = t("The server answered {status}.", { status: String(response.status) });
  return data;
}

export function CollectAds({ productId, target, install, pulls, onPulled, onClose }: {
  productId: string;
  target: CollectTarget;
  install: InstallState | null;
  /** The workspace's recent pulls (the page reloads them while any runs). */
  pulls: PullRow[];
  /** A collection started: reload the page's ads and pulls. */
  onPulled: () => void;
  onClose: () => void;
}) {
  const { t } = useT();
  const url = `/api/research/${productId}`;
  const resolved = useMemo(() => installSources(install), [install]);
  // Nothing can collect: no source on (a missing key or every source switched off). Known only when the install can be read.
  const noneOn = resolved ? !Object.values(resolved.sources).some((s) => s.on) : false;
  const [phase, setPhase] = useState<Phase>({ kind: "planning" });

  const planned = useRef(false);
  useEffect(() => {
    if (noneOn || planned.current) return;
    planned.current = true;
    void (async () => {
      const plan = await post<CollectPlan>(url, { action: "plan", watchIds: target.ids ?? undefined }, t);
      if (plan.error) return setPhase({ kind: "error", message: plan.error });
      setPhase({ kind: "ready", plan });
    })();
  }, [url, target.ids, noneOn, t]);

  async function start(plan: CollectPlan, spend: boolean) {
    setPhase({ kind: "starting", plan });
    const since = Date.now();
    const result = await post<{ pullIds?: string[]; results?: { source: string; error?: string }[] }>(url, { action: "pull", spend, watchIds: target.ids ?? undefined }, t);
    if (result.error) return setPhase({ kind: "error", message: result.error });
    setPhase({ kind: "running", plan, pullIds: result.pullIds ?? [], since });
    onPulled();
  }

  const title = target.name ? t("Collect {name}'s ads", { name: target.name }) : t("Collect ads for every followed competitor");
  return (
    <PanelPortal onClose={onClose}>
      <div className={`${MODAL_OVERLAY} z-50`} onClick={onClose}>
        <div className={`${MODAL} max-w-lg`} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
          <div className="flex min-h-11 items-center justify-between gap-2 border-b border-line px-4 py-2">
            <span className="min-w-0 truncate text-sm font-medium" title={title}>{title}</span>
            <button type="button" onClick={onClose} className="grid size-7 shrink-0 place-items-center rounded-control text-muted transition hover:bg-hover hover:text-ink" aria-label={t("Close")}><IconX className="size-3.5" /></button>
          </div>
          <div className="grid gap-4 p-4">
            {noneOn && resolved
              ? <NoSource install={install!} resolved={resolved} />
              : phase.kind === "planning"
                ? <p className="flex items-center gap-2 text-sm text-muted" role="status"><Spinner />{t("Checking which sources can collect and what it costs…")}</p>
                : phase.kind === "error"
                  ? <p className="text-sm text-warn" role="alert">{phase.message}</p>
                  : phase.kind === "running"
                    ? <Progress plan={phase.plan} pulls={pulls} pullIds={phase.pullIds} since={phase.since} />
                    : <PlanView plan={phase.plan} install={install} />}
            <FreeRouteLine />
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-4 py-3">
            {phase.kind === "running"
              ? <Button size="sm" onClick={onClose}>{t("Close")}</Button>
              : <>
                <Button variant="secondary" size="sm" onClick={onClose}>{noneOn || phase.kind === "error" ? t("Close") : t("Cancel")}</Button>
                {(phase.kind === "ready" || phase.kind === "starting") && !noneOn && <StartButtons plan={phase.plan} busy={phase.kind === "starting"} onStart={(spend) => { void start(phase.plan, spend); }} />}
              </>}
          </div>
        </div>
      </div>
    </PanelPortal>
  );
}

function StartButtons({ plan, busy, onStart }: { plan: CollectPlan; busy: boolean; onStart: (spend: boolean) => void }) {
  // Collecting saves ads and their media: a warning at 95% of storage, refused when it's full.
  const storage = useStorageGuard("collect");
  const { t, intl } = useT();
  if (!plan.free && !plan.paid) return null;
  return (
    <>
      <StorageNotice action="collect" className="basis-full" />
      {plan.paid > 0 && plan.free > 0 && <Button variant="secondary" size="sm" disabled={busy || storage.block} onClick={() => onStart(false)}>{t("Free sources only")}</Button>}
      <Button size="sm" disabled={busy || storage.block} onClick={() => onStart(plan.paid > 0)}>
        {busy && <Spinner className="size-3.5" />}{plan.paid > 0 ? t("Collect, up to {usd}", { usd: usd(plan.usd, t, intl) }) : t("Collect, free")}
      </Button>
    </>
  );
}

/** The sources a collection uses, each with competitors, ads at most and cost at most; then what is skipped and why. */
function PlanView({ plan, install }: { plan: CollectPlan; install: InstallState | null }) {
  const tr = useT();
  const { t, tn, intl } = tr;
  const rows = plan.sources ?? [
    // An older backend: only the free/paid counts.
    ...(plan.free ? [{ id: "metaApi" as SourceId, label: t("Free sources"), paid: false, competitors: plan.free, maxAds: 0, usd: 0 }] : []),
    ...(plan.paid ? [{ id: "metaApify" as SourceId, label: t("Automatic collection (Apify)"), paid: true, competitors: plan.paid, maxAds: plan.paidAds, usd: plan.usd }] : []),
  ];
  // The research function writes its reasons and notes in English (research-source-words.ts translates them).
  const reasons = [...new Set((plan.skipped ?? []).map((s) => researchText(s.reason, tr)))];
  const notes = plan.notes.map((line) => researchText(line, tr));
  // Every ad that comes in is read by the AI afterwards (a separate OpenAI cost); free sources count too.
  const adsIn = rows.reduce((n, s) => n + s.maxAds, 0);
  const reading = readingUsd(adsIn, install);
  if (!rows.length) {
    return (
      <div className="grid gap-2 text-sm">
        <p className="font-medium text-ink">{t("Nothing to collect with the sources that are on.")}</p>
        {[...reasons, ...notes].map((line) => <p key={line} className="text-muted">{line}</p>)}
        <p className="text-muted">{rich(t("Turn sources on in {link}."), { link: <Link href="/app/settings/research" className="font-medium text-accent hover:underline">{t("Settings › Research sources")}</Link> })}</p>
      </div>
    );
  }
  return (
    <div className="grid gap-3">
      <ul className="-mx-2 grid">
        {rows.map((s) => (
          <li key={s.id} className="flex min-h-10 items-center gap-3 rounded-control px-2 py-1.5">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink">{sourceInfo(s.id) ? t(sourceInfo(s.id).label) : s.label}</p>
              <p className="text-xs text-muted">{tn(s.competitors, "{n} competitor", "{n} competitors")}{s.maxAds ? ` · ${tn(s.maxAds, "up to {n} ad", "up to {n} ads")}` : ""}</p>
            </div>
            {s.paid ? <span className="shrink-0 text-sm text-label tabular-nums">{t("up to {usd}", { usd: usd(s.usd, t, intl) })}</span> : <Badge tone="win">{t("Free")}</Badge>}
          </li>
        ))}
        {adsIn > 0 && (
          <li className="flex min-h-10 items-center gap-3 rounded-control px-2 py-1.5">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink">{t("Reading the ads with AI")}</p>
              <p className="text-xs text-muted">{install?.aiProvider === "typesafe" ? "TypeSafe" : "OpenAI"} · {tn(adsIn, "up to {n} ad", "up to {n} ads")} · {t("an estimate")}</p>
            </div>
            <span className="shrink-0 text-sm text-label tabular-nums">{reading == null ? t("billed by TypeSafe") : t("up to {usd}", { usd: approxUsd(reading, intl, t) })}</span>
          </li>
        )}
      </ul>
      {plan.paid > 0 && (
        <p className="text-xs text-muted">
          {tn(plan.paidAds, "Up to {n} ad for at most {usd}, billed per ad by Apify from your Apify credit. Most collections stop well below the limit: a brand with 30 live ads costs for 30.", "Up to {n} ads for at most {usd}, billed per ad by Apify from your Apify credit. Most collections stop well below the limit: a brand with 30 live ads costs for 30.", { usd: usd(plan.usd, t, intl) })}
        </p>
      )}
      {adsIn > 0 && <ReadingCostLine ads={adsIn} install={install} upTo />}
      {(reasons.length > 0 || notes.length > 0) && (
        <ul className="grid gap-1 border-t border-line pt-3 text-xs text-muted">
          {[...reasons, ...notes].map((line) => <li key={line}>{line}</li>)}
        </ul>
      )}
    </div>
  );
}

/** While it runs: each source's pull, then the sentence it ended with. */
function Progress({ plan, pulls, pullIds, since }: { plan: CollectPlan; pulls: PullRow[]; pullIds: string[]; since: number }) {
  // An older backend doesn't answer the pull ids: the pulls that started with this collection.
  const mine = pullIds.length ? pulls.filter((p) => pullIds.includes(p.id)) : pulls.filter((p) => Date.parse(p.started_at) >= since - 5_000);
  const waiting = pullIds.length ? pullIds.length - mine.length : 0;
  const running = mine.filter((p) => p.status === "running").length + waiting;
  const europeOnly = (plan.skipped ?? []).some((s) => s.source === "tiktok");
  const tiktokPlanned = (plan.sources ?? []).some((s) => s.id.startsWith("tiktok"));
  const { t } = useT();
  if (running) {
    const names = [...new Set(mine.filter((p) => p.status === "running").map((p) => networkOfSource(p.source)).filter(Boolean))];
    return (
      <div className="grid gap-2">
        <p className="flex items-center gap-2 text-sm text-ink" role="status"><Spinner />{names.length ? t("Collecting from {networks}…", { networks: names.map((n) => n === "meta" ? "Meta" : n === "google" ? "Google" : "TikTok").join(", ") }) : t("Collecting…")}</p>
        <p className="text-xs text-muted">{t("Apify runs usually take one to five minutes. You can close this: it keeps going, and the ads show up on this page when it ends.")}</p>
      </div>
    );
  }
  return (
    <div className="grid gap-1">
      <p className="text-sm font-medium text-ink" role="status">{t("Done: {summary}.", { summary: collectSummary(mine, { europeOnly, tiktokPlanned }, t) })}</p>
      <p className="text-xs text-muted">{t("New ads are read for their format and hook in the background.")}</p>
    </div>
  );
}

/** Nothing is on: what each source needs, with where to connect it. */
function NoSource({ install, resolved }: { install: InstallState; resolved: NonNullable<ReturnType<typeof installSources>> }) {
  const { t, intl } = useT();
  const apify = featureState(SOURCE_FEATURE.metaApify, install, null, { t, intl });
  const off = SOURCES.filter((s) => resolved.sources[s.id].reason === "off").map((s) => t(s.label));
  return (
    <div className="grid gap-3 text-sm">
      <p className="text-ink">{t("No source can collect yet.")}</p>
      {!apify.ok && (
        <div className="grid gap-1.5">
          <LockedNote state={apify} className="w-fit">{t("Needs your Apify key")}</LockedNote>
          <p className="text-xs text-muted">{t("With an Apify key, Meta and Google ads come in automatically in any country, billed per ad from your Apify credit (the free plan includes $5 a month).")}</p>
        </div>
      )}
      {off.length > 0 && apify.ok && (
        <p className="text-xs text-muted">{rich(t("Switched off: {sources}. Turn them on in {link}."), { sources: off.join(", "), link: <Link href="/app/settings/research" className="font-medium text-accent hover:underline">{t("Settings › Research sources")}</Link> })}</p>
      )}
    </div>
  );
}

function FreeRouteLine({ className }: { className?: string }) {
  const { t, locale } = useT();
  return (
    <p className={cx("rounded-small border border-line bg-raised px-3 py-2 text-xs text-muted", className)}>
      {rich(t("{free} the Chrome extension saves a competitor's Meta ads as a file you drop on this page (steps under “How to get ads in”)."), { free: <span className="font-medium text-label">{t("Free, no key:")}</span> })}
      {sentenceGap(locale)}<a href={repoFileUrl(COLLECTING_GUIDE)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-accent hover:underline">{t("The three ways to get ads")}<IconExternal className="size-3" /></a>
    </p>
  );
}
