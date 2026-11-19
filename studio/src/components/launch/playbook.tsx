"use client";
// The Meta ads playbook on the Launch page: warming up a new ad account, the attribution steps
// (SDK → MMP alongside → MMP campaigns) and scaling advice for the scaling ad set. All optional:
// each card can be skipped or marked done, and nothing here changes anything on Meta.
import { useState } from "react";
import { EVENT_LABEL, type Thresholds } from "@/lib/launch/promotion";
import type { ScalingAdvice } from "@/lib/launch/scaling";
import type { AttributionStep, ConnectionStatus, LaunchOverview, Playbook, WarmupStatus } from "@/lib/launch/types";
import { notice } from "../dialog";
import { IconCheckCircle, IconClock, IconTrendUp } from "../icons";
import { PlaybookTip } from "../playbook-tip";
import { Badge, Button, Card, cx } from "../ui";
import { money, Section, send } from "./parts";

const WARMUP_DAYS = { min: 3, max: 5 };

function usePlaybookSave(productId: string, playbook: Playbook, onSaved: () => Promise<unknown>) {
  const [busy, setBusy] = useState(false);
  return {
    busy,
    async save(patch: Playbook) {
      setBusy(true);
      try { await send(`/api/launch/${productId}`, { playbook: { ...playbook, ...patch } }, "PATCH"); await onSaved(); }
      catch (error) { notice(error instanceof Error ? error.message : "Couldn't save."); }
      setBusy(false);
    },
  };
}

const Step = ({ n, done, children }: { n: number; done?: boolean; children: React.ReactNode }) => (
  <li className="flex gap-2.5">
    <span className={cx("grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-medium", done ? "bg-win text-on-ink" : "bg-control text-muted")}>{done ? "✓" : n}</span>
    <span className="min-w-0 text-sm">{children}</span>
  </li>
);

// MARK: Warm-up

export function WarmupCard({ productId, overview, onSaved }: { productId: string; overview: LaunchOverview; onSaved: () => Promise<unknown> }) {
  const playbook = overview.settings?.playbook ?? {};
  const warmup = playbook.warmup ?? { status: "not_started" as WarmupStatus };
  const { busy, save } = usePlaybookSave(productId, playbook, onSaved);
  const fresh = overview.volume.spend28 === 0;
  // The page's load time is "now": the day count only needs to be right to the day.
  const [now] = useState(() => Date.now());
  const day = warmup.startedAt ? Math.floor((now - Date.parse(warmup.startedAt)) / 86_400_000) + 1 : 0;
  const accountUrl = overview.status.account?.url;
  const set = (status: WarmupStatus) => save({ warmup: { status, startedAt: status === "running" ? new Date().toISOString() : warmup.startedAt ?? null } });

  if (warmup.status === "done" || warmup.status === "skipped") {
    return (
      <Card className="flex flex-wrap items-center gap-2 p-4 text-sm">
        <IconCheckCircle className="size-4 text-win" />
        <span className="font-medium">Account warm-up</span>
        <span className="text-muted">{warmup.status === "done" ? "done" : "skipped (the account has history)"}</span>
        <button type="button" disabled={busy} onClick={() => set("not_started")} className="ml-auto text-xs font-medium text-accent hover:underline">Undo</button>
      </Card>
    );
  }
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">Warm up the ad account</span>
        <Badge tone="neutral">optional</Badge>
        {fresh && warmup.status === "not_started" && <Badge tone="caution">no spend in 28 days</Badge>}
        {warmup.status === "running" && <Badge tone={day >= WARMUP_DAYS.min ? "win" : "accent"}>day {day} of {WARMUP_DAYS.min}–{WARMUP_DAYS.max}</Badge>}
      </div>
      <p className="mt-1 text-sm text-muted">Meta knows nothing about a fresh account. A few days of healthy engagement first gives conversion ads a cleaner start (fewer rejections, steadier delivery). It won&apos;t make a weak ad profitable; it just starts on the right foot.</p>
      <ol className="mt-3 grid gap-2">
        <Step n={1} done={warmup.status === "running"}>Create an <strong className="font-medium">Engagement</strong> campaign in Ads Manager. Sell nothing.</Step>
        <Step n={2} done={warmup.status === "running"}>Use simple static images people like to react to (puppies, babies). A small budget is plenty: about $37 bought ~2,400 engagements at $0.02 in the playbook&apos;s example.</Step>
        <Step n={3} done={warmup.status === "running" && day > WARMUP_DAYS.min}>Let it run {WARMUP_DAYS.min}–{WARMUP_DAYS.max} days. Avoid switching things on and off or big edits meanwhile.</Step>
        <Step n={4}>Then publish the app drafts from Launch and optimise for the conversion you care about.</Step>
      </ol>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {warmup.status === "not_started" && <Button size="sm" variant="secondary" disabled={busy} onClick={() => set("running")}>I&apos;ve started the warm-up</Button>}
        {warmup.status === "running" && <Button size="sm" variant="secondary" disabled={busy} onClick={() => set("done")}>Mark warmed up</Button>}
        {accountUrl && <a href={accountUrl} target="_blank" rel="noreferrer" className="text-sm font-medium text-accent hover:underline">Open Ads Manager ↗</a>}
        <button type="button" disabled={busy} onClick={() => set("skipped")} className="ml-auto text-xs text-muted hover:text-ink">Skip, the account has history</button>
      </div>
    </Card>
  );
}

