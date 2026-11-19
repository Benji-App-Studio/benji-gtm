"use client";
// Development only (see app/preview): draws the real shell, shared components and settings screens on
// sample data. Requests to /api are answered in the browser by sample.ts.
import Link from "next/link";
import { Suspense, useState, useSyncExternalStore, type ReactNode } from "react";
import { AppShell } from "../app-shell";
import { AuthForm } from "../auth-form";
import { EntryFrame } from "../entry-frame";
import { IconChart, IconCompass, IconFilters, IconMore, IconPlus, IconRocket, IconSparkles, IconTrash } from "../icons";
import { PathOverride } from "../nav/path";
import { AppSettings } from "../settings/app-settings";
import { AppearanceSettings } from "../settings/appearance-settings";
import { GeneralSettings } from "../settings/general";
import { KeysSettings } from "../settings/keys";
import { MembersSettings } from "../settings/members";
import { ModelsSettings } from "../settings/models";
import { settingsColumnClass } from "../settings/pages";
import { RunnerSettings } from "../settings/runner";
import { UpdatesSettings } from "../settings/updates";
import { LaunchView } from "../launch/launch-view";
import { MeasureView } from "../measure/measure-view";
import { PlaygroundView } from "../playground/playground-view";
import { StudioView } from "../studio/studio-view";
import {
  Badge, Button, ButtonLink, Callout, Card, CardHeader, ConnectState, DeltaChip, EmptyState, ErrorNote, Field, IconButton, inputClass, Kbd, Locked, Menu, MenuItem,
  MenuLabel, MenuSeparator, MenuSub, Page, PageHeader, Pagination, SearchField, SectionHeader, Segmented, SelectPill, SettingsGroup, SettingsRow, Stat, StatRow,
  StatStrip, StatusPill, Table, Td, Th, Toggle, Tr,
} from "../ui";
import { BrandView } from "../brand/brand-view";
import { CompetitorForm } from "../competitor-form";
import { Dashboard } from "../dashboard";
import { ProductForm } from "../product-form";
import { ProjectView } from "../project-view";
import { ResearchAds } from "../research-ads";
import { ConnectFor, FreeRoute, useFirstLocked } from "../research/gates";
import { WorkspaceOverview } from "../workspace/workspace-overview";
import { APP_A, APP_B, installSampleApi } from "./sample";

const VIEWS: { view: string; label: string }[] = [
  { view: "home", label: "Shell and a sample page" },
  { view: "locked", label: "A page that needs a key" },
  { view: "components", label: "Shared components" },
  { view: "settings", label: "Settings: General" },
  { view: "settings/keys", label: "Settings: API keys" },
  { view: "settings/models", label: "Settings: AI models" },
  { view: "settings/members", label: "Settings: Members" },
  { view: "settings/appearance", label: "Settings: Appearance" },
  { view: "settings/updates", label: "Settings: Updates" },
  { view: "settings/runner", label: "Settings: Desktop runner (add ?keys=none|some|all)" },
  { view: "studio", label: "Studio (add ?keys=none|some|all)" },
  { view: "playground", label: "Playground (add ?keys=none|some|all)" },
  { view: "launch", label: "Launch (add ?keys=none|some|all)" },
  { view: "measure", label: "Measure (add ?keys=none|some|all, and &source=meta|revenuecat|appstack for one source)" },
  { view: "settings/app", label: "Settings: an app (the main one)" },
  { view: "settings/app2", label: "Settings: an app that can be deleted" },
  { view: "pages/home", label: "Research side: Home (?apps=0, ?analyses=0, ?keys=all)" },
  { view: "pages/app", label: "Research side: an app's Home (?bare=1, ?keys=all|none)" },
  { view: "pages/research", label: "Research side: Research (?ads=0, ?keys=all)" },
  { view: "pages/brand", label: "Research side: Brand" },
  { view: "pages/new", label: "Research side: New analysis (?keys=all)" },
  { view: "pages/new-app", label: "Research side: New app form" },
  { view: "pages/analysis", label: "Research side: an analysis waiting for review" },
  { view: "login", label: "Log in" },
  { view: "signup", label: "Sign up" },
];

