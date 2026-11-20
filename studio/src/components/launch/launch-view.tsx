"use client";
// The Launch page: approved creatives → preview and edit the copy → paused drafts on Meta, the
// drafts' progress with Ads Manager links, promote/pause suggestions with their reasons, scaling
// advice and the playbook. Settings and the daily-uploads switch sit in a drawer behind the
// Settings button (settings-drawer.tsx). Every Meta write is confirmed with ask() first, and
// nothing it creates runs until it's published by hand in Ads Manager.
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import type { FeatureState } from "@/lib/capabilities";
import { useCached } from "@/lib/client-cache";
import type { LaunchDraft, LaunchOverview } from "@/lib/launch/types";
import { useT } from "@/lib/i18n/client";
import { workspaceHref } from "@/lib/workspace-schema";
import { IconChart, IconCheck, IconRocket, IconSettings } from "../icons";
import { LaunchSkeleton } from "../page-skeletons";
import { useFeatures } from "../studio/features";
import { Badge, Button, ButtonLink, ConnectState, cx, ErrorNote, Page, Term } from "../ui";
import { useTermTips, withParts } from "../nav/nav-labels";
import { ProductPageHeader } from "../workspace/product-header";
import { Drafts } from "./drafts";
import { Queue } from "./queue";
import { IN_PROGRESS } from "./parts";
import { canAddKeys, keysLockWords, launchStatusText } from "./launch-words";
import { PlaybookTips } from "../playbook-tip";
import { PlaybookSetup, ScalingCard } from "./playbook";
import { appSettingsHref } from "@/lib/nav-model";
import { SettingsDrawer, useSettingsDrawer } from "./settings-drawer";
import { SendToMeta } from "./send-sheet";
import { Suggestions } from "./suggestions";

export function LaunchView({ productId }: { productId: string }) {
  const url = `/api/launch/${productId}`;
  const [data, reload] = useCached<LaunchOverview & { error?: string }>(url);
  const [drafts, reloadDrafts] = useCached<LaunchDraft[]>(`${url}/drafts`);
  const list = drafts ?? data?.drafts ?? [];
  const busy = list.some((d) => IN_PROGRESS.has(d.status));
  const drawer = useSettingsDrawer();
  const features = useFeatures(productId);
  /** The "Send to Meta" sheet: null when closed, else the creatives it starts with. */
  const [send, setSend] = useState<string[] | null>(null);
  const tr = useT();
  const { t } = tr;

  // Poll while uploads run (Meta takes a minute or two to process a video).
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => { reloadDrafts().catch(() => {}); }, 4000);
    return () => clearInterval(timer);
  }, [busy, reloadDrafts]);

  // Launch needs the Meta keys and this app's ad account and Page. Until then the page is one "connect"
  // state. A backend answering from its built-in sample account (development) is let through.
  const lock = features.locked("launch");
  if (lock && !data?.status?.mock) return <Page><LaunchHeader productId={productId} name={data?.workspace?.name} /><LaunchLocked lock={lock} productId={productId} connectionsKnown={Boolean(features.app)} canAdd={canAddKeys(features.install)} /></Page>;
  if (!data) return <LaunchSkeleton />;
  if (data.error) return <Page><ProductPageHeader productId={productId} page="Launch" /><ErrorNote>{data.error}</ErrorNote></Page>;

  const refresh = () => Promise.all([reload(), reloadDrafts()]);
  const settings = data.settings ?? data.defaults;
  const status = data.status;
  const launched = new Set(list.filter((d) => d.status !== "error" && d.status !== "cancelled").map((d) => d.creative_ref));

  return (
    <Page>
      <LaunchHeader productId={productId} name={data.workspace.name}
        actions={<>
          <AdsLink productId={productId} />
          <Button size="sm" onClick={() => setSend([])} aria-haspopup="dialog" data-guide="launch">{t("Send to Meta")}</Button>
          <Button variant="secondary" size="sm" onClick={drawer.show} aria-haspopup="dialog">
            <IconSettings />{t("Settings")}
            {data.settings?.automation_enabled && <Badge tone="win" className="max-sm:hidden">{t("daily uploads on")}</Badge>}
          </Button>
        </>} />
      <Connection overview={data} />

      {(status.missing?.length || status.issues?.length || status.error) ? (
        <ErrorNote title={t("Before launching")} className="mb-6">
          <ul className="list-disc space-y-0.5 pl-5">
            {[...(status.missing ?? []), ...(status.issues ?? []), ...(status.error ? [status.error] : [])].map((line) => <li key={line}>{launchStatusText(tr, line)}</li>)}
          </ul>
          <button type="button" onClick={drawer.show} className="mt-2 text-sm font-medium underline underline-offset-2">{t("Open settings")}</button>
        </ErrorNote>
      ) : null}

      <div className="grid gap-10">
        <div className="grid gap-3">
          <Queue productId={productId} creatives={data.creatives} launched={launched} settings={settings} status={status} onQueued={refresh} onSendToMeta={setSend} />
          <PlaybookTips ids={["five-per-adset", "not-every-ad-spends"]} />
        </div>
        <Drafts drafts={list} adAccountId={settings.meta.adAccountId} />
        <div className="grid gap-3">
          <Suggestions productId={productId} suggestions={data.suggestions} thresholds={data.thresholds} range={data.metricsRange} onChanged={refresh} onOpenSettings={drawer.show} />
          <PlaybookTips ids={["judge-by-spend", "kill-dont-wait"]} />
        </div>
        <ScalingCard advice={data.scaling} status={status} thresholds={data.thresholds} />
        <PlaybookSetup productId={productId} overview={data} onSaved={refresh} />
      </div>

      <SendToMeta productId={productId} open={send !== null} initialIds={send ?? []} onClose={() => { setSend(null); refresh().catch(() => {}); }} />
      <SettingsDrawer productId={productId} open={drawer.open} onClose={drawer.hide} saved={data.settings} defaults={data.defaults} onSaved={refresh} />
    </Page>
  );
}

