"use client";
// The live queue: each batch and its jobs as they're claimed, generated and checked (Realtime keeps
// it current). Queued jobs can be cancelled; failed or cancelled ones retried, and a failed GPT Image 2.5
// image can be tried on the other provider (Higgsfield ⇄ OpenAI) after confirming its price; nothing
// ever switches provider on its own. A failed job shows the provider's status and reason (its error),
// and "not charged" only when Higgsfield confirmed it (it ended the job and the charge was set to 0);
// a job already submitted to Higgsfield says so while it waits to be collected.
import { useState } from "react";
import { batchTitle, KIND_LABEL } from "@/lib/creative-plan";
import type { BatchRow, CreativeJobRow, JobStatus } from "@/lib/creative-types";
import { fmtUsd, otherProvider, providerOfJob, PROVIDER_NAME } from "@/lib/image-provider";
import { isSafetyBlock } from "@/lib/playground-video";
import { ask, Facts, notice } from "../dialog";
import { Badge, Button, Card, cx, EmptyState, Gear, Locked } from "../ui";
import { KEYS_HREF, RunnerLock, type Features } from "./features";
import { useT } from "@/lib/i18n/client";
import { m, type Translator } from "@/lib/i18n/translate";
import { confirmRetry } from "./retry-confirm";

const STATUS: Record<JobStatus, { label: string; tone: "neutral" | "accent" | "win" | "warn" }> = {
  queued: { label: m("queued"), tone: "neutral" }, running: { label: m("making"), tone: "accent" }, finalizing: { label: m("saving"), tone: "accent" }, done: { label: m("done"), tone: "win" },
  failed: { label: m("failed"), tone: "warn" }, cancelled: { label: m("cancelled"), tone: "neutral" },
};

const BACKEND: Record<CreativeJobRow["backend"], string> = { auto: "Higgsfield", local: m("desktop runner"), api: "Higgsfield API", template: m("template") };

/**
 * A queued job that nothing in this install can pick up yet: one only the desktop runner makes, where it
 * isn't set up, or a Higgsfield job with neither a Higgsfield key nor the runner. Says what to connect
 * and, when there is one, the other way to make it.
 */
function WaitingFor({ job, features }: { job: CreativeJobRow; features?: Features }) {
  const { t } = useT();
  if (!features?.install || job.status !== "queued" || job.backend === "template" || providerOfJob(job.params) === "openai") return null;
  if (job.backend === "local") return features.runner ? <span className="text-xs text-muted">{t("waiting for the desktop runner to pick it up")}</span> : <RunnerLock>{t("Waiting for the desktop runner")}</RunnerLock>;
  if (features.state("studio.video").ok || (job.backend === "auto" && features.runner)) return null;
  const openai = job.model === "gpt_image_2_5" && features.imageProviders?.openai;
  return <Locked href={KEYS_HREF} action={t("Add the key")}>{openai ? t("Waiting for a Higgsfield key. Or cancel it and make it via OpenAI") : t("Waiting for a Higgsfield key")}</Locked>;
}
/** How long ago `iso` was, in words. */
const ago = (iso: string, { t, intl }: Pick<Translator, "t" | "intl">) => {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  return s < 90 ? t("just now") : s < 3600 ? t("{n} min ago", { n: Math.round(s / 60) }) : s < 86400 ? t("{n} h ago", { n: Math.round(s / 3600) }) : new Date(iso).toLocaleDateString(intl);
};
/** How long until `iso`, in words (a retry's wait). */
const until = (iso: string, { t, intl }: Pick<Translator, "t" | "intl">) => {
  const s = Math.max(0, (Date.parse(iso) - Date.now()) / 1000);
  return s < 90 ? t("retrying shortly") : s < 3600 ? t("retrying in {n} min", { n: Math.round(s / 60) }) : s < 86400 ? t("retrying in {n} h", { n: Math.round(s / 3600) }) : t("retrying {date}", { date: new Date(iso).toLocaleDateString(intl) });
};