// MARK: Attribution

const ATTRIBUTION: { step: AttributionStep; title: string; body: string }[] = [
  { step: "sdk", title: "Meta SDK with your key events", body: "Install, trial start and purchase sent from the app through Meta's SDK (or Pixel + Conversions API on the web). Run SDK-optimised campaigns straight away." },
  { step: "mmp_collecting", title: "MMP collecting alongside", body: "Connect the MMP (AppStack here) while the SDK campaigns run, so it builds conversion history." },
  { step: "mmp", title: "Switch events to the MMP", body: "Once the MMP has enough conversions, set the app's events to come from it in Ads Manager (the app's integrations) and optimise on them." },
];

export function AttributionCard({ productId, overview, thresholds, onSaved }: { productId: string; overview: LaunchOverview; thresholds: Thresholds; onSaved: () => Promise<unknown> }) {
  const playbook = overview.settings?.playbook ?? {};
  const current = playbook.attribution?.step ?? "sdk";
  const { busy, save } = usePlaybookSave(productId, playbook, onSaved);
  const index = ATTRIBUTION.findIndex((a) => a.step === current);
  const e = EVENT_LABEL[thresholds.conversionEvent];
  const enough = overview.volume.last7 >= 50;
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">Attribution: SDK first, MMP later</span>
        <Badge tone="neutral">optional</Badge>
      </div>
      <p className="mt-1 text-sm text-muted">Not SDK <em>or</em> MMP: the SDK gets campaigns learning now; the MMP gives better attribution once it has data. Starting on the MMP from day one usually starves learning.</p>
      <ol className="mt-3 grid gap-2.5">
        {ATTRIBUTION.map((a, i) => (
          <li key={a.step} className={cx("flex gap-2.5 rounded-md p-2", i === index && "bg-hover")}>
            <span className={cx("grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-medium", i < index ? "bg-win text-on-ink" : i === index ? "bg-primary text-on-ink" : "bg-control text-muted")}>{i < index ? "✓" : i + 1}</span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                {a.title}
                {a.step === "mmp_collecting" && <Badge tone={overview.mmpConnected ? "win" : "neutral"}>{overview.mmpConnected ? "AppStack connected" : "no MMP connected"}</Badge>}
                {a.step === "mmp" && <Badge tone={enough ? "win" : "neutral"}>{overview.volume.last7} {e.many} in 7 days</Badge>}
                {a.step === "mmp" && !enough && <span className="text-xs font-normal text-muted">About 50 a week is enough.</span>}
              </span>
              <span className="block text-xs text-muted">{a.body}</span>
            </span>
            {i !== index && <button type="button" disabled={busy} onClick={() => save({ attribution: { step: a.step } })} className="self-center text-xs font-medium text-accent hover:underline">I&apos;m here</button>}
          </li>
        ))}
      </ol>
      {current === "mmp_collecting" && enough && <p className="mt-3 text-xs text-win">You have enough volume to move the optimisation events to the MMP.</p>}
    </Card>
  );
}

