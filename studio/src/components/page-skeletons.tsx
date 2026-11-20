// Each page's loading placeholder, laid out like the page itself: same container, widths and padding,
// built from the kit in ./skeleton. A page shows its own while its data loads, and app/app/loading.tsx
// shows the same one while the route loads, so the switch from one to the other is invisible.
import { UNLOCKABLE } from "@/lib/capabilities";
import { m } from "@/lib/i18n/translate";
import { columnClass, pageClass } from "./ui";
import {
  Bone, Skeleton, SkeletonAdGrid, SkeletonBadge, SkeletonButton, SkeletonCard, SkeletonFilterBar, SkeletonForm, SkeletonLine,
  SkeletonList, SkeletonPageHeader, SkeletonProductCard, SkeletonProjectCards, SkeletonStats, SkeletonTable, SkeletonTabs, SkeletonText,
} from "./skeleton";

/** A product page's header: the crumbs line (product › page), the title, a subtitle and actions. */
const productHeader = (props: Parameters<typeof SkeletonPageHeader>[0] = {}) => <SkeletonPageHeader eyebrow="w-32" title="w-40" {...props} />;

// MARK: Research

/** Research → Ads: header with its buttons, the Competitors/Our ads switch, the competitor list, stats, filters, and the ad grid. */
export function ResearchSkeleton() {
  return (
    <Skeleton label={m("Loading ads")} className={pageClass}>
      {productHeader({ title: "w-44", subtitle: 2, actions: ["w-28", "w-44"] })}
      <SkeletonTabs widths={[150, 92]} className="mb-4" />
      <SkeletonCard className="mb-4 overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3"><SkeletonLine size="title" width="w-40" /><SkeletonButton size="sm" width="w-24" /></div>
        <div className="grid gap-3 border-t border-line px-4 py-3">
          <div className="grid gap-2 @xl:grid-cols-2 @4xl:grid-cols-3">{[0, 1, 2].map((i) => <Bone key={i} className="h-[50px] rounded-inner" />)}</div>
          <Bone className="h-12 w-full rounded-inner" />
        </div>
      </SkeletonCard>
      <SkeletonLine size="xs" width="w-56" className="mb-5" />
      <SkeletonStats className="mb-4 grid-cols-2 @3xl:grid-cols-4" />
      <SkeletonFilterBar className="mb-5" />
      <SkeletonLine size="xs" width="w-96" className="mb-3" />
      <SkeletonAdGrid count={8} />
    </Skeleton>
  );
}

// MARK: Product profile

export function ProductsSkeleton() {
  return (
    <Skeleton label={m("Loading your apps")} className={`${pageClass} ${columnClass}`}>
      <SkeletonPageHeader eyebrow="w-28" title="w-44" subtitleWidth="w-80" actions={["w-28"]} actionSize="sm" />
      <div className="grid gap-3"><SkeletonProductCard /></div>
    </Skeleton>
  );
}

// MARK: Formats

/** The format library below its header: the filter card and format tiles. */
export function FormatsBodySkeleton() {
  return (
    <Skeleton label={m("Loading formats")}>
      <SkeletonCard className="mt-4 grid grid-cols-2 gap-3 p-4 @2xl:flex @2xl:flex-wrap @2xl:items-end">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex min-w-0 flex-col gap-1">
            <SkeletonLine size="xs" width="w-14" />
            <Bone className="h-[30px] w-full rounded-control @2xl:w-28" />
          </div>
        ))}
        <SkeletonLine size="xs" width="w-28" className="col-span-2 @2xl:ml-auto @2xl:self-center" />
      </SkeletonCard>
      <div className="mt-4 grid gap-3 @xl:grid-cols-2 @4xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <SkeletonCard key={i} className="flex h-full flex-col overflow-hidden">
            <Bone className="aspect-[16/7] w-full rounded-none" />
            <div className="flex flex-1 flex-col gap-2.5 p-4">
              <div className="flex items-center gap-1.5"><SkeletonBadge width="w-16" /><SkeletonBadge width="w-20" /><SkeletonLine size="xs" width="w-12" className="ml-auto" /></div>
              <div><SkeletonLine size="sm" width="w-3/4" /><SkeletonLine size="xs" width="w-1/2" className="mt-0.5" /></div>
              <Bone className="h-1.5 w-full rounded-none" />
              <SkeletonLine size="xs" width="w-2/3" />
              <div className="mt-auto flex flex-wrap gap-1"><SkeletonBadge width="w-20" /><SkeletonBadge width="w-28" /><SkeletonBadge width="w-24" /></div>
              <SkeletonLine size="xs" width="w-3/4" />
            </div>
          </SkeletonCard>
        ))}
      </div>
    </Skeleton>
  );
}