export function JobList({ batches, jobs, onChanged, launchableByBatch, onSendToMeta, features }: {
  batches: BatchRow[]; jobs: CreativeJobRow[]; onChanged: () => void;
  /** What this install can make, so a job nothing can pick up says what it waits for. */
  features?: Features;
  /** Each batch's approved, QA-passed creatives, for "Send to Meta". */
  launchableByBatch?: Map<string, string[]>;
  onSendToMeta?: (ids: string[]) => void;
}) {
  const tr = useT();
  const { t, tn } = tr;
  const [open, setOpen] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const byBatch = new Map<string, CreativeJobRow[]>();
  for (const job of jobs) byBatch.set(job.batch_id ?? "none", [...(byBatch.get(job.batch_id ?? "none") ?? []), job]);
  const shown = batches.filter((b) => byBatch.has(b.id)).slice(0, 8);

  /** "Try with OpenAI/Higgsfield instead": the price for the other provider, the person's confirmation, then a new job on it. */
  async function tryOther(job: CreativeJobRow) {
    const to = otherProvider(providerOfJob(job.params));
    const post = (body: Record<string, unknown>) => fetch(`/api/studio/jobs/${job.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(async (r) => ({ ok: r.ok, data: await r.json().catch(() => ({ error: t("The server didn't answer. Try again.") })) }));
    setActing(job.id);
    const planned = await post({ action: "plan-switch", provider: to });
    setActing(null);
    if (!planned.ok) return notice(planned.data.error ?? t("Couldn't check the price. Try again."));
    const { credits, usd } = planned.data as { credits: number; usd: number };
    const ok = await ask({
      title: t("Make it with {provider}?", { provider: PROVIDER_NAME[to] }),
      body: <Facts rows={[
        [t("Model"), t("GPT Image 2.5 · via {provider}", { provider: PROVIDER_NAME[to] })],
        [t("Image"), `${t(KIND_LABEL[job.kind])} · ${job.aspect} · v${job.variant}`],
        to === "openai" ? [t("Estimated OpenAI cost"), `≈ ${fmtUsd(usd)}`] : [t("Estimated Higgsfield cost"), tn(credits, "{n} credit", "{n} credits")],
      ]} note={t("The same prompt and images, the same model, on the other provider. It joins this batch as a new job; the failed one stays as it is.")} />,
      confirm: to === "openai" ? t("Spend ≈{usd} at OpenAI", { usd: fmtUsd(usd) }) : tn(credits, "Spend ~{n} credit", "Spend ~{n} credits"),
    });
    if (!ok) return;
    setActing(job.id);
    const made = await post({ action: "switch", provider: to, confirmedCredits: credits, confirmedUsd: usd });
    setActing(null);
    if (!made.ok) return notice(made.data.error ?? t("Couldn't queue it. Try again."));
    onChanged();
  }

  async function act(job: CreativeJobRow, action: "cancel" | "retry") {
    // A retry spends again: its price first.
    if (action === "retry") {
      const provider = providerOfJob(job.params);
      const ok = await confirmRetry({ provider, credits: Number(job.cost_estimate) || 0, usd: Number(job.params.est_usd) || 0, what: `${t(KIND_LABEL[job.kind])} · ${job.aspect} · v${job.variant}`, free: job.backend === "template" }, t);
      if (!ok) return;
    }
    setActing(job.id);
    const response = await fetch(`/api/studio/jobs/${job.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
    setActing(null);
    if (!response.ok) return notice((await response.json().catch(() => ({}))).error ?? t("Couldn't do that. Try again."));
    onChanged();
  }

  if (!shown.length) return <EmptyState className="py-8" title={t("No batches yet")} body={t("Start one in New batch above. Its jobs show here as they run.")} />;

  return (
    <Card className="divide-y divide-line overflow-hidden">
      {shown.map((batch, i) => {
        const list = byBatch.get(batch.id) ?? [];
        const count = (s: JobStatus) => list.filter((j) => j.status === s).length;
        const done = count("done"), failed = count("failed"), active = count("running") + count("finalizing") + count("queued");
        const expanded = open === batch.id || (open === null && i === 0);
        const spent = list.reduce((n, j) => n + Number(j.cost_credits ?? 0), 0);
        const launchable = launchableByBatch?.get(batch.id) ?? [];
        return (
          <div key={batch.id}>
            <button type="button" onClick={() => setOpen(expanded ? "" : batch.id)} aria-expanded={expanded} className="flex min-h-12 w-full flex-wrap items-center gap-x-4 gap-y-1.5 px-3 py-1.5 text-left transition-colors hover:bg-hover">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium" title={batch.brief || undefined}>{batch.brief ? batchTitle(batch.brief) : batch.format_card_id ? t("Format {id}", { id: batch.format_card_id }) : t("Posts")}</span>
                <span className="block text-xs text-muted">{ago(batch.created_at, tr)} · {tn(Number(batch.cost_estimate), "est. {n} credit", "est. {n} credits")}{Number(batch.settings?.usdEstimate) ? ` ${t("+ ≈{usd} at OpenAI", { usd: fmtUsd(Number(batch.settings.usdEstimate)) })}` : ""}{spent ? ` · ${t("spent {n}", { n: spent })}` : ""}</span>
              </span>
              <span className="flex flex-wrap items-center gap-1.5">
                {active > 0 && <Badge tone="accent"><Gear className="size-3" />{t("{n} to go", { n: active })}</Badge>}
                <Badge tone="win">{t("{n} done", { n: done })}</Badge>
                {failed > 0 && <Badge tone="warn">{t("{n} failed", { n: failed })}</Badge>}
              </span>
            </button>
            {launchable.length > 0 && onSendToMeta && (
              <div className="flex items-center justify-between gap-3 border-t border-line px-3 py-1.5 text-xs text-muted">
                <span>{tn(launchable.length, "{n} approved creative from this batch", "{n} approved creatives from this batch")}</span>
                <Button size="sm" variant="secondary" onClick={() => onSendToMeta(launchable)}>{t("Send to Meta")}</Button>
              </div>
            )}
            {expanded && (
              <ol className="grid border-t border-line bg-canvas/40 py-1">
                {list.map((job) => {
                  const higgsfield = providerOfJob(job.params) !== "openai";
                  // Only Higgsfield's own word sets a failed job's charge to 0 (core/jobs.ts afterRequestEnded / afterRunnerFailure).
                  const notCharged = higgsfield && job.status === "failed" && job.backend !== "template" && job.cost_credits != null && Number(job.cost_credits) === 0;
                  return (
                  <li key={job.id} className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1 text-sm">
                    <span className="w-32 shrink-0 truncate">{t(KIND_LABEL[job.kind])}</span>
                    <span className="w-16 shrink-0 tabular-nums text-muted">{job.aspect} · v{job.variant}</span>
                    <Badge tone={STATUS[job.status].tone}>{job.status === "running" && <Gear className="size-3" />}{t(STATUS[job.status].label)}</Badge>
                    <span className="text-xs text-muted">{providerOfJob(job.params) === "openai" ? "OpenAI" : t(BACKEND[job.backend])}</span>
                    {job.status === "failed" && isSafetyBlock(job.error) && <Badge tone="caution">{t("Blocked by the safety filter")}</Badge>}
                    {job.status === "queued" && job.external_id && higgsfield && <span className="text-xs text-muted" title={t("Higgsfield job {id}", { id: job.external_id })}>{t("submitted · collecting the result, never submitted again")}</span>}
                    {job.status === "queued" && job.not_before && Date.parse(job.not_before) > Date.now() && <span className="text-xs text-muted">{until(job.not_before, tr)}</span>}
                    <WaitingFor job={job} features={features} />
                    <span className="ml-auto text-xs tabular-nums text-muted" title={notCharged ? t("Higgsfield ended this job without charging for it.") : undefined}>{!higgsfield
                      ? (Number.isFinite(Number(job.params.cost_usd)) && job.params.cost_usd != null ? fmtUsd(Number(job.params.cost_usd)) : `≈${fmtUsd(Number(job.params.est_usd) || 0)}`)
                      : notCharged ? t("not charged") : job.cost_credits != null ? t("{n} cr", { n: Number(job.cost_credits) }) : Number(job.cost_estimate) ? t("~{n} cr", { n: Number(job.cost_estimate) }) : t("free")}</span>
                    {job.status === "queued" && <Button size="sm" variant="ghost" disabled={acting === job.id} onClick={() => act(job, "cancel")}>{t("Cancel")}</Button>}
                    {(job.status === "failed" || job.status === "cancelled") && job.backend !== "template" && <Button size="sm" variant="ghost" disabled={acting === job.id} onClick={() => act(job, "retry")}>{t("Retry")}</Button>}
                    {job.status === "failed" && job.model === "gpt_image_2_5" && (features?.imageProviders?.[otherProvider(providerOfJob(job.params))] ?? true) && <Button size="sm" variant="ghost" disabled={acting === job.id} onClick={() => tryOther(job)}>{t("Try with {provider} instead", { provider: PROVIDER_NAME[otherProvider(providerOfJob(job.params))] })}</Button>}
                    {job.error && <p className={cx("basis-full text-xs", job.status === "failed" ? "text-warn" : "text-muted")}>{job.error}</p>}
                    {Array.isArray(job.params.result_urls) && job.params.result_urls.length > 0 && (
                      <p className="basis-full text-xs text-muted">{t("The finished file is still at the provider (links may expire):")} {(job.params.result_urls as string[]).filter((u) => /^https:\/\//.test(u)).map((u, n) => (
                        <a key={u} href={u} target="_blank" rel="noopener noreferrer" className="font-medium text-accent hover:underline">{n ? ` ${t("file {n}", { n: n + 1 })}` : t("download it")}</a>
                      ))}</p>
                    )}
                  </li>
                  );
                })}
              </ol>
            )}
          </div>
        );
      })}
    </Card>
  );
}
