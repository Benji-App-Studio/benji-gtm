// An app's Home, as rules: the three things every product sets up (profile, brand basics,
// competitors) and the one next step. Nothing here assumes a mobile subscription app, and the next
// step never names a page that is locked: it asks for the key or the connection instead. Plain
// TypeScript, safe in the browser; checked in workspace-setup.test.ts.
import { featureState, type Feature, type FeatureState } from "./capabilities";
import type { InstallState } from "./install/types";
import { brandBasicsGaps, brandKitGaps, productHasApp, workspaceHref, type BrandKit, type WorkspaceConnections, type WorkspaceCounts } from "./workspace-schema";

export interface SetupStep {
  key: "profile" | "brand" | "competitors";
  label: string;
  detail: string;
  /** null while what it is judged from is still loading. */
  done: boolean | null;
  href: string;
  action: string;
  /** "2/3" on a step that is partly done. */
  progress?: string;
}
export interface NextMove { title: string; body: string; href: string; action: string }
type Product = { description?: string | null; kind?: string | null; website?: string | null; links?: string[] | null };
type App = { id: string; connections?: WorkspaceConnections | null };

/** The three things every product needs, whatever it sells: its profile, its brand basics and who it's up against. */
export function setupSteps(id: string, kit: BrandKit, product: Product | undefined, watchlist: number | undefined): SetupStep[] {
  const basics = brandBasicsGaps(kit);
  // What else the Brand page could hold: worth adding, never blocking.
  const more = brandKitGaps(kit, productHasApp(product, kit)).filter((gap) => !basics.includes(gap));
  return [
    {
      key: "profile", label: "Profile", href: `/app/w/${id}/brand?tab=product`, action: "Open the profile",
      done: product ? Boolean(product.description?.trim()) : null,
      detail: "What it is, who it's for and its links. Competitor searches and every prompt start from it.",
    },
    {
      key: "brand", label: "Brand basics", href: workspaceHref(id, "brand"), action: "Open Brand",
      done: basics.length === 0,
      detail: basics.length ? `Still to add: ${basics.join(", ")}.` : more.length ? `Logo, colours and voice are set. Also worth adding: ${more.join(", ")}.` : "Logo, colours and voice are set.",
      progress: basics.length ? `${3 - basics.length}/3` : undefined,
    },
    {
      key: "competitors", label: "Competitors", href: `${workspaceHref(id, "research")}?competitors`, action: "Add competitors",
      done: watchlist === undefined ? null : watchlist > 0,
      detail: watchlist ? `${watchlist} on the list. Research follows their ads, and checks keep their names out of your creatives.` : "One list for the whole app: Research follows their ads, and checks keep their names out of your creatives.",
    },
  ];
}

/** What a move in the loop needs before its page works. Research needs nothing: importing ads takes no key. */
const LOOP_NEEDS: Record<"formats" | "create" | "launch" | "measure", Feature[]> = {
  formats: ["ai"], create: ["studio.images"], launch: ["launch"], measure: ["measure.meta"],
};

/**
 * The first setup gap, else the next move in the loop: research → formats → studio → launch → measure.
 * A move whose page is locked is never offered: the step is to unlock it, and its link goes to where the
 * key or the connection is set. null while something it is judged from is still loading.
 */
export function nextStep(id: string, steps: SetupStep[], counts: WorkspaceCounts | null | undefined, install: InstallState | null, app: App): NextMove | null {
  const gap = steps.find((s) => s.done === false);
  if (gap) return { title: `Set up: ${gap.label}`, body: gap.detail, href: gap.href, action: gap.action };
  if (steps.some((s) => s.done === null) || counts === undefined) return null;
  const href = (page: Parameters<typeof workspaceHref>[1]) => workspaceHref(id, page);
  const locked = (move: keyof typeof LOOP_NEEDS): FeatureState | null => {
    for (const feature of LOOP_NEEDS[move]) { const state = featureState(feature, install, app); if (!state.ok) return state; }
    return null;
  };
  if (!counts?.paidAds) return { title: "Get your competitors' ads in", body: "On Research, collect a competitor's ads with the Ad Library extension and import the file. The longest-running ads are the ones that work.", href: href("research"), action: "Open Research" };
  const move: keyof typeof LOOP_NEEDS = !counts.formatCards ? "formats" : !counts.creatives || !counts.approvedCreatives ? "create" : !counts.metaAds ? "launch" : "measure";
  // Reviewing creatives that already exist needs no key.
  const blocked = move === "create" && counts.creatives ? null : locked(move);
  if (blocked) return { title: blocked.title, body: blocked.body, href: blocked.href, action: blocked.action };
  if (move === "formats") return { title: "Turn winners into formats", body: "The Studio's \"Start from: a format\" groups the winning ads into formats, each with a prompt ready to make.", href: `${href("studio")}?start=format`, action: "Open Studio" };
  if (!counts.creatives) return { title: "Make your first creatives", body: "Start a batch in the Studio from a format or a brief. Each creative is checked before you approve it.", href: href("studio"), action: "Open Studio" };
  if (!counts.approvedCreatives) return { title: "Review and approve creatives", body: "Only approved creatives can launch. Open the Studio's review list.", href: href("studio"), action: "Review creatives" };
  if (move === "launch") return { title: "Launch approved creatives", body: "Launch sends approved creatives to Meta as paused drafts. Nothing spends until you publish them.", href: href("launch"), action: "Open Launch" };
  return { title: "See what's working", body: "Measure puts ad spend next to what each creative brought in.", href: href("measure"), action: "Open Measure" };
}
