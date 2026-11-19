"use client";
// Collect ads: one dialog for one competitor or all of them. Before anything runs it shows which sources
// will be used, how many ads each reads at most and what that costs at most (the research function's
// `plan`), and what can't be collected and why; then it starts the collection (`pull`), follows its
// pulls while they run, and ends with one plain sentence ("41 Meta ads, 12 Google ads, TikTok: …").
// With no source on (no key, or all switched off) it says what to connect instead, and points to the
// free route: the Chrome extension's file, dropped on this page.
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { repoFileUrl } from "@/lib/brand-config";
import { featureState } from "@/lib/capabilities";
import { approxUsd } from "@/lib/ai-cost";
import {
  COLLECTING_GUIDE, collectSummary, installSources, networkOfSource, SOURCE_FEATURE, sourceInfo, SOURCES, usd, type SourceId,
} from "@/lib/ad-sources";
import type { InstallState } from "@/lib/install/types";
import type { PullRow } from "@/lib/research";
import { IconExternal, IconX } from "../icons";
import { MODAL, MODAL_OVERLAY, PanelPortal } from "../panel-portal";
import { Badge, Button, cx, Spinner } from "../ui";
import { LockedNote } from "./gates";
import { ReadingCostLine, readingUsd } from "./reading-cost";
import { UI_LOCALE } from "@/lib/ui-locale";
import { StorageNotice, useStorageGuard } from "../storage-notice";

/** What the research function's `plan` answers (`sources` and `skipped` are absent on an older backend). */
export interface CollectPlan {
  free: number; paid: number; paidAds: number; usd: number; notes: string[];
  sources?: { id: SourceId; label: string; paid: boolean; competitors: number; maxAds: number; usd: number }[];
  skipped?: { watchId: string; name: string; source: string; reason: string }[];
}

export interface CollectTarget { ids: string[] | null; name: string | null }

type Phase = { kind: "planning" } | { kind: "ready"; plan: CollectPlan } | { kind: "starting"; plan: CollectPlan } | { kind: "running"; plan: CollectPlan; pullIds: string[]; since: number } | { kind: "error"; message: string };

async function post<T>(url: string, body: unknown): Promise<T & { error?: string }> {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  if (!response) return { error: "Couldn't reach the server. Try again." } as T & { error?: string };
  const data = await response.json().catch(() => ({ error: `The server answered ${response.status}.` }));
  if (!response.ok && !data.error) data.error = `The server answered ${response.status}.`;
  return data;
}