/** The app pages drawn whole on sample data (their requests are answered by sample-creative.ts). */
const MODULE_VIEWS = ["studio", "playground", "launch", "measure"];

export function PreviewScreen({ view, role, fail }: { view: string; role: string; fail: boolean }) {
  // Before anything below asks for data: answer /api from the sample (once per page load).
  useState(() => { if (typeof window !== "undefined") installSampleApi(role, fail); return true; });
  // Studio and Playground open a live channel to the project: without one they wait for the browser.
  const inBrowser = useSyncExternalStore(() => () => {}, () => true, () => false);
  if (MODULE_VIEWS.includes(view) && !inBrowser) return null;

  if (view === "login" || view === "signup") return <EntryFrame><Suspense><AuthForm mode={view} signupOpen /></Suspense></EntryFrame>;
  if (!VIEWS.some((v) => v.view === view)) {
    return (
      <div className="mx-auto w-full max-w-md px-6 py-12">
        <h1 className="text-display font-medium">Preview</h1>
        <p className="mt-1.5 text-sm text-muted">Sample data, no session. Add ?role=member or ?role=legacy to see what others see, and &amp;fail=1 for a failed install request.</p>
        <Card className="mt-6 divide-y divide-line">
          {VIEWS.map((v) => <a key={v.view} href={`/preview/${v.view}`} className="block px-4 py-2.5 text-sm hover:bg-hover">{v.label}</a>)}
        </Card>
      </div>
    );
  }

  const settings = view.startsWith("settings");
  const path = view === "home" ? "/app"
    : view === "locked" ? `/app/w/${APP_A}/launch`
    : view === "components" ? `/app/w/${APP_B}/research`
    : MODULE_VIEWS.includes(view) ? `/app/w/${APP_A}/${view}`
    : view === "settings" ? "/app/settings"
    : view === "settings/app" ? `/app/settings/apps/${APP_A}`
    : view === "settings/app2" ? `/app/settings/apps/${APP_B}`
    : view === "pages/home" ? "/app"
    : view === "pages/app" ? `/app/w/${APP_A}`
    : view === "pages/research" ? `/app/w/${APP_A}/research`
    : view === "pages/brand" ? `/app/w/${APP_A}/brand`
    : view === "pages/new" ? "/app/new"
    : view === "pages/new-app" ? "/app/product/new"
    : view === "pages/analysis" ? "/app/p/p1"
    : `/app/${view}`;
  const page: ReactNode = view === "home" ? <SamplePage />
    : view === "locked" ? <Page><PageHeader crumbs={[{ label: "Trailmix", href: "/preview/home" }, { label: "Launch" }]} title="Launch" subtitle="Send approved creatives to Meta as paused drafts." /><ConnectState title="Connect Meta to use Launch" body="Launch needs a Meta system user token and app secret to create paused drafts in your ad account." action="Add the Meta keys" /></Page>
    : view === "components" ? <Gallery />
    : view === "settings" ? <GeneralSettings account={{ name: "Sam Rivera", email: "sam@northfield.example", since: "2026-09-12T10:00:00Z" }} />
    : view === "settings/keys" ? <KeysSettings />
    : view === "settings/models" ? <ModelsSettings />
    : view === "settings/members" ? <MembersSettings />
    : view === "settings/appearance" ? <AppearanceSettings initial="light" />
    : view === "settings/updates" ? <UpdatesSettings />
    : view === "pages/home" ? <Dashboard />
    : view === "pages/app" ? <WorkspaceOverview id={APP_A} />
    : view === "pages/research" ? <ResearchAds productId={APP_A} />
    : view === "pages/brand" ? <BrandView productId={APP_A} tab="brand" />
    : view === "pages/new" ? <NewAnalysisSample />
    : view === "pages/new-app" ? <Page className="max-w-3xl"><PageHeader crumbs={[{ label: "Home" }, { label: "New app" }]} title="Add an app" subtitle="Each app keeps its own profile, brand, competitors and creatives." /><ProductForm onDone={() => {}} /></Page>
    : view === "pages/analysis" ? <Suspense><ProjectView id="p1" /></Suspense>
    : view === "settings/runner" ? <RunnerSettings />
    : view === "studio" ? <StudioView productId={APP_A} />
    : view === "playground" ? <PlaygroundView key={APP_A} productId={APP_A} />
    : view === "launch" ? <LaunchView productId={APP_A} />
    : view === "measure" ? <MeasureView productId={APP_A} name="Trailmix" />
    : <AppSettings id={view === "settings/app2" ? APP_B : APP_A} />;

  return (
    <PathOverride value={path}>
      <AppShell name="Sam Rivera" email="sam@northfield.example" page={settings ? <div className={settingsColumnClass}>{page}</div> : page}>{null}</AppShell>
    </PathOverride>
  );
}

