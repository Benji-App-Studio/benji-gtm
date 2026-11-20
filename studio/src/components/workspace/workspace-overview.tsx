"use client";
// An app's Home: the getting-started guide (four steps to a first result, components/getting-started.tsx),
// the business at a glance (business-summary.tsx), the profile, brand and competitors (worth filling in,
// never blocking), what more can be unlocked with a key or a connection, and its latest batches and
// creatives. The rules are in lib/workspace-setup.ts.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { featureState, UNLOCKABLE } from "@/lib/capabilities";
import { useCached } from "@/lib/client-cache";
import { batchTitle } from "@/lib/creative-plan";
import type { StudioOverview } from "@/lib/creative-types";
import type { ProductRow } from "@/lib/db";
import { useT } from "@/lib/i18n/client";
import { m } from "@/lib/i18n/translate";
import type { InstallState } from "@/lib/install/types";
import { useInstall } from "@/lib/install/use-install";
import { workspaceHref, type WorkspaceCounts, type WorkspaceView } from "@/lib/workspace-schema";
import { profileItems, type ProfileItem } from "@/lib/workspace-setup";
import { GettingStarted } from "../getting-started";
import { IconCheckCircle, IconChevronRight, IconLock } from "../icons";
import { WorkspaceOverviewSkeleton } from "../page-skeletons";
import { Badge, ButtonLink, Card, CardHeader, cx, EmptyState, ErrorNote, Page, SectionHeader, Spinner, Thumb } from "../ui";
import { BusinessCard } from "./business-summary";
import { isWorkspace, useWorkspace, WorkspaceIcon } from "./parts";
import { ProductPageHeader } from "./product-header";
import { appSettingsHref } from "@/lib/nav-model";

type App = { id: string; connections: WorkspaceView["connections"] };

export function WorkspaceOverview({ id }: { id: string }) {
  const { t } = useT();
  const [workspace] = useWorkspace(id);
  const [products] = useCached<ProductRow[]>("/api/products");
  const [counted] = useCached<{ counts: WorkspaceCounts }>(`/api/workspaces/${id}/counts`);
  const [studio] = useCached<StudioOverview>(`/api/studio/${id}`);
  const { install, loading: installLoading } = useInstall();

  if (!isWorkspace(workspace)) {
    if (!workspace || !("error" in workspace)) return <WorkspaceOverviewSkeleton />;
    return <Page><ProductPageHeader productId={id} page="Home" /><ErrorNote>{workspace.error}</ErrorNote></Page>;
  }

  const kit = workspace.brandKit;
  const product = Array.isArray(products) ? products.find((p) => p.id === id) : undefined;
  const app: App = { id, connections: workspace.connections };
  // undefined while the counts load; null when they couldn't be counted.
  const counts = counted === undefined ? undefined : counted?.counts ?? null;
  const items = profileItems(id, kit, product, counts === undefined ? undefined : counts?.watchlist ?? 0);

  return (
    <Page>
      <ProductPageHeader productId={id} page="Home" name={workspace.name}
        title={<span className="flex min-w-0 items-center gap-3"><WorkspaceIcon name={kit.appName || workspace.name} url={kit.iconUrl} className="size-8 text-sm" /><span className="min-w-0">{kit.appName || workspace.name}</span></span>}
        badge={workspace.isPrimary && Array.isArray(products) && products.length > 1 ? <Badge>{t("main")}</Badge> : undefined}
        subtitle={(kit.tagline || product?.description) ? <ClampedText text={(kit.tagline || product?.description || "").trim()} /> : undefined}
        actions={<ButtonLink href={appSettingsHref(id)} variant="secondary" size="sm">{t("App settings")}</ButtonLink>} />

      <div className="grid items-start gap-x-10 gap-y-8 @4xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid min-w-0 gap-8">
          {/* The guide first while it has steps left; then the operating overview. */}
          <GettingStarted id={id} />
          <BusinessCard id={id} />
          <section>
            <SectionHeader title={t("Make it yours")} subtitle={t("Optional. Every creative follows your profile and brand, and you can fill them in any time.")} />
            <ol>
              {items.map((item) => <ProfileRow key={item.key} item={item} />)}
            </ol>
          </section>
          <UnlockMore install={install} loading={installLoading} app={app} />
        </div>
        <Recent id={id} studio={studio} />
      </div>
    </Page>
  );
}

/**
 * A long description (an App Store text can run to 20 lines) shown as two lines with "Show more", so the
 * guide stays above the fold. The button only appears when the text is actually cut.
 */
function ClampedText({ text }: { text: string }) {
  const { t } = useT();
  const ref = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [cut, setCut] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || open) return;
    const measure = () => setCut(el.scrollHeight > el.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text, open]);
  return (
    <>
      <span ref={ref} className={cx("whitespace-pre-line", open ? "block" : "line-clamp-2")}>{text}</span>
      {(cut || open) && (
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="mt-0.5 rounded-xs text-xs font-medium text-accent hover:underline">
          {open ? t("Show less") : t("Show more")}
        </button>
      )}
    </>
  );
}

function ProfileRow({ item }: { item: ProfileItem }) {
  const { t, tn } = useT();
  const words = {
    profile: { label: t("Profile"), detail: t("What it is, who it's for and its links. The AI fills it in from your link when your key is connected.") },
    brand: { label: t("Brand"), detail: item.done ? t("Logo, colours and voice are set.") : t("Logo, colours and voice: {n} of 3 set.", { n: item.count ?? 0 }) },
    competitors: { label: t("Competitors"), detail: item.count ? tn(item.count, "{n} on the list. Research follows their ads.", "{n} on the list. Research follows their ads.") : t("Add the competitors whose ads you want to follow.") },
  }[item.key];
  return (
    <li>
      <Link href={item.href} className="-mx-2 flex min-h-12 items-center gap-3 rounded-control px-2 py-1.5 transition-colors hover:bg-hover">
        {item.done === null ? <Spinner className="size-3.5" /> : item.done
          ? <IconCheckCircle className="size-3.5 shrink-0 text-win" />
          : <span aria-hidden className="size-3.5 shrink-0 rounded-full border border-hairline" />}
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{words.label}</span>
          <span className="block text-xs text-muted">{words.detail}</span>
        </span>
        <IconChevronRight className="size-3.5 shrink-0 text-faint" />
      </Link>
    </li>
  );
}

