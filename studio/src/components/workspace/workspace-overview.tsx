"use client";
// An app's Home: the three things to set up (profile, brand basics, competitors), the one next step
// (the first gap, else the next move in the loop), what more can be unlocked with a key or a
// connection, and its latest batches and creatives. The rules are in lib/workspace-setup.ts.
import Link from "next/link";
import { featureState, UNLOCKABLE } from "@/lib/capabilities";
import { useCached } from "@/lib/client-cache";
import { batchTitle } from "@/lib/creative-plan";
import type { StudioOverview } from "@/lib/creative-types";
import type { ProductRow } from "@/lib/db";
import type { InstallState } from "@/lib/install/types";
import { useInstall } from "@/lib/install/use-install";
import { workspaceHref, type WorkspaceCounts, type WorkspaceView } from "@/lib/workspace-schema";
import { nextStep, setupSteps, type NextMove, type SetupStep } from "@/lib/workspace-setup";
import { IconAlert, IconArrowRight, IconCheckCircle, IconLock, IconSparkles } from "../icons";
import { WorkspaceOverviewSkeleton } from "../page-skeletons";
import { Badge, ButtonLink, Card, CardHeader, cx, EmptyState, ErrorNote, Page, SectionHeader, Spinner, Thumb } from "../ui";
import { isWorkspace, useWorkspace, WorkspaceIcon } from "./parts";
import { ProductPageHeader } from "./product-header";
import { UI_LOCALE } from "@/lib/ui-locale";

type Step = SetupStep;
type Next = NextMove;
type App = { id: string; connections: WorkspaceView["connections"] };

export function WorkspaceOverview({ id }: { id: string }) {
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
  // undefined while the counts load; null when they couldn't be counted (then the loop starts at Research).
  const counts = counted === undefined ? undefined : counted?.counts ?? null;
  const steps = setupSteps(id, kit, product, counts === undefined ? undefined : counts?.watchlist ?? 0);
  // The next step waits for the install too, so it never names a page that then turns out to be locked.
  const next = installLoading ? null : nextStep(id, steps, counts, install, app);
  const done = steps.filter((s) => s.done).length;
  const allSet = done === steps.length;

  return (
    <Page>
      <ProductPageHeader productId={id} page="Home" name={workspace.name}
        title={<span className="flex min-w-0 items-center gap-3"><WorkspaceIcon name={kit.appName || workspace.name} url={kit.iconUrl} className="size-8 text-sm" /><span className="min-w-0">{kit.appName || workspace.name}</span></span>}
        badge={workspace.isPrimary && Array.isArray(products) && products.length > 1 ? <Badge>main</Badge> : undefined}
        subtitle={kit.tagline || product?.description || undefined}
        actions={<ButtonLink href={`/app/w/${id}/brand?tab=product`} variant="secondary" size="sm">Profile</ButtonLink>} />

      <div className="grid items-start gap-x-10 gap-y-8 @4xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid min-w-0 gap-8">
          {next ? <NextStep next={next} /> : <Card className="flex items-center gap-2 px-3 py-2.5 text-sm text-muted"><Spinner className="size-3.5" />Working out the next step…</Card>}
          <section>
            <SectionHeader title="Setup" subtitle={allSet ? "All set. Change any of it whenever you like." : `${done} of ${steps.length} done`}
              action={allSet ? <Badge tone="win">All set</Badge> : undefined} />
            <ol>
              {steps.map((step) => <StepRow key={step.key} step={step} />)}
            </ol>
          </section>
          <UnlockMore install={install} loading={installLoading} app={app} />
        </div>
        <Recent id={id} studio={studio} />
      </div>
    </Page>
  );
}

function NextStep({ next }: { next: Next }) {
  return (
    <Card className="flex flex-wrap items-center gap-3 px-3 py-3">
      <span className="grid size-6 shrink-0 place-items-center rounded-md bg-accent-soft text-accent"><IconSparkles className="size-3.5" /></span>
      <div className="min-w-0 flex-1 basis-[220px]">
        <p className="text-xs text-muted">Next step</p>
        <p className="text-sm font-medium">{next.title}</p>
        {next.body && <p className="mt-0.5 text-xs text-muted">{next.body}</p>}
      </div>
      <ButtonLink href={next.href} className="rounded-full">{next.action}<IconArrowRight /></ButtonLink>
    </Card>
  );
}

function StepRow({ step }: { step: Step }) {
  return (
    <li className="-mx-2 flex min-h-12 items-center gap-3 rounded-control px-2 py-1.5 transition-colors hover:bg-hover">
      {step.done === null ? <Spinner className="size-3.5" /> : step.done
        ? <IconCheckCircle className="size-3.5 shrink-0 text-win" />
        : <IconAlert className="size-3.5 shrink-0 text-caution" />}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <Link href={step.href} className="rounded-xs text-sm font-medium hover:underline">{step.label}</Link>
          {step.progress && <Badge>{step.progress}</Badge>}
        </div>
        <p className="text-xs text-muted">{step.detail}</p>
      </div>
      {step.done === false && <Link href={step.href} className="shrink-0 rounded-xs text-xs font-medium text-accent hover:underline">{step.action}</Link>}
    </li>
  );
}

