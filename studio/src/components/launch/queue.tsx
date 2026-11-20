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
import { useT } from "@/lib/i18n/client";

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
  const { t, tn } = useT();

  const toggle = (c: ApprovedCreative) => setPicked((p) => {
    if (p[c.id]) { const rest = { ...p }; delete rest[c.id]; return rest; }
    return { ...p, [c.id]: { primaryText: c.primaryText ?? "", headline: c.headline ?? "", description: c.description ?? "", cta: ctaFor(c.cta ?? settings.default_cta, objective), aiDisclosure: c.aiGenerated ? "OPT_IN" : "OPT_OUT" } };
  });
  const edit = (id: string, patch: Partial<Copy>) => setPicked((p) => ({ ...p, [id]: { ...p[id], ...patch } }));

  async function create() {
    const items = ids.map((id) => ({ creativeId: id, ...picked[id] }));
    const empty = items.find((i) => !i.primaryText.trim() || !i.headline.trim());
    if (empty) return notice(t("Every ad needs primary text and a headline."), t("Missing copy"));
    setWorking(true);
    try {
      const preview = await send<{ drafts: { creativeId: string; name: string }[] }>(`/api/launch/${productId}/drafts`, { items, preview: true });
      const ok = await ask({
        title: tn(items.length, "Create {n} paused draft on Meta?", "Create {n} paused drafts on Meta?"),
        body: (
          <div className="space-y-3">
            <Facts rows={[
              [t("Ad account"), status.account ? `${status.account.name} (${status.account.currency})` : settings.meta.adAccountId ?? "–"],
              [t("Ad set"), status.testing?.name ?? settings.testing_adset_id ?? "–"],
              [t("Objective"), objective === "app_promotion" ? t("App promotion (iOS)") : t("Website traffic")],
              [t("Status"), t("Paused — nothing spends")],
            ]} />
            <ul className="max-h-40 space-y-1 overflow-auto font-mono text-[11px] text-ink">{preview.drafts.map((d) => <li key={d.creativeId} className="break-all">{d.name}</li>)}</ul>
            <p className="text-xs">{t("Launch uploads the media, builds each ad creative and creates the ads paused. Publish them yourself in Ads Manager.")}</p>
          </div>
        ),
        confirm: t("Create paused drafts"),
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
      title={t("Approved creatives")}
      hint={t("{waiting} waiting · {launched} already launched", { waiting: creatives.filter((c) => !launched.has(c.id)).length, launched: launched.size })}
      action={creatives.some((c) => launched.has(c.id)) && (
        <label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={showLaunched} onChange={(e) => setShowLaunched(e.target.checked)} className="accent-[var(--color-accent)]" /> {t("Show launched")}</label>
      )}
    >
      {visible.length === 0 ? (
        creatives.length
          ? <EmptyState className="py-8" title={t("Every approved creative is launched")} body={t("Approve more in the Studio and they show here.")}
              action={<ButtonLink href={workspaceHref(productId, "studio")} variant="secondary" size="sm">{t("Open the Studio")}</ButtonLink>} />
          : <EmptyState className="py-8" title={t("No approved creatives yet")} body={t("Only approved creatives can launch. Review and approve them in the Studio and they show here.")}
              action={<ButtonLink href={workspaceHref(productId, "studio")} variant="secondary" size="sm">{t("Approve creatives in the Studio")}</ButtonLink>} />
      ) : (
        <div className="grid grid-cols-2 gap-2 @lg:grid-cols-3 @2xl:grid-cols-5 @4xl:grid-cols-6">
          {visible.map((c, i) => {
            const on = Boolean(picked[c.id]);
            return (
              <button key={c.id} type="button" onClick={() => toggle(c)} aria-pressed={on} style={{ "--i": i } as React.CSSProperties}
                className={cx("rise group relative flex min-w-0 flex-col overflow-hidden rounded-small border bg-card text-left transition-colors", on ? "border-accent ring-1 ring-accent/50" : "border-line hover:border-hairline hover:bg-hover")}>
                <Media creative={c} className="aspect-[4/5] w-full" />
                <span className="flex min-w-0 flex-col gap-1 p-2">
                  <span className="truncate text-xs font-medium">{c.title ?? c.headline ?? c.id}</span>
                  <span className="flex flex-wrap gap-1">
                    <Badge>{c.kind === "video" ? (c.durationSec ? t("Video · {seconds}s", { seconds: Math.round(c.durationSec) }) : t("Video")) : t("Image")}</Badge>
                    <Badge>{c.aspect}</Badge>
                    {launched.has(c.id) && <Badge tone="win">{t("launched")}</Badge>}
                  </span>
                  {(c.formatCardId || c.hookType) && <span className="truncate font-mono text-[10px] text-muted">{[c.formatSlug ?? c.formatCardId, c.hookType].filter(Boolean).join(" · ")}</span>}
                </span>
                <span aria-hidden className={cx("absolute top-2 left-2 grid size-5 place-items-center rounded-full border text-[11px]", on ? "border-transparent bg-accent-fill text-on-accent" : "border-hairline bg-card/90 text-transparent")}>✓</span>
              </button>
            );
          })}
        </div>
      )}

      {ids.length > 0 && (
        <div className="mt-4 grid gap-3">
          {ids.map((id) => {
            const c = creatives.find((x) => x.id === id)!;
            const copy = picked[id];
            return (
              <Card key={id} className="grid min-w-0 gap-4 p-4 @3xl:grid-cols-[minmax(0,1fr)_320px]">
                <div className="grid min-w-0 content-start gap-3">
                  <p className="text-xs font-medium text-muted">{c.title ?? c.id}</p>
                  <label className="grid gap-1.5">
                    <span className="text-xs font-medium text-label">{t("Primary text")} <span className="font-book text-muted">{t("({n}/125 shown before “more”)", { n: copy.primaryText.length })}</span></span>
                    <textarea rows={4} value={copy.primaryText} onChange={(e) => edit(id, { primaryText: e.target.value })} className={inputClass} maxLength={2000} />
                  </label>
                  <div className="grid gap-3 @lg:grid-cols-[minmax(0,1fr)_200px]">
                    <label className="grid gap-1.5">
                      <span className="text-xs font-medium text-label">{t("Headline")} <span className="font-book text-muted">({copy.headline.length}/40)</span></span>
                      <input value={copy.headline} onChange={(e) => edit(id, { headline: e.target.value })} className={inputClass} maxLength={255} />
                    </label>
                    <label className="grid gap-1.5">
                      <span className="text-xs font-medium text-label">{t("Call to action")}</span>
                      <select value={copy.cta} onChange={(e) => edit(id, { cta: e.target.value })} className={inputClass}>
                        {CTA_OPTIONS[objective].map((o) => <option key={o.value} value={o.value}>{t(o.label)}</option>)}
                      </select>
                    </label>
                  </div>
                  <label className="grid gap-1.5">
                    <span className="text-xs font-medium text-label">{t("Description")} <span className="font-book text-muted">{t("(disclaimers; not shown on Instagram)")}</span></span>
                    <input value={copy.description} onChange={(e) => edit(id, { description: e.target.value })} className={inputClass} maxLength={255} />
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={copy.aiDisclosure === "OPT_IN"} onChange={(e) => edit(id, { aiDisclosure: e.target.checked ? "OPT_IN" : "OPT_OUT" })} className="accent-[var(--color-accent)]" />
                    {t("Made or edited with AI")} <span className="text-xs text-muted">{c.aiGenerated ? t("(Meta may show an “AI info” label; on because a model made it)") : t("(Meta may show an “AI info” label)")}</span>
                  </label>
                  <button type="button" onClick={() => toggle(c)} className="justify-self-start text-xs text-muted hover:text-warn">{t("Remove from this batch")}</button>
                </div>
                <AdPreview creative={c} copy={copy} pageName={settings.meta.appName ?? t("Your Page")} ctaText={t(ctaLabel(copy.cta, objective))} link={objective === "app_promotion" ? settings.meta.appStoreUrl : settings.meta.websiteUrl} />
              </Card>
            );
          })}
          <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-card border border-hairline bg-raised/95 px-3 py-2 shadow-pop backdrop-blur">
            <span className="text-sm">{ready ? tn(ids.length, "{n} selected · goes to the testing ad set, paused", "{n} selected · go to the testing ad set, paused") : t("{n} selected · finish the setup in Settings first", { n: ids.length })}</span>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setPicked({})}>{t("Clear")}</Button>
              {onSendToMeta && <Button variant="secondary" size="sm" onClick={() => onSendToMeta(ids)} title={t("Pick the campaign and ad set, the format and every setting")}>{t("Send to Meta…")}</Button>}
              <Button size="sm" disabled={!ready || working} onClick={create}>{working && <Spinner />}{tn(ids.length, "Create {n} paused draft", "Create {n} paused drafts")}</Button>
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
  const { t } = useT();
  let host = "";
  try { host = link ? new URL(link).host.replace(/^www\./, "") : ""; } catch { /* no link yet */ }
  return (
    <div className="min-w-0 overflow-hidden rounded-small border border-line bg-canvas">
      <div className="flex items-center gap-2 p-3">
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-control text-xs font-medium text-label">{pageName.slice(0, 1)}</span>
        <span className="min-w-0"><span className="block truncate text-sm font-medium">{pageName}</span><span className="block text-xs text-muted">{t("Sponsored")}</span></span>
      </div>
      <p className="line-clamp-3 px-3 pb-3 text-sm whitespace-pre-line">{copy.primaryText || <span className="text-faint">{t("Primary text")}</span>}</p>
      <Media creative={creative} className={cx("w-full", creative.aspect === "9:16" ? "aspect-[4/5]" : creative.aspect === "1:1" ? "aspect-square" : "aspect-[4/5]")} />
      <div className="flex items-center justify-between gap-3 border-t border-line bg-card p-3">
        <span className="min-w-0">
          {host && <span className="block truncate text-[10px] uppercase text-muted">{host}</span>}
          <span className="block truncate text-sm font-medium">{copy.headline || <span className="text-faint">{t("Headline")}</span>}</span>
        </span>
        <span className="shrink-0 rounded-control bg-control px-3 py-1.5 text-xs font-medium">{ctaText}</span>
      </div>
    </div>
  );
}
