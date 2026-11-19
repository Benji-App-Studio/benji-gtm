"use client";
// Approved creatives waiting to launch: pick some, edit each one's copy next to a feed-style
// preview, then create them as paused drafts in the testing ad set. The description (disclaimers) comes
// from the creative's copy, and "Made with AI" starts on for a model-made creative (either can change).
import { useState } from "react";
import type { ApprovedCreative } from "@/lib/creatives";
import { CTA_OPTIONS, ctaFor, ctaLabel, type ConnectionStatus, type LaunchSettings } from "@/lib/launch/types";
import { ask, Facts, notice } from "../dialog";
import { Badge, Button, ButtonLink, Card, cx, EmptyState, inputClass, Spinner } from "../ui";
import { workspaceHref } from "@/lib/workspace-schema";
import { Section, send } from "./parts";

interface Copy { primaryText: string; headline: string; description: string; cta: string; aiDisclosure: "OPT_IN" | "OPT_OUT" }

export function Queue({ productId, creatives, launched, settings, status, onQueued, onSendToMeta }: {
  productId: string;
  creatives: ApprovedCreative[];
  launched: Set<string>;
  settings: LaunchSettings;
  status: ConnectionStatus;
  onQueued: () => Promise<unknown>;
  /** Opens "Send to Meta" with these creatives: any campaign and ad set, any format. */
  onSendToMeta?: (ids: string[]) => void;
}) {
  const [picked, setPicked] = useState<Record<string, Copy>>({});
  const [showLaunched, setShowLaunched] = useState(false);
  const [working, setWorking] = useState(false);
  const objective = settings.objective;
  const visible = creatives.filter((c) => showLaunched || !launched.has(c.id));
  const ids = Object.keys(picked);
  const ready = status.connected && !(status.missing?.length);

  const toggle = (c: ApprovedCreative) => setPicked((p) => {
    if (p[c.id]) { const rest = { ...p }; delete rest[c.id]; return rest; }
    return { ...p, [c.id]: { primaryText: c.primaryText ?? "", headline: c.headline ?? "", description: c.description ?? "", cta: ctaFor(c.cta ?? settings.default_cta, objective), aiDisclosure: c.aiGenerated ? "OPT_IN" : "OPT_OUT" } };
  });
  const edit = (id: string, patch: Partial<Copy>) => setPicked((p) => ({ ...p, [id]: { ...p[id], ...patch } }));

  async function create() {
    const items = ids.map((id) => ({ creativeId: id, ...picked[id] }));
    const empty = items.find((i) => !i.primaryText.trim() || !i.headline.trim());
    if (empty) return notice("Every ad needs primary text and a headline.", "Missing copy");
    setWorking(true);
    try {
      const preview = await send<{ drafts: { creativeId: string; name: string }[] }>(`/api/launch/${productId}/drafts`, { items, preview: true });
      const ok = await ask({
        title: `Create ${items.length} paused draft${items.length === 1 ? "" : "s"} on Meta?`,
        body: (
          <div className="space-y-3">
            <Facts rows={[
              ["Ad account", status.account ? `${status.account.name} (${status.account.currency})` : settings.meta.adAccountId ?? "–"],
              ["Ad set", status.testing?.name ?? settings.testing_adset_id ?? "–"],
              ["Objective", objective === "app_promotion" ? "App promotion (iOS)" : "Website traffic"],
              ["Status", "Paused — nothing spends"],
            ]} />
            <ul className="max-h-40 space-y-1 overflow-auto font-mono text-[11px] text-ink">{preview.drafts.map((d) => <li key={d.creativeId} className="break-all">{d.name}</li>)}</ul>
            <p className="text-xs">Launch uploads the media, builds each ad creative and creates the ads paused. Publish them yourself in Ads Manager.</p>
          </div>
        ),
        confirm: "Create paused drafts",
      });
      if (!ok) return;
      await send(`/api/launch/${productId}/drafts`, { items });
      setPicked({});
      await onQueued();
    } catch (error) {
      notice(error instanceof Error ? error.message : String(error));
    } finally {
      setWorking(false);
    }
  }

  return (
    <Section
      id="queue"
      title="Approved creatives"
      hint={`${creatives.filter((c) => !launched.has(c.id)).length} waiting · ${launched.size} already launched`}
      action={creatives.some((c) => launched.has(c.id)) && (
        <label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={showLaunched} onChange={(e) => setShowLaunched(e.target.checked)} className="accent-[var(--color-accent)]" /> Show launched</label>
      )}
    >
      {visible.length === 0 ? (
        creatives.length
          ? <EmptyState className="py-8" title="Every approved creative is launched" body="Approve more in the Studio and they show here."
              action={<ButtonLink href={workspaceHref(productId, "studio")} variant="secondary" size="sm">Open the Studio</ButtonLink>} />
          : <EmptyState className="py-8" title="No approved creatives yet" body="Only approved creatives can launch. Review and approve them in the Studio and they show here."
              action={<ButtonLink href={workspaceHref(productId, "studio")} variant="secondary" size="sm">Approve creatives in the Studio</ButtonLink>} />
      ) : (
        <div className="grid grid-cols-2 gap-3 @2xl:grid-cols-4 @4xl:grid-cols-5">
          {visible.map((c, i) => {
            const on = Boolean(picked[c.id]);
            return (
              <button key={c.id} type="button" onClick={() => toggle(c)} aria-pressed={on} style={{ "--i": i } as React.CSSProperties}
                className={cx("rise group relative flex min-w-0 flex-col overflow-hidden rounded-card border bg-card text-left shadow-card transition", on ? "border-accent ring-2 ring-accent/40" : "border-line hover:border-ink/40")}>
                <Media creative={c} className="aspect-[4/5] w-full" />
                <span className="flex min-w-0 flex-col gap-1 p-2.5">
                  <span className="truncate text-sm font-medium">{c.title ?? c.headline ?? c.id}</span>
                  <span className="flex flex-wrap gap-1">
                    <Badge>{c.kind === "video" ? `Video${c.durationSec ? ` · ${Math.round(c.durationSec)}s` : ""}` : "Image"}</Badge>
                    <Badge>{c.aspect}</Badge>
                    {launched.has(c.id) && <Badge tone="win">launched</Badge>}
                  </span>
                  {(c.formatCardId || c.hookType) && <span className="truncate font-mono text-[10px] text-muted">{[c.formatSlug ?? c.formatCardId, c.hookType].filter(Boolean).join(" · ")}</span>}
                </span>
                <span aria-hidden className={cx("absolute top-2 left-2 grid size-5 place-items-center rounded-full border text-[11px]", on ? "border-transparent bg-accent text-on-ink" : "border-hairline bg-card/90 text-transparent")}>✓</span>
              </button>
            );
          })}
        </div>
      )}

      {ids.length > 0 && (
        <div className="mt-6 grid gap-4">
          {ids.map((id) => {
            const c = creatives.find((x) => x.id === id)!;
            const copy = picked[id];
            return (
              <Card key={id} className="grid min-w-0 gap-4 p-4 @3xl:grid-cols-[minmax(0,1fr)_320px]">
                <div className="grid min-w-0 content-start gap-3">
                  <p className="text-xs font-medium text-faint">{c.title ?? c.id}</p>
                  <label className="grid gap-1.5">
                    <span className="text-sm font-medium">Primary text <span className="font-normal text-muted">({copy.primaryText.length}/125 shown before “more”)</span></span>
                    <textarea rows={4} value={copy.primaryText} onChange={(e) => edit(id, { primaryText: e.target.value })} className={inputClass} maxLength={2000} />
                  </label>
                  <div className="grid gap-3 @lg:grid-cols-[minmax(0,1fr)_200px]">
                    <label className="grid gap-1.5">
                      <span className="text-sm font-medium">Headline <span className="font-normal text-muted">({copy.headline.length}/40)</span></span>
                      <input value={copy.headline} onChange={(e) => edit(id, { headline: e.target.value })} className={inputClass} maxLength={255} />
                    </label>
                    <label className="grid gap-1.5">
                      <span className="text-sm font-medium">Call to action</span>
                      <select value={copy.cta} onChange={(e) => edit(id, { cta: e.target.value })} className={inputClass}>
                        {CTA_OPTIONS[objective].map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </label>
                  </div>
                  <label className="grid gap-1.5">
                    <span className="text-sm font-medium">Description <span className="font-normal text-muted">(disclaimers; not shown on Instagram)</span></span>
                    <input value={copy.description} onChange={(e) => edit(id, { description: e.target.value })} className={inputClass} maxLength={255} />
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={copy.aiDisclosure === "OPT_IN"} onChange={(e) => edit(id, { aiDisclosure: e.target.checked ? "OPT_IN" : "OPT_OUT" })} className="accent-[var(--color-accent)]" />
                    Made or edited with AI <span className="text-xs text-muted">(Meta may show an “AI info” label{c.aiGenerated ? "; on because a model made it" : ""})</span>
                  </label>
                  <button type="button" onClick={() => toggle(c)} className="justify-self-start text-xs text-muted hover:text-warn">Remove from this batch</button>
                </div>
                <AdPreview creative={c} copy={copy} pageName={settings.meta.appName ?? "Your Page"} ctaText={ctaLabel(copy.cta, objective)} link={objective === "app_promotion" ? settings.meta.appStoreUrl : settings.meta.websiteUrl} />
              </Card>
            );
          })}
          <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-card/95 p-3 shadow-pop backdrop-blur">
            <span className="text-sm">{ids.length} selected · {ready ? "goes to the testing ad set, paused" : "finish the setup in Settings first"}</span>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setPicked({})}>Clear</Button>
              {onSendToMeta && <Button variant="secondary" size="sm" onClick={() => onSendToMeta(ids)} title="Pick the campaign and ad set, the format and every setting">Send to Meta…</Button>}
              <Button size="sm" disabled={!ready || working} onClick={create}>{working && <Spinner />}Create {ids.length} paused draft{ids.length === 1 ? "" : "s"}</Button>
            </div>
          </div>
        </div>
      )}
    </Section>
  );
}