const plural = (n: number, word: string) => `${n.toLocaleString(UI_LOCALE)} ${word}${n === 1 ? "" : "s"}`;

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
      const plan = await post<CollectPlan>(url, { action: "plan", watchIds: target.ids ?? undefined });
      if (plan.error) return setPhase({ kind: "error", message: plan.error });
      setPhase({ kind: "ready", plan });
    })();
  }, [url, target.ids, noneOn]);

  async function start(plan: CollectPlan, spend: boolean) {
    setPhase({ kind: "starting", plan });
    const since = Date.now();
    const result = await post<{ pullIds?: string[]; results?: { source: string; error?: string }[] }>(url, { action: "pull", spend, watchIds: target.ids ?? undefined });
    if (result.error) return setPhase({ kind: "error", message: result.error });
    setPhase({ kind: "running", plan, pullIds: result.pullIds ?? [], since });
    onPulled();
  }

  const title = target.name ? `Collect ${target.name}'s ads` : "Collect ads for every followed competitor";
  return (
    <PanelPortal onClose={onClose}>
      <div className={`${MODAL_OVERLAY} z-50`} onClick={onClose}>
        <div className={`${MODAL} max-w-lg`} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
          <div className="flex min-h-11 items-center justify-between gap-2 border-b border-line px-4 py-2">
            <span className="min-w-0 truncate text-sm font-medium" title={title}>{title}</span>
            <button type="button" onClick={onClose} className="grid size-7 shrink-0 place-items-center rounded-control text-muted transition hover:bg-hover hover:text-ink" aria-label="Close"><IconX className="size-3.5" /></button>
          </div>
          <div className="grid gap-4 p-4">
            {noneOn && resolved
              ? <NoSource install={install!} resolved={resolved} />
              : phase.kind === "planning"
                ? <p className="flex items-center gap-2 text-sm text-muted" role="status"><Spinner />Checking which sources can collect and what it costs…</p>
                : phase.kind === "error"
                  ? <p className="text-sm text-warn" role="alert">{phase.message}</p>
                  : phase.kind === "running"
                    ? <Progress plan={phase.plan} pulls={pulls} pullIds={phase.pullIds} since={phase.since} />
                    : <PlanView plan={phase.plan} install={install} />}
            <FreeRouteLine />
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-4 py-3">
            {phase.kind === "running"
              ? <Button size="sm" onClick={onClose}>Close</Button>
              : <>
                <Button variant="secondary" size="sm" onClick={onClose}>{noneOn || phase.kind === "error" ? "Close" : "Cancel"}</Button>
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
  if (!plan.free && !plan.paid) return null;
  return (
    <>
      <StorageNotice action="collect" className="basis-full" />
      {plan.paid > 0 && plan.free > 0 && <Button variant="secondary" size="sm" disabled={busy || storage.block} onClick={() => onStart(false)}>Free sources only</Button>}
      <Button size="sm" disabled={busy || storage.block} onClick={() => onStart(plan.paid > 0)}>
        {busy && <Spinner className="size-3.5" />}{plan.paid > 0 ? `Collect, up to ${usd(plan.usd)}` : "Collect, free"}
      </Button>
    </>
  );
}

/** The sources a collection uses, each with competitors, ads at most and cost at most; then what is skipped and why. */
function PlanView({ plan, install }: { plan: CollectPlan; install: InstallState | null }) {
  const rows = plan.sources ?? [
    // An older backend: only the free/paid counts.
    ...(plan.free ? [{ id: "metaApi" as SourceId, label: "Free sources", paid: false, competitors: plan.free, maxAds: 0, usd: 0 }] : []),
    ...(plan.paid ? [{ id: "metaApify" as SourceId, label: "Automatic collection (Apify)", paid: true, competitors: plan.paid, maxAds: plan.paidAds, usd: plan.usd }] : []),
  ];
  const reasons = [...new Set((plan.skipped ?? []).map((s) => s.reason))];
  // Every ad that comes in is read by the AI afterwards (a separate OpenAI cost); free sources count too.
  const adsIn = rows.reduce((n, s) => n + s.maxAds, 0);
  const reading = readingUsd(adsIn, install);
  if (!rows.length) {
    return (
      <div className="grid gap-2 text-sm">
        <p className="font-medium text-ink">Nothing to collect with the sources that are on.</p>
        {[...reasons, ...plan.notes].map((line) => <p key={line} className="text-muted">{line}</p>)}
        <p className="text-muted">Turn sources on in <Link href="/app/settings/research" className="font-medium text-accent hover:underline">Settings &gt; Research sources</Link>.</p>
      </div>
    );
  }
  return (
    <div className="grid gap-3">
      <ul className="-mx-2 grid">
        {rows.map((s) => (
          <li key={s.id} className="flex min-h-10 items-center gap-3 rounded-control px-2 py-1.5">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink">{sourceInfo(s.id)?.label ?? s.label}</p>
              <p className="text-xs text-muted">{plural(s.competitors, "competitor")}{s.maxAds ? ` · up to ${plural(s.maxAds, "ad")}` : ""}</p>
            </div>
            {s.paid ? <span className="text-sm text-label tabular-nums">up to {usd(s.usd)}</span> : <Badge tone="win">Free</Badge>}
          </li>
        ))}
        {adsIn > 0 && (
          <li className="flex min-h-10 items-center gap-3 rounded-control px-2 py-1.5">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink">Reading the ads with AI</p>
              <p className="text-xs text-muted">{install?.aiProvider === "typesafe" ? "TypeSafe" : "OpenAI"} · up to {plural(adsIn, "ad")} · an estimate</p>
            </div>
            <span className="text-sm text-label tabular-nums">{reading == null ? "billed by TypeSafe" : `up to ${approxUsd(reading)}`}</span>
          </li>
        )}
      </ul>
      {plan.paid > 0 && (
        <p className="text-xs text-muted">
          Up to {plural(plan.paidAds, "ad")} for at most {usd(plan.usd)}, billed per ad by Apify from your Apify credit. Most collections stop well below the limit: a brand with 30 live ads costs for 30.
        </p>
      )}
      {adsIn > 0 && <ReadingCostLine ads={adsIn} install={install} upTo />}
      {(reasons.length > 0 || plan.notes.length > 0) && (
        <ul className="grid gap-1 border-t border-line pt-3 text-xs text-muted">
          {[...reasons, ...plan.notes].map((line) => <li key={line}>{line}</li>)}
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
  if (running) {
    const names = [...new Set(mine.filter((p) => p.status === "running").map((p) => networkOfSource(p.source)).filter(Boolean))];
    return (
      <div className="grid gap-2">
        <p className="flex items-center gap-2 text-sm text-ink" role="status"><Spinner />Collecting{names.length ? ` from ${names.map((n) => n === "meta" ? "Meta" : n === "google" ? "Google" : "TikTok").join(", ")}` : ""}…</p>
        <p className="text-xs text-muted">Apify runs usually take one to five minutes. You can close this: it keeps going, and the ads show up on this page when it ends.</p>
      </div>
    );
  }
  return (
    <div className="grid gap-1">
      <p className="text-sm font-medium text-ink" role="status">Done: {collectSummary(mine, { europeOnly, tiktokPlanned })}.</p>
      <p className="text-xs text-muted">New ads are read for their format and hook in the background.</p>
    </div>
  );
}

/** Nothing is on: what each source needs, with where to connect it. */
function NoSource({ install, resolved }: { install: InstallState; resolved: NonNullable<ReturnType<typeof installSources>> }) {
  const apify = featureState(SOURCE_FEATURE.metaApify, install);
  const off = SOURCES.filter((s) => resolved.sources[s.id].reason === "off").map((s) => s.label);
  return (
    <div className="grid gap-3 text-sm">
      <p className="text-ink">No source can collect yet.</p>
      {!apify.ok && (
        <div className="grid gap-1.5">
          <LockedNote state={apify} className="w-fit">Needs your Apify key</LockedNote>
          <p className="text-xs text-muted">With an Apify key, Meta and Google ads come in automatically in any country, billed per ad from your Apify credit (the free plan includes $5 a month).</p>
        </div>
      )}
      {off.length > 0 && apify.ok && (
        <p className="text-xs text-muted">Switched off: {off.join(", ")}. Turn them on in <Link href="/app/settings/research" className="font-medium text-accent hover:underline">Settings &gt; Research sources</Link>.</p>
      )}
    </div>
  );
}

function FreeRouteLine({ className }: { className?: string }) {
  return (
    <p className={cx("rounded-small border border-line bg-raised px-3 py-2 text-xs text-muted", className)}>
      <span className="font-medium text-label">Free, no key:</span> the Chrome extension saves a competitor&apos;s Meta ads as a file you drop on this page (steps under &ldquo;How to get ads in&rdquo;).{" "}
      <a href={repoFileUrl(COLLECTING_GUIDE)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-accent hover:underline">The three ways to get ads<IconExternal className="size-3" /></a>
    </p>
  );
}