export function FormatsSkeleton() {
  return (
    <div className={pageClass}>
      {productHeader({ title: "w-40", subtitle: 2, actions: ["w-40"], actionSize: "sm" })}
      <Bone className="h-[52px] w-full rounded-none" />
      <FormatsBodySkeleton />
    </div>
  );
}

// MARK: Studio

export function StudioSkeleton() {
  const heading = (className?: string) => <SkeletonLine size="title" width="w-28" className={className} />;
  return (
    <Skeleton label={m("Loading the studio")} className={pageClass}>
      {productHeader({ title: "w-36", subtitle: 2, aside: <div className="flex flex-wrap gap-1.5"><SkeletonBadge width="w-16" /><SkeletonBadge width="w-32" /><SkeletonBadge width="w-28" /></div> })}
      <section className="mb-6">
        <div className="mb-3 flex items-center justify-between">{heading()}<SkeletonLine size="xs" width="w-8" /></div>
        <SkeletonCard className="grid gap-5 p-4 @4xl:grid-cols-[minmax(0,1fr)_280px]">
          <div className="grid min-w-0 content-start gap-5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="grid gap-2">
                <SkeletonLine size="sm" width="w-32" />
                <div className="flex flex-wrap gap-2">{[96, 120, 88, 110].map((w, j) => <Bone key={j} className="h-7 rounded-control" style={{ width: w }} />)}</div>
              </div>
            ))}
          </div>
          <div className="grid content-start gap-3"><Bone className="h-24 w-full rounded-inner" /><SkeletonButton width="w-full" /></div>
        </SkeletonCard>
      </section>
      <section className="mb-6">
        {heading("mb-3")}
        <SkeletonCard className="p-4"><SkeletonList rows={2} icon={false} /></SkeletonCard>
      </section>
      <section>
        {heading("mb-3")}
        <SkeletonTabs widths={[96, 90, 82, 50]} className="mb-3" />
        <div className="grid grid-cols-2 gap-3 @2xl:grid-cols-3 @4xl:grid-cols-4 @6xl:grid-cols-5">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} aria-hidden className="overflow-hidden border border-line bg-card">
              <Bone className="aspect-[4/5] w-full rounded-none" />
              <div className="grid gap-1.5 p-2.5"><SkeletonLine size="xs" width="w-2/3" /><SkeletonBadge width="w-16" /></div>
            </div>
          ))}
        </div>
      </section>
    </Skeleton>
  );
}

// MARK: Playground

