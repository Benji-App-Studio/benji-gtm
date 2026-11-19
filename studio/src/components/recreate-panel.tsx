"use client";
// "Recreate for my app": a format card turned into ready-to-run Higgsfield inputs for one of our
// apps (model, prompt, beats, on-screen text, caption, CLI). Used by the format library's card
// detail and by the report's post drawer. Nothing here generates or spends credits: the prompt and
// command are copied, or handed to the creative studio's queue.
import { useMemo, useState } from "react";
import { useCached } from "@/lib/client-cache";
import { estimateCreativeJob, queueCreativeJob } from "@/lib/creative-queue";
import { anglesFor } from "@/lib/formats/angles";
import { cardFromPost } from "@/lib/formats/cards";
import { recreate } from "@/lib/formats/recreate";
import { POLICY_NOTE, type AppContext, type FormatCard } from "@/lib/formats/types";
import type { Post, Report } from "@/lib/types";
import { ask, notice } from "./dialog";
import { Badge, Button, cx, segmentClass, Spinner } from "./ui";
import { PANEL, PANEL_OVERLAY, PanelPortal } from "./panel-portal";

/** A script line's job, as a colour from the tokens (so both themes hold). */
export const ROLE_COLOR: Record<string, string> = {
  hook: "bg-accent", setup: "bg-faint", product: "bg-caution", method: "bg-win",
  benefit: "bg-accent-muted", proof: "bg-label", cta: "bg-warn", other: "bg-line",
};
export const ROLE_NAME: Record<string, string> = {
  hook: "Hook", setup: "Setup", product: "Product", method: "Method", benefit: "Benefit", proof: "Proof", cta: "CTA", other: "Other",
};

export function CopyButton({ text, label = "Copy", className }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1200); }}
      className={cx("inline-flex h-6 shrink-0 items-center rounded-control border border-current/25 px-2 text-xs font-medium opacity-80 transition-opacity hover:opacity-100", className)}>{done ? "Copied" : label}</button>
  );
}

/** The policy, visible wherever a recreate prompt is. */
export function PolicyNote({ compact = false }: { compact?: boolean }) {
  return compact
    ? <p className="text-xs leading-snug text-muted">Format only: never reuse their footage, lines or likeness.</p>
    : <p className="rounded-small bg-warn-soft px-3 py-2 text-xs leading-relaxed text-ink">{POLICY_NOTE}</p>;
}

