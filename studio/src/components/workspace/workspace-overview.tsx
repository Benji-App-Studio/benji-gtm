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
import { Badge, ButtonLink, Card, CardHeader, cx, EmptyState, ErrorNote, Page, Spinner, Thumb } from "../ui";
import { isWorkspace, useWorkspace, WorkspaceIcon } from "./parts";
import { ProductPageHeader } from "./product-header";

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
        title={<span className="flex min-w-0 items-center gap-2.5"><WorkspaceIcon name={kit.appName || workspace.name} url={kit.iconUrl} className="size-7 text-sm" /><span className="min-w-0">{kit.appName || workspace.name}</span></span>}
        badge={workspace.isPrimary && Array.isArray(products) && products.length > 1 ? <Badge>main</Badge> : undefined}
        subtitle={kit.tagline || product?.description || undefined}
        actions={<ButtonLink href={`/app/w/${id}/brand?tab=product`} variant="secondary" size="sm">Profile</ButtonLink>} />

      <div className="grid items-start gap-3 @4xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="grid min-w-0 gap-3">
          {next ? <NextStep next={next} /> : <Card className="flex items-center gap-2 p-4 text-sm text-muted"><Spinner />Working out the next step…</Card>}
          <Card className="p-0">
            <CardHeader className="px-4 pt-4" title="Setup" subtitle={allSet ? "All set. Change any of it whenever you like." : `${done} of ${steps.length} done`}
              action={allSet ? <Badge tone="win">All set</Badge> : undefined} />
            <ol className="mt-3">
              {steps.map((step) => <StepRow key={step.key} step={step} />)}
            </ol>
          </Card>
          <UnlockMore install={install} loading={installLoading} app={app} />
        </div>
        <Recent id={id} studio={studio} />
      </div>
    </Page>
  );
}

function NextStep({ next }: { next: Next }) {
  return (
    <Card className="flex flex-wrap items-center gap-3 border-accent/30 p-4">
      <span className="grid size-8 shrink-0 place-items-center rounded-md bg-accent-soft text-accent"><IconSparkles className="size-4" /></span>
      <div className="min-w-0 flex-1 basis-[240px]">
        <p className="text-caption text-muted">Next step</p>
        <p className="text-title font-medium">{next.title}</p>
        {next.body && <p className="mt-0.5 text-sm text-muted">{next.body}</p>}
      </div>
      <ButtonLink href={next.href}>{next.action}<IconArrowRight className="size-4" /></ButtonLink>
    </Card>
  );
}

function StepRow({ step }: { step: Step }) {
  return (
    <li className="flex gap-3 border-t border-line px-4 py-3">
      {step.done === null ? <Spinner className="mt-0.5 size-4" /> : step.done
        ? <IconCheckCircle className="mt-0.5 size-4 shrink-0 text-win" />
        : <IconAlert className="mt-0.5 size-4 shrink-0 text-caution" />}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link href={step.href} className="rounded-xs text-sm font-medium hover:underline">{step.label}</Link>
          {step.progress && <Badge>{step.progress}</Badge>}
        </div>
        <p className="mt-0.5 text-sm text-muted">{step.detail}</p>
      </div>
      {step.done === false && <Link href={step.href} className="shrink-0 self-center rounded-xs text-sm font-medium text-accent hover:underline">{step.action}</Link>}
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
    <Card className="p-0">
      <CardHeader className="px-4 pt-4" title="Unlock more" subtitle={loading ? "Optional. Checking what's connected…" : install ? `Optional. ${ready} of ${rows.length} ready.` : "Optional. Each needs a key or a connection."} />
      <ul className="mt-3">
        {rows.map(({ feature, label, state }) => {
          const missing = [...state.missingKeys, ...state.missingConnections];
          return (
            <li key={feature} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-4 py-2.5">
              {loading ? <Spinner className="size-4" /> : state.unknown ? <IconLock className="size-4 shrink-0 text-faint" /> : state.ok
                ? <IconCheckCircle className="size-4 shrink-0 text-win" />
                : <IconLock className="size-4 shrink-0 text-faint" />}
              <span className="min-w-0 flex-[1_1_220px] text-sm text-ink">{label}</span>
              {!loading && (state.unknown
                ? <Link href="/app/settings/keys" className="shrink-0 rounded-xs text-sm font-medium text-accent hover:underline">Open API keys</Link>
                : state.ok ? <Badge tone="win">Ready</Badge>
                : <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1"><span className="text-xs text-muted">Needs {listed(missing)}</span><Link href={state.href} className="shrink-0 rounded-xs text-sm font-medium text-accent hover:underline">{state.action}</Link></span>)}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// MARK: Recent batches and creatives

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });

function Recent({ id, studio }: { id: string; studio: StudioOverview | undefined }) {
  const studioHref = workspaceHref(id, "studio");
  if (!studio) return <Card className="flex h-40 items-center justify-center"><Spinner /></Card>;
  const creatives = (studio.creatives ?? []).slice(0, 6);
  const batches = (studio.batches ?? []).slice(0, 4);
  if (!creatives.length && !batches.length) {
    return <EmptyState title="No creatives yet" body="Batches and creatives from the Studio and the Playground show here as they're made."
      action={<ButtonLink href={studioHref} variant="secondary" size="sm">Open Studio</ButtonLink>} />;
  }
  return (
    <Card className="min-w-0 p-4">
      <CardHeader title="Recent" action={<Link href={studioHref} className="rounded-xs text-sm font-medium text-accent hover:underline">Open Studio</Link>} />
      {creatives.length > 0 && (
        <div className="mt-3 grid grid-cols-3 gap-2">
          {creatives.map((c) => (
            <Link key={c.id} href={`${studioHref}?review=${c.id}`} title={c.prompt ?? undefined} className="group relative block overflow-hidden rounded-inner border border-line">
              <Thumb src={c.thumbnail_url ?? (c.kind === "image" ? c.url : null)} alt={c.prompt ?? "Creative"} size={240} className="aspect-square w-full transition group-hover:opacity-90" />
              <span className={cx("absolute bottom-1.5 left-1.5 rounded-full px-1.5 py-px text-xs font-medium",
                c.approval === "approved" ? "bg-win text-on-ink" : c.approval === "rejected" ? "bg-warn text-on-ink" : "bg-canvas/90 text-ink")}>
                {c.approval === "approved" ? "Approved" : c.approval === "rejected" ? "Rejected" : "To review"}
              </span>
            </Link>
          ))}
        </div>
      )}
      {batches.length > 0 && (
        <ul className="mt-3 flex min-w-0 flex-col gap-0.5">
          <li className="pb-1 text-xs font-medium text-label">Batches</li>
          {batches.map((b) => (
            <li key={b.id} className="flex min-w-0 items-baseline justify-between gap-3 border-t border-line py-2 text-sm">
              <span className="min-w-0 truncate" title={b.brief?.trim() || undefined}>{batchTitle(b.brief)}</span>
              <span className="shrink-0 text-xs text-muted">{day(b.created_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