// MARK: Scaling

const MOVE: Record<ScalingAdvice["move"], { label: string; tone: "win" | "warn" | "neutral" | "accent" | "caution" }> = {
  setup: { label: "Set up", tone: "neutral" },
  promote_first: { label: "Promote first", tone: "neutral" },
  wait: { label: "Wait", tone: "neutral" },
  raise: { label: "Raise 20%", tone: "win" },
  hold: { label: "Hold", tone: "caution" },
  horizontal: { label: "Scale sideways", tone: "accent" },
  at_cap: { label: "At max budget", tone: "caution" },
};

export function ScalingCard({ advice, status, thresholds }: { advice: ScalingAdvice; status: ConnectionStatus; thresholds: Thresholds }) {
  const e = EVENT_LABEL[thresholds.conversionEvent];
  const m = MOVE[advice.move];
  return (
    <Section title="Scaling" hint="Advice for the scaling ad set from the playbook. Budgets are changed by you in Ads Manager; nothing here changes them.">
      <Card className="p-5">
        <div className="flex flex-wrap items-center gap-2">
          <IconTrendUp className="size-4 text-muted" />
          <Badge tone={m.tone}>{m.label}</Badge>
          <span className="text-sm font-medium">{advice.summary}</span>
        </div>
        <p className="mt-1.5 text-sm text-muted">{advice.why}</p>
        {advice.ads > 0 && (
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm @2xl:grid-cols-4">
            <div><dt className="text-xs text-muted">Daily budget</dt><dd className="tabular-nums">{money(advice.dailyBudget, advice.currency)}{advice.move === "raise" && advice.nextBudget != null && <span className="text-win"> → {money(advice.nextBudget, advice.currency)}</span>}</dd></div>
            <div><dt className="text-xs text-muted">Last 3 days</dt><dd className="tabular-nums">{money(advice.recent.spend, advice.currency)} · {advice.recent.conversions} {e.many}</dd></div>
            <div><dt className="text-xs text-muted">Cost per {e.one}, last 3 days</dt><dd className="tabular-nums">{money(advice.recent.cpa, advice.currency)}</dd></div>
            <div><dt className="text-xs text-muted">The 4 days before</dt><dd className="tabular-nums">{money(advice.before.cpa, advice.currency)}</dd></div>
          </dl>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-muted">
          <span className="flex items-center gap-1"><IconClock className="size-3.5" /> About 20% every 48 hours while it holds; judge where the cost settles, not the next morning.</span>
          {status.scaling?.url && <a href={status.scaling.url} target="_blank" rel="noreferrer" className="font-medium text-accent hover:underline">Open the scaling ad set ↗</a>}
        </div>
      </Card>
      <div className="mt-3 grid gap-2 @3xl:grid-cols-2">
        <PlaybookTip id="abo-cbo" />
        <PlaybookTip id="scale-testing-bar" />
      </div>
    </Section>
  );
}

/** Warm-up and attribution side by side, at the top of Launch. */
export function PlaybookSetup({ productId, overview, onSaved }: { productId: string; overview: LaunchOverview; onSaved: () => Promise<unknown> }) {
  return (
    <Section title="Playbook" hint="Suggestions from the Meta ads playbook. Optional: skip or mark anything done.">
      <div className="grid grid-cols-1 gap-3 @4xl:grid-cols-2">
        <WarmupCard productId={productId} overview={overview} onSaved={onSaved} />
        <AttributionCard productId={productId} overview={overview} thresholds={overview.thresholds} onSaved={onSaved} />
      </div>
    </Section>
  );
}