// MARK: Unlock more

/**
 * The optional things: each needs a key (Settings > API keys) or a connection on this app. A row says
 * whether it's ready and, when it isn't, what to add and where. None of it is needed to be "all set".
 */
/** "A", "A and B", "A, B and C". */
const listed = (items: string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

function UnlockMore({ install, loading, app }: { install: InstallState | null; loading: boolean; app: App }) {
  // The AI's key comes first: reading ads, writing analyses and checking creatives all wait for it.
  const rows = [{ feature: "ai" as const, label: "Read ads, write analyses and check creatives with AI" }, ...UNLOCKABLE].map((item) => ({ ...item, state: featureState(item.feature, install, app) }));
  const ready = rows.filter((r) => !r.state.unknown && r.state.ok).length;
  return (
    <section>
      <SectionHeader title="Unlock more" subtitle={loading ? "Optional. Checking what's connected…" : install ? `Optional. ${ready} of ${rows.length} ready.` : "Optional. Each needs a key or a connection."} />
      <ul>
        {rows.map(({ feature, label, state }) => {
          const missing = [...state.missingKeys, ...state.missingConnections];
          return (
            <li key={feature} className="-mx-2 flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 rounded-control px-2 py-1.5 transition-colors hover:bg-hover">
              {loading ? <Spinner className="size-3.5" /> : state.unknown ? <IconLock className="size-3.5 shrink-0 text-faint" /> : state.ok
                ? <IconCheckCircle className="size-3.5 shrink-0 text-win" />
                : <IconLock className="size-3.5 shrink-0 text-faint" />}
              <span className="min-w-0 flex-[1_1_220px] text-sm text-ink">{label}</span>
              {!loading && (state.unknown
                ? <Link href="/app/settings/keys" className="shrink-0 rounded-xs text-xs font-medium text-accent hover:underline">Open API keys</Link>
                : state.ok ? <Badge tone="win">Ready</Badge>
                : <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1"><span className="text-xs text-muted">Needs {listed(missing)}</span><Link href={state.href} className="shrink-0 rounded-xs text-xs font-medium text-accent hover:underline">{state.action}</Link></span>)}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// MARK: Recent batches and creatives

const day = (iso: string) => new Date(iso).toLocaleDateString(UI_LOCALE, { day: "numeric", month: "short" });

function Recent({ id, studio }: { id: string; studio: StudioOverview | undefined }) {
  const studioHref = workspaceHref(id, "studio");
  if (!studio) return <Card className="flex h-32 items-center justify-center"><Spinner className="size-3.5" /></Card>;
  const creatives = (studio.creatives ?? []).slice(0, 6);
  const batches = (studio.batches ?? []).slice(0, 4);
  if (!creatives.length && !batches.length) {
    return <EmptyState className="rounded-card border border-line py-10" title="No creatives yet" body="Batches and creatives from the Studio and the Playground show here as they're made."
      action={<ButtonLink href={studioHref} variant="secondary" size="sm">Open Studio</ButtonLink>} />;
  }
  return (
    <Card className="min-w-0 p-3">
      <CardHeader title="Recent" action={<Link href={studioHref} className="rounded-xs text-xs font-medium text-accent hover:underline">Open Studio</Link>} />
      {creatives.length > 0 && (
        <div className="mt-3 grid grid-cols-3 gap-1.5">
          {creatives.map((c) => (
            <Link key={c.id} href={`${studioHref}?review=${c.id}`} title={c.prompt ?? undefined} className="group relative block overflow-hidden rounded-small border border-line">
              <Thumb src={c.thumbnail_url ?? (c.kind === "image" ? c.url : null)} alt={c.prompt ?? "Creative"} size={240} className="aspect-square w-full transition group-hover:opacity-90" />
              <span className={cx("absolute bottom-1 left-1 rounded-full px-1.5 py-px text-[11px] font-medium",
                c.approval === "approved" ? "bg-win text-on-ink" : c.approval === "rejected" ? "bg-warn text-on-ink" : "bg-canvas/90 text-ink")}>
                {c.approval === "approved" ? "Approved" : c.approval === "rejected" ? "Rejected" : "To review"}
              </span>
            </Link>
          ))}
        </div>
      )}
      {batches.length > 0 && (
        <ul className="mt-3 flex min-w-0 flex-col">
          <li className="pb-1 text-xs text-muted">Batches</li>
          {batches.map((b) => (
            <li key={b.id} className="flex min-h-8 min-w-0 items-center justify-between gap-3 text-sm">
              <span className="min-w-0 truncate" title={b.brief?.trim() || undefined}>{batchTitle(b.brief)}</span>
              <span className="shrink-0 text-xs text-muted">{day(b.created_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