/** The recipe for one card. `formatCardId` is null for cards that aren't stored (Send to Studio needs an id). */
export function RecreatePanel({ card, app, formatCardId }: { card: FormatCard; app: AppContext; formatCardId: string | null }) {
  const angles = useMemo(() => anglesFor(app), [app]);
  const [angleId, setAngleId] = useState<string | undefined>(undefined);
  const recipe = useMemo(() => recreate(card, app, { angleId }), [card, app, angleId]);
  const [sending, setSending] = useState(false);

  async function send() {
    if (!formatCardId) return;
    const job = { productId: app.productId, formatCardId, model: recipe.model, prompt: recipe.prompt, params: recipe.params };
    const plan = estimateCreativeJob(job, app.brandKit.appName || app.name);
    if (plan.errors.length) return notice(plan.errors.join(" "), "Not sent");
    if (!(await ask({ title: "Send to Studio?", body: `This queues ${plan.jobs.length} creative${plan.jobs.length === 1 ? "" : "s"} for about ${plan.credits} Higgsfield credits. Generation starts when the runner on the Mac picks it up.`, confirm: "Queue it" }))) return;
    setSending(true);
    try {
      const result = await queueCreativeJob({ ...job, confirmedCredits: plan.credits });
      notice(`Queued ${result.jobIds.length} job${result.jobIds.length === 1 ? "" : "s"} for about ${result.credits} credits.${result.warnings.length ? ` ${result.warnings.join(" ")}` : ""}`, "Sent to Studio");
    } catch (error) {
      notice(error instanceof Error ? error.message : "Couldn't queue it.", "Not sent");
    } finally {
      setSending(false);
    }
  }

  const span = (from: number | null, to: number | null) => (from != null && to != null ? `${from}–${to}s` : "");

  return (
    <section className="overflow-hidden rounded-card border border-line bg-card">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-sm font-medium">Recreate for {app.brandKit.appName || app.name}</p>
          <p className="text-xs text-muted">{recipe.modelLabel}{recipe.mode ? ` · ${recipe.mode}` : ""} · {recipe.aspectRatio}{recipe.duration ? ` · ${recipe.duration}s` : ""}{recipe.estCredits != null ? ` · ≈${recipe.estCredits} credits` : ""}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <CopyButton text={recipe.prompt} label="Copy prompt" />
          <CopyButton text={recipe.cli} label="Copy CLI command" />
        </div>
      </div>

      <div className="grid gap-4 p-3">
        {angles.length > 1 && (
          <div>
            <p className="eyebrow">Angle</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {angles.map((a) => (
                <button key={a.id} type="button" onClick={() => setAngleId(a.id)}
                  className={segmentClass(recipe.angle.id === a.id)}>{a.label}</button>
              ))}
            </div>
          </div>
        )}

        <p className="text-sm text-muted"><span className="font-medium text-ink">Why this model: </span>{recipe.why}</p>

        <div>
          <p className="eyebrow">Beats, rewritten for {app.brandKit.appName || app.name}</p>
          {recipe.duration != null && (
            <div className="mt-2 flex h-1.5 gap-0.5 overflow-hidden rounded-full">
              {recipe.beats.map((b, i) => <span key={i} className={ROLE_COLOR[b.role] ?? ROLE_COLOR.other} style={{ flex: Math.max(0.5, (b.to ?? 1) - (b.from ?? 0)) }} title={ROLE_NAME[b.role]} />)}
            </div>
          )}
          <ol className="mt-3 grid gap-3">
            {recipe.beats.map((b, i) => (
              <li key={i} className="grid grid-cols-[8px_1fr] gap-3 text-sm">
                <span className={cx("mt-1.5 size-2 rounded-full", ROLE_COLOR[b.role] ?? ROLE_COLOR.other)} />
                <div className="min-w-0">
                  <p className="font-mono text-xs uppercase text-muted">{ROLE_NAME[b.role] ?? b.role}{span(b.from, b.to) && ` · ${span(b.from, b.to)}`}</p>
                  <p className="mt-0.5">“{b.line}”</p>
                  <p className="mt-1 text-xs text-muted">Shot: {b.shot}{b.onScreen && <> · Text: <span className="text-ink">{b.onScreen}</span></>}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className="rounded-small border border-line bg-canvas p-3">
          <div className="flex items-start justify-between gap-3"><p className="eyebrow">Prompt</p><CopyButton text={recipe.prompt} /></div>
          <p className="mt-2 text-sm leading-relaxed [overflow-wrap:anywhere]">{recipe.prompt}</p>
        </div>

        <div className="rounded-small bg-console p-3 text-white/85">
          <div className="flex items-start justify-between gap-3"><p className="text-xs font-medium opacity-60">CLI</p><CopyButton text={recipe.cli} /></div>
          <pre className="mt-2 max-h-40 overflow-auto font-mono text-xs leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">{recipe.cli}</pre>
          <p className="mt-2 font-mono text-xs opacity-60 [overflow-wrap:anywhere]">Check the cost first (free): {recipe.costCli}</p>
          {recipe.setup.length > 0 && <pre className="mt-2 font-mono text-xs whitespace-pre-wrap opacity-80 [overflow-wrap:anywhere]">{`# One-time setup: attach the App Store page\n${recipe.setup.join("\n")}`}</pre>}
        </div>

        {recipe.postCopy && (
          <div>
            <div className="flex items-start justify-between gap-3"><p className="eyebrow">Post copy</p><CopyButton text={recipe.postCopy} /></div>
            <p className="mt-2 text-sm whitespace-pre-line">{recipe.postCopy}</p>
          </div>
        )}

        <div>
          <div className="flex items-start justify-between gap-3"><p className="eyebrow">Caption</p><CopyButton text={recipe.caption} /></div>
          <p className="mt-2 text-sm whitespace-pre-line text-muted">{recipe.caption}</p>
        </div>

        {recipe.notes.length > 0 && <ul className="grid gap-1.5 text-xs text-muted">{recipe.notes.map((n) => <li key={n} className="flex gap-2"><span className="mt-1.5 size-1 shrink-0 rounded-full bg-muted" />{n}</li>)}</ul>}

        {recipe.checks.ok
          ? <p className="flex flex-wrap items-center gap-2 text-xs text-win"><Badge tone="win">Policy check passed</Badge>No competitor names, none of their lines, no ruled-out claims.</p>
          : <div className="grid justify-items-start gap-1 text-xs text-warn"><Badge tone="warn">Fix before running</Badge>{recipe.checks.issues.map((i) => <p key={i}>{i}</p>)}</div>}
        {recipe.needsHuman.length > 0 && (
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted"><Badge tone="warn">Needs a person</Badge>Confirm {recipe.needsHuman.join(", ")} in docs/POLICY.md before this runs.</p>
        )}
        <PolicyNote />

        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <Button size="sm" onClick={send} disabled={sending || !formatCardId || !recipe.checks.ok} title={formatCardId ? undefined : "Save the format library first: cards need an id to send"}>{sending && <Spinner />}Send to Studio</Button>
          <span className="text-xs text-muted">Hands the prompt and settings to the Studio. Nothing is generated here.</span>
        </div>
      </div>
    </section>
  );
}

/** The report's "Recreate for my app": one post as a single-example card, for the project's product. */
export function RecreatePostDialog({ post, formats, productId, onClose }: { post: Post; formats: Report["formats"]; productId: string | null; onClose: () => void }) {
  const [data] = useCached<{ app?: AppContext; error?: string }>(`/api/w/${productId ?? "primary"}/app`);
  const card = useMemo(() => cardFromPost(post, { formats }), [post, formats]);
  return (
    <PanelPortal onClose={onClose}>
    <div className={`${PANEL_OVERLAY} z-[48]`} onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <aside role="dialog" aria-modal="true" aria-label="Recreate for my app" className={`${PANEL} max-w-xl`} onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex min-h-11 items-center justify-between gap-2 border-b border-line bg-card px-4 py-2">
          <p className="min-w-0 truncate text-sm font-medium">Recreate this format · <span className="text-muted">{card.formatName}</span></p>
          <button onClick={onClose} className="grid size-7 shrink-0 place-items-center rounded-control text-muted transition-colors hover:bg-hover hover:text-ink" aria-label="Close">✕</button>
        </div>
        <div className="grid gap-4 p-4">
          {data?.app ? <RecreatePanel card={card} app={data.app} formatCardId={null} />
            : data?.error ? <p className="text-sm text-warn">{data.error}</p>
              : <div className="grid gap-3"><span className="skeleton h-5 w-1/2" /><span className="skeleton h-24 w-full" /><span className="skeleton h-40 w-full" /></div>}
          {data?.app && <a href={`/app/w/${data.app.productId}/studio?start=format`} className="text-sm text-accent hover:underline">Open the format library for {data.app.name} →</a>}
        </div>
      </aside>
    </div>
    </PanelPortal>
  );
}