/** The Playground: header, the form card (tabs, reference box, image strip, prompt, options, Generate) and the results grid. */
export function PlaygroundSkeleton() {
  const row = (w: number) => <div className="flex items-center justify-between gap-2"><SkeletonLine size="xs" width="w-14" /><Bone className="h-[30px] rounded-inner" style={{ width: w }} /></div>;
  return (
    <Skeleton label={m("Loading Remix")} className={pageClass}>
      {productHeader({ title: "w-44", subtitle: 1, subtitleWidth: "w-3/4",
        aside: <div className="flex flex-wrap gap-2"><SkeletonBadge width="w-36" /><SkeletonBadge width="w-32" /></div> })}
      <div className="grid items-start gap-3 @4xl:grid-cols-[minmax(340px,400px)_minmax(0,1fr)]">
        <SkeletonCard className="grid gap-4 p-4">
          <Bone className="h-[30px] w-full rounded-inner" />
          <div className="grid gap-1.5"><SkeletonLine size="xs" width="w-20" /><Bone className="h-36 w-full rounded-inner" /></div>
          <div className="grid gap-1.5"><SkeletonLine size="xs" width="w-24" /><div className="flex gap-1.5">{[0, 1, 2].map((i) => <Bone key={i} className="size-14 rounded-inner" />)}</div></div>
          <div className="grid gap-1.5"><SkeletonLine size="xs" width="w-32" /><Bone className="h-28 w-full rounded-inner" /></div>
          <div className="grid gap-2.5">{row(176)}{row(128)}{row(260)}{row(220)}</div>
          <div className="grid gap-1.5 border-t border-line pt-4"><SkeletonButton width="w-full" /></div>
        </SkeletonCard>
        <div className="min-w-0">
          <div className="mb-3 flex min-h-8 items-center"><SkeletonLine size="sm" width="w-20" /></div>
          <div className="grid grid-cols-2 gap-3 @3xl:grid-cols-[repeat(auto-fill,minmax(210px,1fr))]">
            {Array.from({ length: 6 }, (_, i) => (
              <SkeletonCard key={i} className="overflow-hidden">
                <Bone className="aspect-[4/5] w-full rounded-none" />
                <div className="grid gap-2 p-2.5"><SkeletonText lines={2} size="xs" /><div className="flex gap-1">{[0, 1, 2].map((j) => <Bone key={j} className="size-6 rounded-sm" />)}</div></div>
              </SkeletonCard>
            ))}
          </div>
        </div>
      </div>
    </Skeleton>
  );
}

// MARK: Launch

export function LaunchSkeleton() {
  return (
    <Skeleton label={m("Loading Launch")} className={pageClass}>
      {productHeader({ title: "w-36", subtitle: 2,
        aside: <div className="flex flex-col items-start gap-1 @md:items-end"><SkeletonLine size="sm" width="w-48" /><SkeletonLine size="xs" width="w-40" /></div> })}
      <div className="grid gap-6">
        <SkeletonCard className="p-4">
          <SkeletonLine size="title" width="w-48" />
          <SkeletonText lines={2} className="mt-1" />
          <div className="mt-4 grid gap-3 @2xl:grid-cols-3">{[0, 1, 2].map((i) => <Bone key={i} className="h-20 rounded-inner" />)}</div>
        </SkeletonCard>
        <div className="grid gap-3">
          <SkeletonLine size="title" width="w-52" />
          {[0, 1].map((i) => (
            <SkeletonCard key={i} className="grid min-w-0 gap-4 p-4 @3xl:grid-cols-[minmax(0,1fr)_320px]">
              <div className="flex min-w-0 gap-4"><Bone className="aspect-[4/5] w-24 rounded-inner" /><SkeletonText lines={3} className="flex-1" /></div>
              <div className="grid content-start gap-2"><Bone className="h-[30px] w-full rounded-control" /><SkeletonButton size="sm" width="w-40" /></div>
            </SkeletonCard>
          ))}
        </div>
        <SkeletonCard className="py-3"><SkeletonTable rows={3} /></SkeletonCard>
        <SkeletonForm fields={4} />
      </div>
    </Skeleton>
  );
}

// MARK: Measure

/** Measure below its header: the CAC source switch, the KPI strip and the first row of panels. */
export function MeasureBodySkeleton() {
  const panel = "min-w-0 rounded-card border border-line bg-card";
  return (
    <Skeleton label={m("Loading Measure")}>
      <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2"><SkeletonLine size="sm" width="w-52" /><SkeletonTabs widths={[78, 54, 156]} /></div>
      <div aria-hidden className={`${panel} mt-4 grid gap-px overflow-hidden bg-line! @2xl:grid-cols-2 @5xl:grid-cols-4`}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex min-w-0 flex-col gap-1.5 bg-card px-4 py-3.5">
            <SkeletonLine size="sm" width="w-24" />
            <span className="flex h-10 items-center gap-2"><Bone className="h-8 w-28" /><Bone className="h-7 w-16 rounded-full" /></span>
            <SkeletonLine size="sm" width="w-40" />
          </div>
        ))}
      </div>
      <div className="mt-3 grid gap-3 @3xl:grid-cols-2 @6xl:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} aria-hidden className={`${panel} flex h-64 flex-col gap-3 p-4`}>
            <SkeletonLine size="title" width="w-1/3" />
            <Bone className="h-12 w-1/2" />
            <Bone className="mt-auto h-24 w-full rounded-inner" />
          </div>
        ))}
      </div>
    </Skeleton>
  );
}