function Media({ creative, className }: { creative: ApprovedCreative; className?: string }) {
  return creative.kind === "video"
    ? <video src={creative.url} poster={creative.thumbnailUrl} muted loop playsInline preload="metadata" className={cx("bg-control object-cover", className)} onMouseEnter={(e) => e.currentTarget.play().catch(() => {})} onMouseLeave={(e) => e.currentTarget.pause()} />
    // eslint-disable-next-line @next/next/no-img-element
    : <img src={creative.url} alt="" loading="lazy" className={cx("bg-control object-cover", className)} />;
}

/** Roughly how the ad reads in the Facebook / Instagram feed. */
function AdPreview({ creative, copy, pageName, ctaText, link }: { creative: ApprovedCreative; copy: Copy; pageName: string; ctaText: string; link?: string }) {
  let host = "";
  try { host = link ? new URL(link).host.replace(/^www\./, "") : ""; } catch { /* no link yet */ }
  return (
    <div className="min-w-0 overflow-hidden rounded-card border border-line bg-canvas">
      <div className="flex items-center gap-2 p-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-xs font-medium text-on-ink">{pageName.slice(0, 1)}</span>
        <span className="min-w-0"><span className="block truncate text-sm font-medium">{pageName}</span><span className="block text-xs text-muted">Sponsored</span></span>
      </div>
      <p className="line-clamp-3 px-3 pb-3 text-sm whitespace-pre-line">{copy.primaryText || <span className="text-faint">Primary text</span>}</p>
      <Media creative={creative} className={cx("w-full", creative.aspect === "9:16" ? "aspect-[4/5]" : creative.aspect === "1:1" ? "aspect-square" : "aspect-[4/5]")} />
      <div className="flex items-center justify-between gap-3 border-t border-line bg-card p-3">
        <span className="min-w-0">
          {host && <span className="block truncate text-[10px] uppercase text-muted">{host}</span>}
          <span className="block truncate text-sm font-medium">{copy.headline || <span className="text-faint">Headline</span>}</span>
        </span>
        <span className="shrink-0 rounded-control bg-control px-3 py-1.5 text-xs font-medium">{ctaText}</span>
      </div>
    </div>
  );
}