/** The new-analysis page's two states: what to connect, or the competitor form. */
function NewAnalysisSample() {
  const locked = useFirstLocked(["research.collect", "ai"]);
  return (
    <Page className="max-w-3xl">
      <PageHeader crumbs={[{ label: "Home" }, { label: "New analysis" }]} title={locked ? "New analysis" : "Find your competitors"} subtitle="An analysis collects accounts' recent posts and reads what works in them." />
      {locked ? <Card><ConnectFor state={locked} otherwise={<FreeRoute productId={APP_A} />} /></Card> : <CompetitorForm onBack={() => {}} />}
    </Page>
  );
}

/** A page in the target layout: slim header, pill tabs, a centred column with an input card, filters and a two-column grid of cards. */
function SamplePage() {
  const [tab, setTab] = useState("mine");
  const [filter, setFilter] = useState("all");
  const cards = [
    { icon: <IconCompass />, title: "Hiking apps, autumn", body: "Six competitors across Instagram and TikTok. The list is ready for you to check before the run.", meta: ["Competitors", "30 days", "240 posts"], badge: <Badge tone="caution">Ready to run</Badge> },
    { icon: <IconChart />, title: "@peakfinder", body: "Every post from one account, month by month. Reading the last 60 days now.", meta: ["Account", "60 days", "80 posts"], badge: <Badge tone="accent">Analyzing</Badge> },
    { icon: <IconRocket />, title: "Spring creator push", body: "Creators posting for one brand: the best clips and who is worth booking again.", meta: ["Campaign", "30 days", "52 posts"], badge: <Badge tone="win">Report ready</Badge> },
    { icon: <IconSparkles />, title: "Trail snacks, paid ads", body: "What has run longest in the Ad Library, and the hooks those ads open with.", meta: ["Competitors", "90 days", "118 ads"], badge: <Badge>Draft</Badge> },
  ];
  return (
    <Page>
      <PageHeader title="Home" actions={<><IconButton label="Filters"><IconFilters /></IconButton><ButtonLink href="/preview/home" size="sm"><IconPlus />New analysis</ButtonLink></>} />
      <Segmented label="Which analyses" className="-mt-2 mb-8" value={tab} onChange={setTab} options={[{ value: "mine", label: "My analyses" }, { value: "all", label: "All" }]} />
      <div className="mx-auto max-w-3xl">
        <h2 className="text-display font-medium">What do you want to look into?</h2>
        <p className="mt-1.5 text-sm text-muted">Name a competitor, an account or a campaign, and get back what is working for them.</p>
        <Card className="mt-5 p-3">
          <textarea aria-label="What to analyse" rows={3} placeholder="For example: the five hiking apps that advertise most on Instagram" className="w-full resize-none bg-transparent px-1 text-base text-ink outline-none placeholder:text-faint" />
          <div className="mt-1 flex items-center justify-between gap-2">
            <SelectPill label="Period" value="30" onChange={() => {}} options={[{ value: "30", label: "Last 30 days" }, { value: "60", label: "Last 60 days" }]} />
            <Button size="sm">Start</Button>
          </div>
        </Card>
        <div className="mt-6 flex flex-wrap gap-1.5">
          {["all", "competitors", "accounts", "campaigns"].map((f) => (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} className={`h-6 rounded-full border px-2.5 text-xs capitalize transition-colors ${filter === f ? "border-transparent bg-active font-medium text-ink" : "border-hairline text-muted hover:bg-hover"}`}>{f}</button>
          ))}
        </div>
        <div className="mt-4 grid gap-3 @2xl:grid-cols-2">
          {cards.map((c) => (
            <Card key={c.title} className="flex flex-col p-4">
              <div className="flex items-start justify-between gap-3"><span className="grid size-7 place-items-center rounded-md bg-control text-label [&_svg]:size-4">{c.icon}</span>{c.badge}</div>
              <h3 className="mt-3 text-sm font-medium">{c.title}</h3>
              <p className="mt-1 line-clamp-2 text-sm text-muted">{c.body}</p>
              <div className="mt-4 flex flex-wrap gap-x-3 gap-y-1 border-t border-line pt-3 text-xs text-faint">{c.meta.map((m) => <span key={m}>{m}</span>)}</div>
            </Card>
          ))}
        </div>
      </div>
    </Page>
  );
}