export function MeasureSkeleton() {
  return (
    <div className={pageClass}>
      {productHeader({ title: "w-32", subtitle: 1, subtitleWidth: "w-96", actions: ["w-36", "w-28", "w-24"], className: "gap-x-6 gap-y-3" })}
      <MeasureBodySkeleton />
    </div>
  );
}

// MARK: Workspace

/** An app's Home: header, the next step, the three setup steps and what can be unlocked, with the recent creatives beside them. */
export function WorkspaceOverviewSkeleton() {
  const rows = (keys: string[], lines: 1 | 2) => keys.map((key) => (
    <div key={key} className={`flex min-h-11 gap-3 ${lines === 2 ? "py-1.5" : "items-center py-1.5"}`}>
      <Bone className={`size-4 rounded-full ${lines === 2 ? "mt-0.5" : ""}`} />
      <span className="min-w-0 flex-1"><SkeletonLine size="sm" width={lines === 2 ? "w-28" : "w-2/3"} />{lines === 2 && <SkeletonLine size="sm" width="w-3/4" className="mt-0.5" />}</span>
      {lines === 1 && <SkeletonBadge width="w-14" />}
    </div>
  ));
  return (
    <Skeleton label={m("Loading the app")} className={pageClass}>
      {productHeader({ title: "w-48", subtitle: 1, subtitleWidth: "w-80", actions: ["w-16"], actionSize: "sm" })}
      <div className="grid items-start gap-x-10 gap-y-8 @4xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid min-w-0 gap-3">
          <SkeletonCard className="flex flex-wrap items-center gap-3 p-4">
            <Bone className="size-6 rounded-md" />
            <div className="min-w-0 flex-1 basis-48"><SkeletonLine size="caption" width="w-16" /><SkeletonLine size="title" width="w-56" /><SkeletonLine size="sm" width="w-3/4" className="mt-0.5" /></div>
            <SkeletonButton width="w-32" />
          </SkeletonCard>
          <div className="mt-3">
            <div className="mb-2 flex min-h-7 items-center"><SkeletonLine size="sm" width="w-16" /></div>
            {rows(["profile", "brand", "competitors"], 2)}
          </div>
          <div className="mt-3">
            <div className="mb-2 flex min-h-7 items-center"><SkeletonLine size="sm" width="w-28" /></div>
            {rows(UNLOCKABLE.map((u) => u.feature), 1)}
          </div>
        </div>
        <SkeletonCard className="p-4">
          <SkeletonLine size="title" width="w-20" />
          <div className="mt-3 grid grid-cols-3 gap-2">{Array.from({ length: 6 }, (_, i) => <Bone key={i} className="aspect-square w-full rounded-inner" />)}</div>
        </SkeletonCard>
      </div>
    </Skeleton>
  );
}

export function WorkspaceSettingsSkeleton() {
  return (
    <Skeleton label={m("Loading settings")} className={pageClass}>
      {productHeader({ title: "w-36", subtitle: 2 })}
      <div className="grid max-w-[700px] gap-4">
        <SkeletonCard className="flex flex-wrap items-center gap-3 p-4">
          <Bone className="size-8 rounded-md" />
          <div className="min-w-0 flex-1"><SkeletonLine size="title" width="w-20" /><SkeletonLine size="sm" width="w-3/4" className="mt-0.5" /></div>
          <SkeletonButton size="sm" width="w-40" />
        </SkeletonCard>
        <SkeletonLine size="title" width="w-28" className="mt-4" />
        <SkeletonForm fields={4} />
        <SkeletonForm fields={1} columns={1} />
        <SkeletonForm fields={1} columns={1} />
        <SkeletonForm fields={2} />
      </div>
    </Skeleton>
  );
}