/** To Launch → Ads: every ad sent from here and how each one is doing. */
function AdsLink({ productId }: { productId: string }) {
  const { t } = useT();
  return <ButtonLink href={`${workspaceHref(productId, "launch")}/ads`} variant="secondary" size="sm"><IconChart />{t("Ads and results")}</ButtonLink>;
}

/** The page's header, the same whether Launch is connected or not: what Launch does, in one line. */
function LaunchHeader({ productId, name, actions }: { productId: string; name?: string; actions?: ReactNode }) {
  const { t } = useT();
  const tips = useTermTips();
  return (
    <ProductPageHeader productId={productId} page="Launch" name={name} actions={actions}
      subtitle={withParts(t("Approved creatives arrive in your own Meta ad account as {paused} ads, in a campaign and an {adSet}. Nothing spends until you switch them on in Ads Manager."), {
        paused: <Term tip={tips.paused} className="font-medium text-ink">{t("paused")}</Term>,
        adSet: <Term tip={tips.adSet} className="font-medium text-ink">{t("ad set")}</Term>,
      })} />
  );
}

/** Launch before it is connected: what is missing (the keys first, then this app's ad account and Page) and where to add it. */
function LaunchLocked({ lock, productId, connectionsKnown, canAdd }: { lock: FeatureState; productId: string; connectionsKnown: boolean; canAdd: boolean }) {
  const tr = useT();
  const { t } = tr;
  // The second step is only ticked once this app's connections have loaded: until then nothing is known about it.
  const steps: [boolean, string, string][] = [
    [lock.missingKeys.length === 0, t("A Meta system user token and app secret, in Settings › Your keys"), "/app/settings/keys"],
    [connectionsKnown && lock.missingConnections.length === 0, t("This app's Meta ad account and Facebook Page, in App settings › Connections"), appSettingsHref(productId, "connections")],
  ];
  // Launch needs two keys that only work as a pair; the registry's sentence is written for one.
  const words = keysLockWords(tr, lock, canAdd);
  return (
    <ConnectState icon={<IconRocket />} title={lock.missingKeys.length ? t("Connect Meta to send ads as paused drafts") : lock.title} href={lock.href} action={words.action}
      body={<>
        {/* A member is told to ask the owner (the registry's own line); the owner is told about both keys. */}
        {words.body}
        <span className="mx-auto mt-4 grid max-w-xs gap-1.5 text-left">
          {steps.map(([done, text, href], i) => (
            <span key={text} className="flex items-start gap-2">
              <span aria-hidden className={cx("mt-0.5 grid size-4 shrink-0 place-items-center rounded-full text-[10px] leading-none font-medium tabular-nums", done ? "bg-win-soft text-win [&_svg]:size-3" : "bg-control text-label")}>{done ? <IconCheck /> : i + 1}</span>
              {done
                ? <span className="text-faint line-through">{text}<span className="sr-only"> {t("(done)")}</span></span>
                : <Link href={href} className="rounded-xs text-label underline decoration-hairline underline-offset-2 hover:text-ink hover:decoration-current">{text}<span className="sr-only"> {t("(to do)")}</span></Link>}
            </span>
          ))}
        </span>
      </>} />
  );
}

function Connection({ overview }: { overview: LaunchOverview }) {
  const { t } = useT();
  const s = overview.status;
  const ok = s.connected && s.account && !s.error;
  return (
    <div className="mb-6 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <span className="flex min-w-0 items-center gap-2">
        <span className={cx("size-2 shrink-0 rounded-full", ok ? "bg-win" : "bg-warn")} />
        {ok ? <a href={s.account!.url} target="_blank" rel="noreferrer" className="truncate font-medium hover:underline">{s.account!.name || t("Ad account")} · {s.account!.currency}</a> : <span className="font-medium">{s.connected ? t("Meta connected") : t("Meta not connected")}</span>}
      </span>
      <span className="text-xs text-muted">Marketing API {s.version ?? "v26.0"}{s.account && !s.account.hasPaymentMethod ? ` · ${t("no payment method")}` : ""}</span>
    </div>
  );
}