// MARK: Unlock more

/**
 * The optional things: each needs a key (Settings > API keys) or a connection on this app. A row says
 * whether it's ready and, when it isn't, what to add and where. None of it is needed to be "all set".
 */
function UnlockMore({ install, loading, app }: { install: InstallState | null; loading: boolean; app: App }) {
  const { t, intl } = useT();
  const listed = (items: string[]) => new Intl.ListFormat(intl, { type: "conjunction" }).format(items);
  // The AI's key comes first: reading ads, writing analyses and checking creatives all wait for it.
  const rows = [{ feature: "ai" as const, label: m("Read ads, write analyses and check creatives with AI") }, ...UNLOCKABLE].map((item) => ({ ...item, state: featureState(item.feature, install, app, { t, intl }) }));
  const ready = rows.filter((r) => !r.state.unknown && r.state.ok).length;
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xs">
        <span>
          <span className="block text-sm font-medium">{t("Unlock more")}</span>
          <span className="block text-xs text-muted">{loading ? t("Optional. Checking what's connected…") : install ? t("Optional. {ready} of {total} ready.", { ready, total: rows.length }) : t("Optional. Each needs a key or a connection.")}</span>
        </span>
        <IconChevronRight className="size-3.5 shrink-0 text-faint transition-transform group-open:rotate-90" />
      </summary>
      <ul className="mt-3">
        {rows.map(({ feature, label, state }) => {
          const missing = [...state.missingKeys, ...state.missingConnections];
          return (
            <li key={feature} className="-mx-2 flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 rounded-control px-2 py-1.5 transition-colors hover:bg-hover">
              {loading ? <Spinner className="size-3.5" /> : state.unknown ? <IconLock className="size-3.5 shrink-0 text-faint" /> : state.ok
                ? <IconCheckCircle className="size-3.5 shrink-0 text-win" />
                : <IconLock className="size-3.5 shrink-0 text-faint" />}
              <span className="min-w-0 flex-[1_1_220px] text-sm text-ink">{t(label)}</span>
              {!loading && (state.unknown
                ? <Link href="/app/settings/keys" className="shrink-0 rounded-xs text-xs font-medium text-accent hover:underline">{t("Open your keys")}</Link>
                : state.ok ? <Badge tone="win">{t("Ready")}</Badge>
                : <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1"><span className="text-xs text-muted">{t("Needs {items}", { items: listed(missing) })}</span><Link href={state.href} className="shrink-0 rounded-xs text-xs font-medium text-accent hover:underline">{state.action}</Link></span>)}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

// MARK: Recent batches and creatives

const day = (iso: string, intl: string) => new Date(iso).toLocaleDateString(intl, { day: "numeric", month: "short" });

function Recent({ id, studio }: { id: string; studio: StudioOverview | undefined }) {
  const { t, intl } = useT();
  const studioHref = workspaceHref(id, "studio");
  if (!studio) return <Card className="flex h-32 items-center justify-center"><Spinner className="size-3.5" /></Card>;
  const creatives = (studio.creatives ?? []).slice(0, 6);
  const batches = (studio.batches ?? []).slice(0, 4);
  if (!creatives.length && !batches.length) {
    return <EmptyState className="rounded-card border border-line py-10" title={t("No creatives yet")} body={t("Batches and creatives from the Studio show here as they're made.")}
      action={<ButtonLink href={studioHref} variant="secondary" size="sm">{t("Open Studio")}</ButtonLink>} />;
  }
  return (
    <Card className="min-w-0 p-3">
      <CardHeader title={t("Recent")} action={<Link href={studioHref} className="rounded-xs text-xs font-medium text-accent hover:underline">{t("Open Studio")}</Link>} />
      {creatives.length > 0 && (
        <div className="mt-3 grid grid-cols-3 gap-1.5">
          {creatives.map((c) => (
            <Link key={c.id} href={`${studioHref}?review=${c.id}`} title={c.prompt ?? undefined} className="group relative block overflow-hidden rounded-small border border-line">
              <Thumb src={c.thumbnail_url ?? (c.kind === "image" ? c.url : null)} alt={c.prompt ?? t("Creative")} size={240} className="aspect-square w-full transition group-hover:opacity-90" />
              <span className={cx("absolute bottom-1 left-1 rounded-full px-1.5 py-px text-[11px] font-medium",
                c.approval === "approved" ? "bg-win text-on-ink" : c.approval === "rejected" ? "bg-warn text-on-ink" : "bg-canvas/90 text-ink")}>
                {c.approval === "approved" ? t("Approved") : c.approval === "rejected" ? t("Rejected") : t("To review")}
              </span>
            </Link>
          ))}
        </div>
      )}
      {batches.length > 0 && (
        <ul className="mt-3 flex min-w-0 flex-col">
          <li className="pb-1 text-xs text-muted">{t("Batches")}</li>
          {batches.map((b) => (
            <li key={b.id} className="flex min-h-8 min-w-0 items-center justify-between gap-3 text-sm">
              <span className="min-w-0 truncate" title={b.brief?.trim() || undefined}>{batchTitle(b.brief)}</span>
              <span className="shrink-0 text-xs text-muted">{day(b.created_at, intl)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