// MARK: Brand

/** The Brand page: header with Import and Save, the tabs, then its section cards. */
export function BrandSkeleton() {
  return (
    <Skeleton label={m("Loading the brand")} className={pageClass}>
      {productHeader({ title: "w-20", subtitle: 1, subtitleWidth: "w-2/3", actions: ["w-40", "w-16"] })}
      <SkeletonTabs widths={[60, 70, 62, 74]} className="mb-4" />
      <div className="grid gap-4">
        <SkeletonForm fields={4} />
        <SkeletonCard className="p-4">
          <SkeletonLine size="title" width="w-32" /><SkeletonLine size="sm" width="w-2/3" className="mt-0.5" />
          <div className="mt-4 flex flex-wrap gap-3"><Bone className="size-10 rounded-[22%]" />{[0, 1, 2, 3].map((i) => <Bone key={i} className="aspect-[9/19.5] w-20 rounded-inner" />)}</div>
        </SkeletonCard>
        <SkeletonForm fields={3} />
      </div>
    </Skeleton>
  );
}

// MARK: Projects and reports

/** A list of analyses of one kind (Accounts, Campaigns): header and cards. */
export function WorkflowListSkeleton() {
  return (
    <Skeleton label={m("Loading analyses")} className={pageClass}>
      <SkeletonPageHeader eyebrow="w-28" title="w-28" subtitleWidth="w-3/4" actions={["w-44"]} />
      <SkeletonProjectCards />
    </Skeleton>
  );
}

/** A report's tabs, its stat strip and the first cards. */
export function ReportSkeleton() {
  return (
    <Skeleton label={m("Loading report")}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <SkeletonTabs widths={[76, 108, 70, 70, 112]} />
        <SkeletonLine size="caption" width="w-64" />
      </div>
      <SkeletonCard className="flex flex-wrap gap-px overflow-hidden bg-line [&>*]:flex-[1_1_160px] [&>*]:bg-card">
        {Array.from({ length: 5 }, (_, i) => <div key={i} className="flex flex-col gap-1 px-4 py-3"><SkeletonLine size="caption" width="w-16" /><span className="flex h-[22px] items-center"><Bone className="h-4 w-14" /></span></div>)}
      </SkeletonCard>
      <div className="mt-4 grid gap-3 @4xl:grid-cols-[1.6fr_1fr]">
        <SkeletonCard className="p-4"><SkeletonLine size="title" width="w-40" /><SkeletonLine size="caption" width="w-56" className="mt-0.5" /><Bone className="mt-4 h-44 w-full rounded-inner" /></SkeletonCard>
        <SkeletonCard className="p-4"><SkeletonLine size="title" width="w-32" /><SkeletonList rows={4} className="mt-3" /></SkeletonCard>
      </div>
    </Skeleton>
  );
}

/** An analysis: crumbs, name and badges, description, buttons, then its report. */
export function ProjectSkeleton() {
  return (
    <Skeleton label={m("Loading the analysis")} className={pageClass}>
      <SkeletonPageHeader eyebrow="w-40" title="w-64" subtitleWidth="w-2/3" actions={["w-20", "w-48", "w-14"]} actionSize="sm" />
      <ReportSkeleton />
    </Skeleton>
  );
}

// MARK: Home