function Gallery() {
  const [seg, setSeg] = useState("cost");
  const [on, setOn] = useState(true);
  const [page, setPage] = useState(2);
  const [pick, setPick] = useState("all");
  const [picked, setPicked] = useState("Nothing chosen yet");
  const block = (title: string, children: ReactNode) => <section><SectionHeader title={title} /><Card className="flex flex-wrap items-center gap-3 p-4">{children}</Card></section>;
  return (
    <Page>
      <PageHeader crumbs={[{ label: "Pocket Garden", href: "/preview/home" }, { label: "Research" }]} title="Shared components" badge={<Badge tone="accent">Preview</Badge>} subtitle="Everything pages are built from, in the current theme."
        actions={<><SearchField placeholder="Search" hint="⌘K" className="w-48" /><Button variant="secondary" size="sm">Export</Button><Button size="sm">Save</Button></>} />
      <div className="grid gap-6">
        {block("Buttons", <>
          <Button>Primary</Button><Button variant="secondary">Secondary</Button><Button variant="ghost">Ghost</Button><Button variant="danger"><IconTrash />Delete</Button><Button disabled>Disabled</Button>
          <Button size="sm">Small</Button><Button size="sm" variant="secondary">Small</Button><IconButton label="More" /><IconButton size="sm" label="More" />
        </>)}
        {block("Labels", <>
          <Badge>Neutral</Badge><Badge tone="accent">Accent</Badge><Badge tone="win">Verified</Badge><Badge tone="warn">Failed</Badge><Badge tone="caution">At risk</Badge>
          <StatusPill tone="win">Live</StatusPill><StatusPill tone="warn">Critical</StatusPill><DeltaChip value="6.2%" direction="up" /><DeltaChip value="1.4%" direction="down" /><Kbd>⌘K</Kbd><span className="flex items-center gap-1 text-xs text-muted"><Kbd>G</Kbd>then<Kbd>S</Kbd></span>
        </>)}
        {block("Controls", <>
          <Segmented label="Unit" value={seg} onChange={setSeg} options={[{ value: "cost", label: "Cost" }, { value: "hours", label: "Hours" }, { value: "both", label: "Both" }]} />
          <SelectPill label="Branch" value={pick} onChange={setPick} options={[{ value: "all", label: "All platforms" }, { value: "ig", label: "Instagram" }]} />
          <Toggle checked={on} onChange={setOn} label="Notify me" /><Pagination page={page} pages={12} onPage={setPage} />
          <Menu label="Actions" trigger={(trigger) => <Button {...trigger} variant="secondary" size="sm"><IconMore />Menu</Button>}>
            <MenuLabel>This analysis</MenuLabel>
            <MenuItem kbd={<Kbd>R</Kbd>} onSelect={() => setPicked("Run again")}>Run again</MenuItem>
            <MenuItem onSelect={() => setPicked("Duplicate")}>Duplicate</MenuItem>
            <MenuSub label="Move to">
              <MenuItem onSelect={() => setPicked("Moved to Trailmix")}>Trailmix</MenuItem>
              <MenuItem onSelect={() => setPicked("Moved to Pocket Garden")}>Pocket Garden</MenuItem>
            </MenuSub>
            <MenuSeparator />
            <MenuItem danger onSelect={() => setPicked("Delete")}>Delete</MenuItem>
          </Menu>
          <span className="text-xs text-muted" role="status">{picked}</span>
        </>)}
        <section>
          <SectionHeader title="Fields" />
          <Card className="grid gap-4 p-4 @2xl:grid-cols-2">
            <Field label="Name" hint="Shown in the sidebar."><input className={inputClass} defaultValue="Trailmix" /></Field>
            <Field label="Platform"><select className={inputClass} defaultValue="ig"><option value="ig">Instagram</option><option value="tt">TikTok</option></select></Field>
            <Field label="Notes"><textarea className={inputClass} rows={3} placeholder="Anything worth remembering" /></Field>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" defaultChecked />Include paid ads</label>
          </Card>
        </section>
        <section>
          <SectionHeader title="Numbers and tables" />
          <StatStrip><Stat label="Spend" value="$4,820" hint="Last 30 days" delta={<DeltaChip value="6.2%" direction="up" good={false} />} /><Stat label="Installs" value="1,204" hint="Attributed" /><Stat label="Cost per install" value="$4.00" tone="win" hint="Target $4.50" /></StatStrip>
          <Card className="mt-3 p-4">
            <CardHeader title="Campaigns" subtitle="Ranked by spend" />
            <Table className="mt-3" minWidth={480}>
              <thead><tr><Th>Campaign</Th><Th>Status</Th><Th className="text-right">Spend</Th><Th className="text-right">Installs</Th></tr></thead>
              <tbody>
                {[["Autumn trails", "Live", "$2,410", "640"], ["Pack list hook", "Paused", "$1,330", "372"], ["Summit stories", "Live", "$1,080", "192"]].map((r) => (
                  <Tr key={r[0]}><Td className="font-medium">{r[0]}</Td><Td><StatusPill tone={r[1] === "Live" ? "win" : "neutral"}>{r[1]}</StatusPill></Td><Td className="text-right tabular-nums">{r[2]}</Td><Td className="text-right tabular-nums">{r[3]}</Td></Tr>
                ))}
              </tbody>
            </Table>
            <StatRow label="Total" value="$4,820" note="3 campaigns" />
          </Card>
        </section>
        <section>
          <SectionHeader title="States" />
          <div className="grid gap-3 @2xl:grid-cols-2">
            <EmptyState icon={<IconCompass />} title="No research yet" body="Add a competitor and their ads and posts show up here." action={<Button size="sm">Add a competitor</Button>} />
            <Card className="p-4">
              <ErrorNote title="The report didn't load">The connection dropped while it was loading. Try again.</ErrorNote>
              <Callout tone="caution" label="Noticed" title="Hooks under 3 seconds win here">Nine of the ten longest-running ads open with the product in hand.</Callout>
              <div className="mt-3"><Locked>Needs an OpenAI key</Locked></div>
            </Card>
          </div>
          <Card className="mt-3"><ConnectState title="Connect Meta to use Launch" body="Launch needs a Meta system user token to create paused drafts." action="Add the Meta keys" /></Card>
        </section>
        <SettingsGroup title="Settings rows" description="A label and one line on the left, the control on the right.">
          <SettingsRow label="Weekly summary" description="A short email every Monday with what changed."><Toggle checked={on} onChange={setOn} label="Weekly summary" /></SettingsRow>
          <SettingsRow label="Default period" description="Used when an analysis doesn't say otherwise."><Segmented label="Default period" value={seg} onChange={setSeg} options={[{ value: "cost", label: "30 days" }, { value: "hours", label: "60 days" }, { value: "both", label: "90 days" }]} /></SettingsRow>
        </SettingsGroup>
        <p className="text-xs text-faint">Other screens: <Link href="/preview" className="text-accent hover:underline">the preview list</Link>.</p>
      </div>
    </Page>
  );
}