/** Home below its header while the apps and the latest report load: the apps as list rows, then the overview's cards. */
export function OverviewSkeleton() {
  return (
    <Skeleton label={m("Loading Home")}>
      <div className="mb-8">
        <div className="mb-2 flex min-h-7 items-center justify-between"><SkeletonLine size="sm" width="w-20" /><SkeletonLine size="sm" width="w-16" /></div>
        {[0, 1].map((i) => (
          <div key={i} className="flex h-12 items-center gap-3">
            <Bone className="size-6 rounded-md" />
            <span className="min-w-0 flex-1"><SkeletonLine size="sm" width="w-40" /><SkeletonLine size="xs" width="w-64" /></span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 @4xl:grid-cols-2">
        {[0, 1].map((i) => (
          <SkeletonCard key={i} className="flex flex-col gap-2 p-4">
            <SkeletonLine size="title" width="w-40" />
            <SkeletonLine size="caption" width="w-28" />
            <div className="mt-2 grid gap-0">{[0, 1, 2].map((j) => <div key={j} className="flex h-9 items-center justify-between gap-3"><SkeletonLine size="sm" width="w-24" /><SkeletonLine size="sm" width="w-14" /></div>)}</div>
          </SkeletonCard>
        ))}
      </div>
    </Skeleton>
  );
}

export function DashboardSkeleton() {
  return (
    <div className={pageClass}>
      <SkeletonPageHeader eyebrow={false} title="w-16" subtitleWidth="w-80" actions={["w-32"]} />
      <OverviewSkeleton />
      <section className="mt-8">
        <div className="mb-2 flex min-h-7 items-center"><SkeletonLine size="sm" width="w-24" /></div>
        <Skeleton label={m("Loading analyses")}><SkeletonProjectCards /></Skeleton>
      </section>
    </div>
  );
}

// MARK: Fallback

/** Any other page: a header and a few cards. */
export function GenericPageSkeleton() {
  return (
    <Skeleton className={pageClass}>
      <SkeletonPageHeader />
      <SkeletonProjectCards />
    </Skeleton>
  );
}

/** The competitor search form while the apps load (inside the form's own card). */
export function CompetitorFormSkeleton() {
  const label = (width = "w-20") => <SkeletonLine size="sm" width={width} className="mb-2" />;
  const check = (lines: number) => <div className="flex items-start gap-2"><Bone className="mt-0.5 size-4 rounded-xs" /><SkeletonText lines={lines} className="flex-1" /></div>;
  return (
    <Skeleton label={m("Loading your apps")}>
      <SkeletonCard className="p-4">
        <SkeletonText lines={2} />
        <div className="mt-5">{label("w-10")}<div className="grid gap-2 @xl:grid-cols-2">{[0, 1].map((i) => <Bone key={i} className="h-[62px] rounded-control" />)}</div></div>
        <div className="mt-6">{label()}<div className="grid gap-2 @xl:grid-cols-2">{[0, 1, 2, 3, 4].map((i) => <Bone key={i} className="h-11 rounded-control" />)}</div></div>
        <div className="mt-6 grid gap-6 @xl:grid-cols-2">
          <div>{label()}<SkeletonTabs widths={[56, 56, 56, 62]} /></div>
          <div>{label("w-14")}<SkeletonTabs widths={[48, 68, 44]} /><SkeletonLine size="xs" width="w-56" className="mt-1" /></div>
        </div>
        <div className="mt-6">{label("w-36")}<Bone className="h-[30px] w-full rounded-control" /><div className="mt-3">{check(2)}</div></div>
        <div className="mt-4">{check(2)}</div>
        <Bone className="mt-4 h-16 w-full rounded-inner" />
        <div className="mt-6 flex justify-between"><SkeletonButton width="w-14" /><SkeletonButton width="w-40" /></div>
      </SkeletonCard>
    </Skeleton>
  );
}

// MARK: Market

/** Market below its header: the tabs, then a list of apps (icon, name and developer, rating, price, version). */
export function MarketBodySkeleton() {
  return (
    <Skeleton label={m("Loading apps")}>
      <SkeletonTabs widths={[120, 92, 112]} className="mb-5" />
      <div aria-hidden className="grid">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex h-12 items-center gap-3">
            <Bone className="size-8 rounded-[22%]" />
            <span className="flex min-w-0 flex-1 flex-col gap-1"><SkeletonLine size="sm" width="w-48" /><SkeletonLine size="xs" width="w-32" /></span>
            <SkeletonLine size="sm" width="w-20" className="max-sm:hidden" />
            <SkeletonLine size="sm" width="w-24" className="max-md:hidden" />
          </div>
        ))}
      </div>
    </Skeleton>
  );
}

export function MarketSkeleton() {
  return (
    <div className={pageClass}>
      {productHeader({ title: "w-28", subtitle: 1, subtitleWidth: "w-96", actions: ["w-28"] })}
      <MarketBodySkeleton />
    </div>
  );
}
