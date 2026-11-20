"use client";
// Research → Ads: competitors' paid ads for one workspace. Long-running ads come first (an
// advertiser that keeps paying for an ad for weeks is telling you it works), boosted by how many
// live ads share the creative. New ads are read in the background (format, hook, each line's job; the
// `research` function's decode-new, asked for after an import or a pull and when the page opens); an
// ad can be handed to the format library, or recreated with the Recreate sheet (its style, structure
// and pattern; never its brand or assets). The competitor list (`ad_watchlist`, the product's one
// list) is managed in the Competitors panel. Ads come in as files the Ad Library extension saves
// (free, no key), or from automatic collection when its key is connected. An import also saves the
// ads' images and videos to storage (the Ad Library's links expire); the ads come back with the stored
// copies in place, and a "Stored media" card shows the progress. What needs a key says so in place
// (components/research/gates.tsx): reading ads needs the AI's key, automatic collection its own.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatBytes, scrapeMediaCount, scrapeMediaFiles, type MediaPreview } from "@/lib/ad-media";
import { COMPETITOR_SOURCE_LABEL } from "@/lib/competitors";
import { IMPORT_BATCH_ADS, planImport, runImport, type BatchAnswer } from "@/lib/scrape-import";
import { loadPersisted, peek, prime, refresh, savePersisted } from "@/lib/client-cache";
import { finishLocalTask, startLocalTask, updateLocalTask } from "@/lib/local-tasks";
import { nearestPlacement, placementById, type Placement } from "@/lib/meta-formats";
import { FIT_LABEL, type ProductAsset } from "@/lib/product-assets";
import {
  adLibraryLink, AD_FORMAT_LABEL, applyPreset, matchesRead, presetOf, presetsFor, STOPPED_FILTERS, CTA_TYPE_LABEL, LOCAL_MAX_ADS, DEFAULT_VIEW, expectedRank, fitFor, inLaunchWindow, LAUNCH_WINDOWS, launchDaysAgo, LOCAL_SCHEMA, LONG_RUNNER_DAYS, LONG_RUNNING_DAYS, MEDIA_LABEL, OUTPERFORM_MIN, outperformsBy, OWN_TOP_FILTER, passes, QUICK_FILTERS, rankAge, rankFits, SIGNALS_NOTE, summarizeAds, TYPE_GROUPS, typeGroup, viewFromQuery, viewToQuery, NETWORK_LABEL, PLACEMENT_LABEL, rankAds, SCRAPE_RULE, sizeLine, SOURCE_LABEL, staleReads, summarizeScrape,
  type AdDecoded, type AdFitFilter, type RankFit, type AdLibraryDetails, type AdMediaType, type AdScan, type AdSort, type AdView, type LaunchWindow, type TypeGroup, type CreativeMedia, type LocalScrape, type RankedAdRow, type ResearchAvatar, type ResearchBrand, type ResearchData, type Suggestion, type WatchRow,
} from "@/lib/research";
import { featureState, type FeatureState } from "@/lib/capabilities";
import { isAccountsMode } from "@/lib/install/types";
import { useInstall } from "@/lib/install/use-install";
import { HOOK_LABEL, ROLE_LABEL } from "@/lib/types";
import { buildWinnersHandoff, pickWinners, WINNER_KIND_LABEL, WINNERS_KEY, type WinnerKind } from "@/lib/winners";
import { ask, Facts, notice } from "./dialog";
import { PlaybookTips } from "./playbook-tip";
import { ResearchSkeleton } from "./page-skeletons";
import { RecreateAd } from "./research/recreate-ad";
import { MakeForApp } from "./research/make-for-app";
import { AdChanges, shortDate } from "./research/ad-changes";
import { FIT_SHORT, FitDot } from "./research/fit";
import { LockedNote } from "./research/gates";
import { IconCarousel, IconCheck, IconChevronDown, IconCopy, IconExternal, IconFile, IconImage, IconLayers, IconLock, IconPlay, IconVideo, IconWand, IconX } from "./icons";
import { ImportSafety, ScrapeSafetyCard } from "./research/scrape-safety";
import { PageDropOverlay, pickScrapeFiles, ScrapeDropZone, usePageFileDrop, type DropMessage } from "./research/scrape-drop";
import { copyImage, downloadFile, fileName, StaticActions, VideoBreakdown } from "./research/copy-ad";
import { PlacementIcons } from "./research/placement-icons";
import { StoredMediaCard } from "./research/stored-media";
import { CompetitorBoard } from "./research/competitor-board";
import { PageLogo } from "./research/page-logo";
import { ResearchInsights } from "./research/insights";
import { HowWeCompare } from "./research/how-we-compare";
import { PlacementSketch } from "./studio/placement-picker";
import { Badge, Button, buttonClass, Card, cx, EmptyState, ErrorNote, Field, inputClass, Page, segmentClass, segmentTrackClass, SettingsGroup, SettingsRow, Spinner, Stat } from "./ui";
import { ProductPageHeader } from "./workspace/product-header";
import { MODAL, MODAL_OVERLAY, PanelPortal } from "./panel-portal";
import { EXTENSION_GUIDE, EXTENSION_ZIP } from "@/lib/extension-download";
import { extensionWords } from "@/lib/extension-words";
import { COLLECTING_GUIDE, networksFound } from "@/lib/ad-sources";
import { repoFileUrl } from "@/lib/brand-config";
import { CollectAds, type CollectTarget } from "./research/collect-ads";
import { GetAds } from "./research/get-ads";
import { useT } from "@/lib/i18n/client";
import { sentenceGap } from "@/lib/i18n/join";
import { m } from "@/lib/i18n/translate";
import { rich } from "./rich";
import { adsRoute } from "@/lib/onboarding";
import { ReadingCostLine } from "./research/reading-cost";
import { changedIds, CompetitorIdFields, EMPTY_IDS, idsError, idsOf, type CompetitorIds } from "./research/competitor-ids";
import { researchHref } from "@/lib/nav-model";

const DAY_OPTIONS = [0, 7, LONG_RUNNING_DAYS, 60, 90];
/** Ad slices asked for at once after the first answer (each is ~600 ads, ~3 MB). */
const SLICE_CONCURRENCY = 4;
/** The creative types the filter always offers (Meta's display formats), before any others the ads have. */
const CREATIVE_TYPES: AdMediaType[] = ["video", "image", "carousel", "dco"];
/** Meta's platforms the filter always offers, before any others the ads have. */
const META_PLATFORMS = ["facebook", "instagram", "audience_network", "messenger", "threads"];
/** A filter chip: the app's tab pill (chosen = filled with a hairline, the rest plain muted text). */
const chipClass = (on: boolean) => segmentClass(on);
/** The filter bar's selects: one height and corner with the rest of the app's fields (30 px). */
const selectClass = "h-[30px] w-full min-w-0 rounded-control border border-hairline bg-raised px-2.5 text-sm text-ink outline-none transition-colors focus:border-focus/70 focus:ring-2 focus:ring-focus/20 @2xl:w-auto @2xl:max-w-48";
const checkClass = "flex h-7 items-center gap-2 text-sm text-label";
const codeClass = "rounded-xs bg-control px-1 py-px font-mono text-xs text-ink";
/** A known label in the page's language; a value the tables don't know (straight from the data) as it is. */
const lbl = (t: (text: string) => string, label: string | undefined, raw: string) => (label ? t(label) : raw);
/** A name for a button or a short title: a very long one is cut, so the button stays inside its dialog. */
const shortName = (name: string, max = 28) => (name.length > max ? `${name.slice(0, max - 1).trimEnd()}…` : name);
/** The fit filter's options: the AI scan's levels, then ads it hasn't checked. */
const FIT_FILTERS: { value: Exclude<AdFitFilter, "">; label: string }[] = [
  { value: "fits", label: FIT_SHORT.fits }, { value: "partly", label: FIT_SHORT.partly }, { value: "doesnt_fit", label: FIT_SHORT.doesnt_fit }, { value: "unchecked", label: m("Not checked") },
];
const fitOf = (ad: RankedAdRow): Exclude<AdFitFilter, ""> => ad.scan?.fit?.level ?? "unchecked";
/** Ads the background read hasn't reached yet (it skips ads with no copy, like the function's `unread`). */
const isUnread = (ad: Pick<RankedAdRow, "decoded" | "body" | "headline">) => !ad.decoded && Boolean(ad.body || ad.headline);
/** How often the list reloads while new ads are being read. */
const READ_REFRESH_MS = 45_000;
/** The video's spoken words from the AI scan, when it heard any. */
const heardLines = (ad: Pick<RankedAdRow, "scan">) => ad.scan?.video?.transcript?.filter((x) => x.text?.trim()).length ?? 0;

/** "The server answered 500.", in the page's language (the page sets it once it has mounted). */
let answered = (status: number) => `The server answered ${status}.`;

/** Posts JSON, gzipped when the browser can (an import batch is up to ~4 MB; Vercel caps bodies at 4.5 MB). */
async function upload<T = Record<string, unknown>>(url: string, json: string): Promise<T & { error?: string }> {
  let body: BodyInit = json;
  let type = "application/json";
  if (typeof CompressionStream !== "undefined") {
    body = await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream("gzip"))).blob();
    type = "application/gzip";
  }
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": type }, body });
  const data = await response.json().catch(() => ({ error: answered(response.status) }));
  if (!response.ok && !data.error) data.error = answered(response.status);
  return data;
}

async function post<T = Record<string, unknown>>(url: string, body: unknown, method = "POST"): Promise<T & { error?: string }> {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({ error: answered(response.status) }));
  if (!response.ok && !data.error) data.error = answered(response.status);
  return data;
}

export function ResearchAds({ productId }: { productId: string }) {
  const { t, tn, intl, locale } = useT();
  const gap = sentenceGap(locale);
  useEffect(() => { answered = (status) => t("The server answered {status}.", { status: String(status) }); }, [t]);
  const url = `/api/research/${productId}`;
  const [data, setData] = useState<ResearchData | null>(() => peek<ResearchData>(url) ?? null);
  // The list's view lives in the URL (?f=long&group=type…), so a view can be shared and survives a reload.
  const [filters, setFilters] = useState<AdView>(DEFAULT_VIEW);
  const [collapsed, setCollapsed] = useState<Set<TypeGroup>>(new Set());
  const restored = useRef(false);
  // `?competitors` opens the Competitors panel.
  const [showWatch, setShowWatch] = useState(false);
  useEffect(() => {
    const restore = async () => {
      setFilters(viewFromQuery(window.location.search));
      if (new URLSearchParams(window.location.search).has("competitors")) setShowWatch(true);
      restored.current = true;
    };
    restore();
  }, []);
  const closeWatch = () => {
    setShowWatch(false);
    const query = new URLSearchParams(window.location.search);
    if (!query.has("competitors")) return;
    query.delete("competitors");
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${query.size ? `?${query}` : ""}${window.location.hash}`);
  };
  useEffect(() => {
    if (!restored.current) return;
    const query = viewToQuery(filters, window.location.search).toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
  }, [filters]);
  const [open, setOpen] = useState<RankedAdRow | null>(null);
  // A card's "Make for <app>": the drawer opens with the Make sheet over it.
  const [makeOnOpen, setMakeOnOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  // Collect ads: the dialog for one competitor or all (components/research/collect-ads.tsx).
  const [collect, setCollect] = useState<CollectTarget | null>(null);
  // ?collect=1 (the first run, when a first collection could cost more than a little): the Collect dialog, which shows the cost first.
  useEffect(() => {
    const open = async () => {
      const query = new URLSearchParams(window.location.search);
      if (!query.has("collect")) return;
      setCollect({ ids: null, name: null });
      query.delete("collect");
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${query.size ? `?${query}` : ""}${window.location.hash}`);
    };
    open();
  }, []);
  // What needs a key says so instead of starting and failing. While the install loads nothing is locked
  // (and nothing that needs a key starts on its own).
  const { install, loading: installLoading } = useInstall();
  const lockedState = (feature: Parameters<typeof featureState>[0]): FeatureState | null => { const state = featureState(feature, install, null, { t, intl }); return state.ok ? null : state; };
  const aiLocked = lockedState("ai");
  const collectLocked = lockedState("research.collect");
  const metaApiLocked = lockedState("research.metaApi");
  // The "How to get ads in" section: open while this side has no ads, then as the person leaves it.
  const [sourcesOpen, setSourcesOpen] = useState<boolean | null>(null);
  // Competitors being deleted (watchlist ids): hidden from the page at once, gone for good when the delete ends.
  const [deleting, setDeleting] = useState<Set<string>>(new Set());
  /** A running import's progress: ads sent of the file's, and which file of several. */
  const [importing, setImporting] = useState<{ sent: number; total: number; file?: number; files?: number; name?: string } | null>(null);
  // Leaving mid-import stops it after the batch in flight: ask first.
  const importRunning = importing !== null;
  useEffect(() => {
    if (!importRunning) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [importRunning]);
  const fileInput = useRef<HTMLInputElement>(null);
  // An ads file can also be dropped: on the drop zone, or anywhere on the page.
  const [dropMessage, setDropMessage] = useState<DropMessage | null>(null);
  const dropZone = useRef<HTMLDivElement>(null);
  // "Show ads" on a competitor scrolls here.
  const adList = useRef<HTMLDivElement>(null);
  const fileOver = usePageFileDrop({ enabled: Boolean(data && !data.error) && busy !== "import", onFiles: (files) => takeFiles(files, "page") });

  // The first answer has everything and the first slice of ads; the rest come a slice at a time and show as they land.
  const loading = useRef(0);
  const load = useCallback(async () => {
    const run = ++loading.current;
    // A full list from before stays on screen while a refresh loads; a first visit fills in slice by slice.
    let cached = peek<ResearchData>(url);
    if (!cached) {
      // After a reload: the list kept from last time, at once (the fresh one replaces it when it's all in).
      const saved = await loadPersisted<ResearchData>(url);
      if (run !== loading.current) return null;
      if (saved && !peek(url)) { prime(url, saved); setData(saved); cached = saved; }
    }
    const progressive = !cached || cached.adsNext != null;
    let d = await refresh<ResearchData>(url).catch(() => null);
    if (!d || run !== loading.current) return d;
    if (progressive || d.adsNext == null) setData(d);
    const first = d.adsNext ?? null;
    if (first != null && d.adsTotal != null) {
      // Every remaining slice is known from the total: ask for them SLICE_CONCURRENCY at a time, show each as it lands.
      const starts: number[] = [];
      for (let from = first; from < d.adsTotal; from += first) starts.push(from);
      const parts = new Map<number, ResearchData["ads"]>();
      let failed = false;
      const worker = async () => {
        while (starts.length && !failed && run === loading.current) {
          const from = starts.shift() as number;
          const slice = await fetch(`${url}?adsFrom=${from}`, { cache: "no-store" }).then((r) => r.json() as Promise<Pick<ResearchData, "ads" | "adsNext">>).catch(() => null);
          if (!slice?.ads) { failed = true; return; }
          parts.set(from, slice.ads);
          if (run !== loading.current) return;
          const ads = [...d!.ads, ...[...parts.keys()].sort((a, b) => a - b).flatMap((k) => parts.get(k) ?? [])];
          const done = !starts.length && parts.size === Math.ceil((d!.adsTotal! - first) / first);
          if (progressive || done) setData({ ...d!, ads, adsNext: done ? null : d!.adsNext });
        }
      };
      await Promise.all(Array.from({ length: SLICE_CONCURRENCY }, worker));
      d = { ...d, ads: [...d.ads, ...[...parts.keys()].sort((a, b) => a - b).flatMap((k) => parts.get(k) ?? [])], adsNext: failed ? d.adsNext : null };
    } else {
      // An older server without the total: one slice after another.
      let next = first;
      while (next != null && run === loading.current) {
        const slice = await fetch(`${url}?adsFrom=${next}`, { cache: "no-store" }).then((r) => r.json() as Promise<Pick<ResearchData, "ads" | "adsNext">>).catch(() => null);
        if (!slice?.ads || run !== loading.current) break;
        d = { ...d, ads: [...d.ads, ...slice.ads], adsNext: slice.adsNext ?? null };
        if (progressive || d.adsNext == null) setData(d);
        next = slice.adsNext ?? null;
      }
    }
    if (run === loading.current && d.adsNext == null) { if (!progressive) setData(d); prime(url, d); void savePersisted(url, d); }
    return d;
  }, [url]);
  useEffect(() => {
    // A timer, not an animation frame: frames don't run in a tab opened in the background, and the page sat on its placeholder there.
    const timer = setTimeout(() => { void load(); }, 0);
    return () => { clearTimeout(timer); loading.current += 1; };
  }, [load]);

  // New ads are read in the background. The page asks once its ads are in (and after an import or a
  // pull); while ads are being read it reloads now and then to show them, and stops when none are left
  // or nothing moved for a few minutes (an ad that fails is tried again on a later visit).
  const unread = useMemo(() => (data?.ads ?? []).filter(isUnread).length, [data?.ads]);
  const [reading, setReading] = useState(false);
  const canRead = !installLoading && !aiLocked;
  const readNew = useCallback(async () => {
    if (!canRead) return setReading(false);
    const result = await post<{ pending?: number; running?: boolean }>(url, { action: "decode-new" }).catch(() => null);
    setReading(Boolean(result && !result.error && result.running && result.pending));
  }, [url, canRead]);
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current || !canRead || !data || data.error || data.adsNext != null || !unread) return;
    asked.current = true;
    void readNew();
  }, [data, unread, readNew, canRead]);
  useEffect(() => {
    if (!reading) return;
    let before = Infinity, still = 0;
    const timer = setInterval(async () => {
      const fresh = await load();
      if (!fresh?.ads) return;
      const left = fresh.ads.filter(isUnread).length;
      still = left < before ? 0 : still + 1;
      before = left;
      if (!left || still >= 4) setReading(false);
    }, READ_REFRESH_MS);
    return () => clearInterval(timer);
  }, [reading, load]);

  // While a pull runs, ask the backend to check on it every few seconds.
  const running = (data?.pulls ?? []).some((p) => p.status === "running");
  const polling = useRef(false);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(async () => {
      if (polling.current) return;
      polling.current = true;
      const result = await post<{ running?: number }>(url, { action: "poll" }).catch(() => null);
      polling.current = false;
      if (result && !result.error && !result.running) { await load(); void readNew(); }
    }, 6000);
    return () => clearInterval(timer);
  }, [running, url, load, readNew]);

  // Competitors' ads or ours: everything below works on one side at a time.
  const ours = filters.side === "ours";
  const allRanked = useMemo(() => {
    const gone = (data?.watchlist ?? []).filter((w) => deleting.has(w.id));
    const ads = gone.length ? (data?.ads ?? []).filter((ad) => !gone.some((w) => ad.watch_id === w.id || (w.page_id != null && ad.page_id === w.page_id))) : data?.ads ?? [];
    return rankAds(ads);
  }, [data?.ads, data?.watchlist, deleting]);
  const ranked = useMemo(() => allRanked.filter((ad) => Boolean(ad.is_own) === ours), [allRanked, ours]);
  // Each account's rank-against-age curve (its own once it has enough ranked ads): the cards' "outperforms its age" and our Top.
  const fits = useMemo(() => rankFits(allRanked), [allRanked]);
  const ownCount = useMemo(() => allRanked.filter((ad) => ad.is_own && ad.active).length, [allRanked]);
  const theirCount = useMemo(() => allRanked.filter((ad) => !ad.is_own && ad.active).length, [allRanked]);
  // The dropdown filters first; the chips (and their counts) work within that.
  const base = useMemo(() => ranked.filter((ad) =>
    (!filters.competitor || (ad.competitor ?? ad.page_name) === filters.competitor) &&
    (!filters.network || ad.network === filters.network) &&
    (!filters.placement || ad.placements.includes(filters.placement)) &&
    // "Video" also finds carousels and dynamic ads of videos.
    (!filters.media || ad.media_type === filters.media || (filters.media === "video" && Boolean(ad.is_video))) &&
    (!filters.minDays || (ad.days ?? 0) >= filters.minDays) &&
    inLaunchWindow(ad, filters.launched) &&
    matchesRead(ad, filters) &&
    (!filters.fit || fitOf(ad) === filters.fit)), [ranked, filters]);
  // The "Launched" counts: ads per launch day under the other dropdowns (not the days filters).
  const launchCounts = useMemo(() => {
    const ages = ranked.filter((ad) =>
      (!filters.competitor || (ad.competitor ?? ad.page_name) === filters.competitor) &&
      (!filters.network || ad.network === filters.network) &&
      (!filters.placement || ad.placements.includes(filters.placement)) &&
      (!filters.media || ad.media_type === filters.media || (filters.media === "video" && Boolean(ad.is_video))) &&
      matchesRead(ad, filters) &&
      (!filters.activeOnly || ad.active)).map((ad) => launchDaysAgo(ad));
    return new Map(LAUNCH_WINDOWS.map((w) => [w.id, ages.filter((a) => a != null && (w.id === "le2" ? a <= 2 : w.id === "le6" ? a <= 6 : a === Number(w.id))).length]));
  }, [ranked, filters]);
  // Cards render a page at a time; more come as you scroll, and the count resets when the filters change.
  const [limit, setLimit] = useState(CARDS_PAGE);
  const [limitFor, setLimitFor] = useState(filters);
  if (limitFor !== filters) { setLimitFor(filters); setLimit(CARDS_PAGE); }
  const shown = useMemo(() => {
    const matches = base.filter((ad) => (!filters.activeOnly || ad.active) && filters.quick.every((q) => passes(ad, q, undefined, fits)));
    // One per creative: the copy with a picture to show, when the group has one.
    const preview = new Map(matches.map((ad) => [ad.id, cardSources(ad).length > 0]));
    const pick = new Map<string, RankedAdRow>();
    for (const ad of matches) {
      if (!ad.creative_key) continue;
      const current = pick.get(ad.creative_key);
      if (!current || (!preview.get(current.id) && preview.get(ad.id))) pick.set(ad.creative_key, ad);
    }
    const grouped = filters.grouped ? matches.filter((ad) => !ad.creative_key || pick.get(ad.creative_key) === ad) : matches;
    const key: Record<AdSort, (ad: RankedAdRow) => number> = {
      score: (ad) => ad.score, days: (ad) => ad.days ?? 0, variants: (ad) => ad.groupSize,
      // Rank 1 first; ads without a rank (other sources) last.
      impressions: (ad) => (ad.impressions_rank ? -ad.impressions_rank : -1e9),
      newest: (ad) => (ad.started_at ? Date.parse(ad.started_at) : 0),
    };
    // Ads the Ad Library sent no media for (age-gated, withheld) go after the ones with a preview.
    return [...grouped].sort((a, b) => Number(preview.get(b.id)) - Number(preview.get(a.id)) || key[filters.sort](b) - key[filters.sort](a));
  }, [base, filters, fits]);

  if (!data) return <ResearchSkeleton />;
  if (data.error) return <Page><ProductPageHeader productId={productId} page="Research" /><ErrorNote>{data.error}</ErrorNote></Page>;

  const active = ranked.filter((ad) => ad.active);
  const preset = presetOf(filters);
  const advertisers: Record<string, string> = {};
  for (const ad of ranked) if (ad.page_id && !advertisers[ad.page_id]) advertisers[ad.page_id] = ad.competitor ?? ad.page_name;
  for (const w of data.watchlist) if (w.page_id) advertisers[w.page_id] = w.name;
  const options = (values: string[]) => [...new Set(values)].sort();

  /** Collect ads for every followed competitor: the dialog shows the sources and the cost first. */
  const pull = () => setCollect({ ids: null, name: null });
  // Which networks each competitor's ads came from, for its row on the board.
  const foundBy = new Map<string, { source: string }[]>();
  for (const ad of ranked) if (ad.watch_id) foundBy.set(ad.watch_id, [...(foundBy.get(ad.watch_id) ?? []), ad]);

  /**
   * Every way ads files come in (the picker, the drop zone, a drop anywhere on the page): one .json
   * gets its own preview and confirmation; several (one per competitor) get one confirmation for all.
   */
  function takeFiles(files: File[], from: "picker" | "zone" | "page") {
    if (!files.length) return;
    const { files: json, ignored } = pickScrapeFiles(files);
    if (!json.length) {
      setDropMessage({ tone: "error", text: from === "picker" ? t("That's not an ads file: choose the .json files the Ad Library extension saved.") : t("That's not an ads file: drop the .json files the Ad Library extension saved.") });
      // Dropped somewhere else on the page: bring the message into view.
      if (from === "page") dropZone.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      return;
    }
    if (json.length > 1) {
      setDropMessage(null);
      void importMany(json, ignored);
      return;
    }
    const skipped = ignored ? tn(ignored, "Importing {name}; {n} other file ignored (not .json).", "Importing {name}; {n} other files ignored (not .json).", { name: json[0].name }) : null;
    setDropMessage(skipped ? { tone: "note", text: skipped } : null);
    importLocal(json[0], skipped);
  }

  /** The watchlist row a file's advertiser already has (its Page id first, then its name). */
  function watchFor(s: ReturnType<typeof summarizeScrape>) {
    const watchlist = data?.watchlist ?? [];
    return (s.pageId ? watchlist.find((w) => w.network === "meta" && w.page_id === s.pageId) : undefined)
      ?? watchlist.find((w) => w.name.toLowerCase() === s.pageName.toLowerCase());
  }

  /**
   * The import pop-up's storage check: measures the files these ads would store (research `media-preview`)
   * and remembers its decisions under a hold id the import sends along. Shown in the corner while it runs.
   */
  async function checkStorage(ads: unknown[]): Promise<{ holdId: string | null; preview: MediaPreview | null; error: string | null }> {
    const files = scrapeMediaFiles(ads as { creative?: unknown }[]);
    if (!files.length) return { holdId: null, preview: null, error: null };
    const holdId = crypto.randomUUID();
    const task = `check:${holdId}`;
    startLocalTask({ id: task, label: t("Checking storage for the import"), productName: data?.workspace.name ?? null, done: null, total: null, detail: tn(files.length, "{n} file", "{n} files"), href: null });
    const result = await upload<MediaPreview>(`/api/research/${productId}/media-preview`, JSON.stringify({ holdId, files }));
    finishLocalTask(task, result.error ? { ok: false, detail: result.error } : { ok: true, detail: t("Checked") });
    return result.error ? { holdId: null, preview: null, error: result.error } : { holdId, preview: result, error: null };
  }

  /**
   * Several ads files at once, one per competitor: each is read and checked, one confirmation lists
   * them all (each can be left out, or marked as ours), then they're imported one after another. A new
   * advertiser joins the competitor list; two files of the same Page share its row.
   */
  async function importMany(files: File[], ignored: number) {
    type Entry = { file: File; parsed: LocalScrape; s: ReturnType<typeof summarizeScrape>; match?: WatchRow; own: boolean; take: boolean };
    const entries: Entry[] = [];
    const skipped: string[] = [];
    for (const file of files) {
      let parsed: LocalScrape;
      try { parsed = JSON.parse(await file.text()); } catch { skipped.push(t("{name}: not JSON", { name: file.name })); continue; }
      if (parsed?.schema !== LOCAL_SCHEMA || !Array.isArray(parsed.ads)) { skipped.push(t("{name}: not a file from the Ad Library extension", { name: file.name })); continue; }
      if (!parsed.ads.length) { skipped.push(t("{name}: no ads in it", { name: file.name })); continue; }
      const s = summarizeScrape(parsed);
      const match = watchFor(s);
      entries.push({ file, parsed, s, match, own: match ? Boolean(match.is_own) : ours, take: true });
    }
    if (ignored) skipped.push(tn(ignored, "{n} other file: not .json", "{n} other files: not .json"));
    if (!entries.length) {
      return notice(<>{t("None of these can be imported.")}<ul className="mt-2 list-disc pl-5">{skipped.map((x) => <li key={x}>{x}</li>)}</ul></>, t("Nothing to import"));
    }
    const totalAds = entries.reduce((n, e) => n + Math.min(e.s.ads, LOCAL_MAX_ADS), 0);
    const check = await checkStorage(entries.flatMap((e) => e.parsed.ads.slice(0, LOCAL_MAX_ADS)));
    const ok = await ask({
      title: tn(entries.length, "Import {n} advertiser", "Import {n} advertisers"),
      confirm: t("Import the checked files"),
      body: (
        <div className="grid gap-3 text-sm">
          <ul className="grid max-h-[46vh] divide-y divide-line overflow-y-auto overscroll-contain rounded-small border border-line">
            {entries.map((e) => {
              const count = Math.min(e.s.ads, LOCAL_MAX_ADS);
              const kinds = ([["video", m("{n} video")], ["image", m("{n} image")], ["carousel", m("{n} carousel")], ["dco", m("{n} dynamic")]] as const)
                .filter(([k]) => e.s.types[k]).map(([k, label]) => t(label, { n: e.s.types[k] })).join(" · ");
              return (
                <li key={e.file.name} className="flex items-start gap-3 bg-card px-3 py-2.5">
                  <input type="checkbox" defaultChecked aria-label={t("Import {name}", { name: e.s.pageName })} onChange={(ev) => { e.take = ev.target.checked; }} className="mt-1 size-4 shrink-0 accent-win" />
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <span className="truncate font-medium text-ink">{e.s.pageName}</span>
                    <span className="text-xs text-muted tabular-nums">{tn(count, "{n} ad", "{n} ads")} · {t("{n} live", { n: e.s.active })}{kinds ? ` · ${kinds}` : ""}</span>
                    <span className="text-xs text-muted">{e.match ? t("Goes with {name} on your list", { name: e.match.name }) : t("Joins your competitor list")}{!e.s.complete && <span className="text-caution-ink"> · {t("collection stopped early")}</span>}</span>
                  </span>
                  <select defaultValue={e.own ? "ours" : "theirs"} onChange={(ev) => { e.own = ev.target.value === "ours"; }} className="h-7 shrink-0 rounded-control border border-hairline bg-raised px-2 text-xs" aria-label={t("Whose ads: {name}", { name: e.s.pageName })}>
                    <option value="theirs">{t("Competitor")}</option><option value="ours">{t("Ours")}</option>
                  </select>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-muted">
            {tn(totalAds, "About {n} ad in all, imported one file after another: keep this tab open until it finishes. Their images and videos are saved to storage in the background.", "About {n} ads in all, imported one file after another: keep this tab open until it finishes. Their images and videos are saved to storage in the background.")}
            {gap}{t("Ads of a Page that were live here but aren't in its file are marked as stopped (unless its collection stopped early).")}
          </p>
          <ReadingCostLine ads={totalAds} install={install} upTo />
          {skipped.length > 0 && <p className="text-xs text-caution-ink">{t("Left out: {list}", { list: skipped.join(" · ") })}</p>}
          <StorageCheck preview={check.preview} error={check.error} />
        </div>
      ),
    });
    const chosen = entries.filter((e) => e.take);
    if (!ok || !chosen.length) return;
    setBusy("import");
    const task = `import:${crypto.randomUUID()}`;
    startLocalTask({ id: task, label: tn(chosen.length, "Importing {n} advertiser", "Importing {n} advertisers"), productName: data?.workspace.name ?? null, done: 0, total: null, href: `/app/w/${productId}/research` });
    const results: { name: string; ok: boolean; text: string }[] = [];
    // A Page whose row this run created: later files of the same Page go to that row.
    const created = new Map<string, string>();
    for (const [i, e] of chosen.entries()) {
      const plan = planImport(e.parsed);
      const progress = (sent: number, total: number) => {
        setImporting({ sent, total, file: i + 1, files: chosen.length, name: e.s.pageName });
        updateLocalTask(task, { done: sent, total, detail: t("{i} of {total} · {name}", { i: i + 1, total: chosen.length, name: e.s.pageName }) });
      };
      progress(0, plan.ads);
      const key = e.s.pageId ?? e.s.pageName.toLowerCase();
      const watchId = e.match?.id ?? created.get(key);
      const outcome = await runImport(plan, {
        importId: crypto.randomUUID(), watchId, createWatch: !watchId, own: e.own, holdId: check.holdId,
        send: (json) => upload<BatchAnswer>(`/api/research/${productId}/import-local`, json),
        onProgress: progress,
      });
      if (outcome.watchId && !watchId) created.set(key, outcome.watchId);
      const tot = outcome.totals;
      results.push(outcome.ok
        ? { name: e.s.pageName, ok: true, text: tot.retired
          ? tn(tot.ads, "{n} ad ({created} new, {updated} updated, {retired} stopped)", "{n} ads ({created} new, {updated} updated, {retired} stopped)", { created: tot.created, updated: tot.updated, retired: tot.retired })
          : tn(tot.ads, "{n} ad ({created} new, {updated} updated)", "{n} ads ({created} new, {updated} updated)", { created: tot.created, updated: tot.updated }) }
        : { name: e.s.pageName, ok: false, text: outcome.error });
    }
    setBusy(null);
    setImporting(null);
    const failed = results.filter((r) => !r.ok).length;
    finishLocalTask(task, failed ? { ok: false, detail: tn(failed, "{n} import stopped", "{n} imports stopped") } : { ok: true, detail: tn(results.length, "{n} advertiser imported", "{n} advertisers imported") });
    await load();
    void readNew();
    notice(
      <>
        <ul className="grid gap-1.5">
          {results.map((r) => <li key={r.name}><span className={cx("font-medium", r.ok ? "text-ink" : "text-warn")}>{r.name}</span>: {r.text}</li>)}
        </ul>
        <p className="mt-2 text-xs text-muted">{t("Pick a competitor above the ads to see theirs in Meta's impressions order.")}</p>
      </>,
      failed ? tn(failed, "{n} import stopped", "{n} imports stopped") : tn(results.length, "Imported {n} advertiser", "Imported {n} advertisers"),
    );
  }

  /**
   * Takes a competitor (or one of our Pages) off the list and deletes everything held for it, after
   * the user confirms. It's hidden at once and runs on with the dialog closed; the corner box shows it.
   */
  async function removeCompetitor(w: WatchRow) {
    const theirs = allRanked.filter((ad) => ad.watch_id === w.id || (w.page_id != null && ad.page_id === w.page_id));
    const ok = await ask({
      title: t("Delete {name} and all its data?", { name: w.name }),
      confirm: t("Delete {name}", { name: shortName(w.name) }),
      danger: true,
      body: <Facts rows={[
        [t("Ads"), t("{n} ({live} live)", { n: theirs.length, live: theirs.filter((ad) => ad.active).length })],
        [t("Also deleted"), t("their stored images and videos, scans, edit history and import history")],
      ]} note={<>{w.is_own ? t("It comes off the list.") : t("It comes off the list, and creative checks stop looking for this name.")}{gap}{t("This can't be undone: to follow it again, add it and collect its ads again. To keep its data and only stop updating it, use Pause following instead.")}</>} />,
    });
    if (!ok) return;
    const task = `delete:${w.id}`;
    setDeleting((d) => new Set(d).add(w.id));
    startLocalTask({ id: task, label: t("Deleting {name}", { name: shortName(w.name, 40) }), productName: data?.workspace.name ?? null, done: null, total: null, detail: tn(theirs.length, "{n} ad and their files", "{n} ads and their files"), href: `/app/w/${productId}/research` });
    const result = await post<{ ads?: number; files?: number }>(`/api/research/${productId}/watch?id=${w.id}`, {}, "DELETE");
    finishLocalTask(task, result.error ? { ok: false, detail: result.error } : { ok: true, detail: t("{ads} and {files} deleted", { ads: tn(result.ads ?? 0, "{n} ad", "{n} ads"), files: tn(result.files ?? 0, "{n} file", "{n} files") }) });
    await load();
    setDeleting((d) => { const next = new Set(d); next.delete(w.id); return next; });
    if (result.error) notice(result.error, t("Couldn't delete {name}", { name: shortName(w.name, 40) }));
  }

  /** Reads an ads file, shows what's in it, and imports it after the user confirms. */
  async function importLocal(file: File, skipped: string | null = null) {
    let parsed: LocalScrape;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      return notice(t("That file isn't JSON. Pick a .json file the Ad Library extension saved."), t("Can't read the file"));
    }
    if (parsed?.schema !== LOCAL_SCHEMA || !Array.isArray(parsed.ads)) {
      return notice(<>{t("That isn't a file from the Ad Library extension. Drop the .json file it saved in Downloads/Ad Library, unchanged.")}{gap}<Link href={EXTENSION_GUIDE} className="text-accent hover:underline">{t("How the extension works")}</Link></>, t("Not an ads file"));
    }
    if (!parsed.ads.length) return notice(t("The file has no ads. Check the Ad Library page and collect again."), t("Nothing to import"));
    const s = summarizeScrape(parsed);
    const match = watchFor(s);
    const options = { createWatch: true, own: match ? Boolean(match.is_own) : ours };
    const count = Math.min(s.ads, LOCAL_MAX_ADS);
    const cut = s.ads > LOCAL_MAX_ADS;
    const mediaFiles = scrapeMediaCount(parsed.ads.slice(0, LOCAL_MAX_ADS) as { creative?: unknown }[]);
    const check = await checkStorage(parsed.ads.slice(0, LOCAL_MAX_ADS));
    const types = ([["video", m("Video {n}")], ["image", m("Image {n}")], ["carousel", m("Carousel {n}")], ["dco", m("Dynamic {n}")], ["other", m("Other {n}")]] as const)
      .filter(([key]) => s.types[key]).map(([key, label]) => t(label, { n: s.types[key] })).join(" · ");
    const ok = await ask({
      title: t("Import {name}'s ads", { name: shortName(s.pageName, 60) }),
      confirm: tn(count, "Import {n} ad", "Import {n} ads"),
      body: (
        <>
        <Facts
          rows={[
            [t("Advertiser"), <>{s.pageName}{s.pageId && <span className="block text-xs font-normal text-muted">{t("Page {id}", { id: s.pageId })}</span>}</>],
            [t("Ads"), cut ? t("{n} (the first {max} are imported)", { n: s.ads, max: LOCAL_MAX_ADS }) : s.ads.toLocaleString(intl)],
            [t("Live"), s.active.toLocaleString(intl)],
            [t("Media to store"), check.preview ? `${tn(check.preview.new.files, "{n} new file", "{n} new files")} (${formatBytes(check.preview.new.bytes)})${check.preview.stored ? ` · ${t("{n} already stored", { n: check.preview.stored })}` : ""}` : mediaFiles ? tn(mediaFiles, "About {n} image and video file", "About {n} image and video files") : "–"],
            [t("Creative types"), types || "–"],
            [t("Collected"), s.scrapedAt ? new Date(s.scrapedAt).toLocaleString(intl) : "–"],
            [t("Collection"), s.complete ? t("Complete") : <span className="text-caution-ink">{s.stoppedReason ? t("Stopped early: {reason}", { reason: s.stoppedReason }) : t("Stopped early")}</span>],
          ]}
          note={<>
            <span className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-ink">
              <span className="text-muted">{t("Whose ads are these?")}</span>
              <label className="flex items-center gap-2"><input type="radio" name="whose" defaultChecked={!options.own} onChange={() => { options.own = false; }} className="accent-ink" />{t("A competitor's")}</label>
              <label className="flex items-center gap-2"><input type="radio" name="whose" defaultChecked={options.own} onChange={() => { options.own = true; }} className="accent-ink" />{t("Ours")}</label>
            </span>
            {match
              ? rich(t("Goes with {name} on your competitor list."), { name: <span className="text-ink">{match.name}</span> })
              : <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" defaultChecked className="size-4 accent-win" onChange={(e) => { options.createWatch = e.target.checked; }} />{t("Add {name} to the competitor list", { name: s.pageName })}</label>}
            {skipped && <span className="mt-2 block text-caution-ink">{skipped}</span>}
            <span className="mt-2 block">{!s.complete
              ? t("The collection stopped early, so no ads are marked as stopped.")
              : cut ? t("Only the first {max} ads are imported, so no ads are marked as stopped.", { max: LOCAL_MAX_ADS })
              : t("Ads of this Page that were live here but aren't in the file are marked as stopped.")}</span>
            {mediaFiles > 0 && <span className="mt-2 block">{t("Their images and videos are saved to storage in the background so they don't expire.")}</span>}
            <ReadingCostLine ads={count} install={install} upTo inline className="mt-2 block" />
            {count > IMPORT_BATCH_ADS && <span className="mt-2 block">{t("The ads go up in parts of up to {n}: keep this tab open until the import finishes.", { n: IMPORT_BATCH_ADS })}</span>}
          </>}
        />
        <StorageCheck preview={check.preview} error={check.error} />
        <ImportSafety file={parsed} />
        </>
      ),
    });
    if (!ok) return;
    if (options.own !== ours) setFilters({ ...filters, side: options.own ? "ours" : "competitors" });
    setBusy("import");
    const plan = planImport(parsed);
    setImporting({ sent: 0, total: plan.ads });
    const task = `import:${crypto.randomUUID()}`;
    startLocalTask({ id: task, label: t("Importing {name}", { name: shortName(s.pageName, 40) }), productName: data?.workspace.name ?? null, done: 0, total: plan.ads, href: `/app/w/${productId}/research` });
    const outcome = await runImport(plan, {
      importId: crypto.randomUUID(), watchId: match?.id, createWatch: !match && options.createWatch, own: options.own, holdId: check.holdId,
      send: (json) => upload<BatchAnswer>(`/api/research/${productId}/import-local`, json),
      onProgress: (sent, total) => { setImporting({ sent, total }); updateLocalTask(task, { done: sent, total }); },
    });
    setBusy(null);
    setImporting(null);
    finishLocalTask(task, outcome.ok ? { ok: true, detail: tn(outcome.totals.ads, "{n} ad saved", "{n} ads saved") } : { ok: false, detail: outcome.error });
    const tot = outcome.totals;
    // Batches before a failed one are saved: show them either way.
    await load();
    void readNew();
    if (!outcome.ok) return notice(outcome.error, t("The import stopped"));
    notice(
      <>
        {options.own
          ? tn(tot.ads, "Saved {n} ad from {name} to Our ads: {created} new, {updated} updated.", "Saved {n} ads from {name} to Our ads: {created} new, {updated} updated.", { name: s.pageName, created: tot.created, updated: tot.updated })
          : tn(tot.ads, "Saved {n} ad from {name} to Competitors' ads: {created} new, {updated} updated.", "Saved {n} ads from {name} to Competitors' ads: {created} new, {updated} updated.", { name: s.pageName, created: tot.created, updated: tot.updated })}
        {tot.retired ? <>{gap}{tn(tot.retired, "{n} ad no longer in the Ad Library marked as stopped.", "{n} ads no longer in the Ad Library marked as stopped.")}</> : null}
        {tot.watchCreated ? <>{gap}{t("{name} is on your competitor list now.", { name: s.pageName })}</> : null}
        {tot.mediaQueued ? <>{gap}{tot.mediaStored
          ? tn(tot.mediaQueued, "Saving {n} image and video file to storage in the background ({stored} already saved).", "Saving {n} image and video files to storage in the background ({stored} already saved).", { stored: tot.mediaStored })
          : tn(tot.mediaQueued, "Saving {n} image and video file to storage in the background.", "Saving {n} image and video files to storage in the background.")}</> : null}
        {tot.mediaError ? <>{gap}{t("Their images and videos couldn't be queued for storage: {error}", { error: tot.mediaError })}</> : null}
        {tot.edited ? <>{gap}{tn(tot.edited, "{n} ad was edited since the last import (see Changes on each).", "{n} ads were edited since the last import (see Changes on each).")}</> : null}
      </>,
      t("Imported"),
    );
  }

  /** Reads one ad again (the drawer's "Read again"); `quiet` after a scan, which shows no error. */
  async function readAgain(ad: { id: string }, quiet = false) {
    if (!quiet) setBusy(`decode:${ad.id}`);
    const result = await post<{ decoded?: AdDecoded; decodedAt?: string }>(`/api/research/ads/${ad.id}`, { action: "decode" });
    if (!quiet) setBusy(null);
    if (result.error || !result.decoded) return quiet ? undefined : notice(result.error ?? t("The ad couldn't be read."));
    const decoded = result.decoded, decodedAt = result.decodedAt ?? new Date().toISOString();
    setData((d) => d && { ...d, ads: d.ads.map((a) => (a.id === ad.id ? { ...a, decoded, decoded_at: decodedAt } : a)) });
    setOpen((o) => (o?.id === ad.id ? { ...o, decoded, decoded_at: decodedAt } : o));
  }

  async function send(ad: RankedAdRow) {
    setBusy(`send:${ad.id}`);
    const result = await post<{ sentAt?: string }>(`/api/research/ads/${ad.id}`, { action: "send" });
    setBusy(null);
    if (result.error) return notice(result.error);
    setData((d) => d && { ...d, ads: d.ads.map((a) => (a.id === ad.id ? { ...a, sent_to_library_at: result.sentAt ?? new Date().toISOString() } : a)) });
    if (open?.id === ad.id) setOpen({ ...ad, sent_to_library_at: result.sentAt ?? new Date().toISOString() });
  }

  /** Keeps an image uploaded in the Recreate sheet, so reopening it shows the image. */
  function assetAdded(asset: ProductAsset) {
    setData((d) => d && { ...d, assets: [asset, ...(d.assets ?? []).filter((a) => a.id !== asset.id)] });
  }

  /** Keeps a fresh AI scan on the ad, so reopening the Recreate sheet shows it. */
  function scanned(id: string, scan: AdScan, scannedAt: string) {
    setData((d) => d && { ...d, ads: d.ads.map((a) => (a.id === id ? { ...a, scan, scanned_at: scannedAt } : a)) });
    setOpen((o) => (o?.id === id ? { ...o, scan, scanned_at: scannedAt } : o));
    // The scan heard the video: read the ad again from what's said, not only its copy.
    const ad = data?.ads.find((a) => a.id === id);
    if (ad && heardLines({ scan }) && ad.decoded?.source !== "transcript") void readAgain(ad, true);
  }

  const importCount = importing && importing.total > IMPORT_BATCH_ADS ? t("{sent} of {total}…", { sent: importing.sent, total: importing.total }) : "…";
  const importText = !importing ? t("Importing…")
    : importing.files && importing.files > 1 ? t("{file} of {files} · {name}: {progress}", { file: importing.file ?? 1, files: importing.files, name: importing.name ?? "", progress: importCount })
    : t("Importing {progress}", { progress: importCount });
  const health = data.health;
  // Which collectors are on: from the install's keys, or from the backend when the install can't be read.
  const collectOn = install ? !collectLocked : Boolean(health?.apify);
  const metaApiOn = install ? !metaApiLocked : Boolean(health?.metaApi);
  const tiktokOn = Boolean(health?.tiktok && health.tiktok !== "off");
  const sideWatch = data.watchlist.filter((w) => Boolean(w.is_own) === ours);
  // The link on a competitor says "Open" with a saved Page and "Search" without one: the steps name what's there.
  const metaWatch = sideWatch.filter((w) => w.network === "meta");
  const openWord = metaWatch.length && metaWatch.every((w) => !w.page_id) ? t("Search") : metaWatch.some((w) => !w.page_id) ? t("Open or Search") : t("Open");
  const showGetAds = !ours && ranked.length === 0;
  return (
    <Page>
      <ProductPageHeader productId={productId} page="Research" name={data.workspace.name}
        subtitle={ours
          ? t("Your own live ads from the Ad Library, read the same way: how long each has run, how many copies are live, its format and hook, side by side with your competitors'.")
          : t("Paid ads your competitors are running now. The longer an ad runs and the more copies of it are live, the more likely it's working. Each new ad is read for its format, hook and structure on its own.")}
        actions={<>
          <Button variant="secondary" onClick={() => fileInput.current?.click()} disabled={busy === "import"}>{busy === "import" ? <><Spinner /> {importText}</> : t("Import files")}</Button>
          <input ref={fileInput} type="file" multiple accept=".json,application/json" className="hidden" onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            takeFiles(files, "picker");
          }} />
          <Button variant="secondary" onClick={pull} disabled={running} title={t("Collects every followed competitor with the sources that are on. You see which sources and the most it can cost first")}>
            {running ? <><Spinner /> {t("Collecting…")}</> : t("Collect ads")}
          </Button>
        </>} />
      <div className={cx(segmentTrackClass, "mb-4")} role="tablist" aria-label={t("Whose ads")}>
        <button type="button" role="tab" aria-selected={!ours} onClick={() => setFilters({ ...DEFAULT_VIEW, side: "competitors" })} className={segmentClass(!ours)}>{t("Competitors' ads")} <span className="ml-1 text-xs text-muted tabular-nums">{theirCount}</span></button>
        <button type="button" role="tab" aria-selected={ours} onClick={() => setFilters({ ...DEFAULT_VIEW, side: "ours" })} className={segmentClass(ours)}>{t("Our ads")} <span className="ml-1 text-xs text-muted tabular-nums">{ownCount}</span></button>
      </div>

      {/* No competitor ads yet: the best way to get them in, picked by itself (research/get-ads.tsx). */}
      {showGetAds && (
        <GetAds route={adsRoute({ collect: collectOn, metaApi: metaApiOn })} watchlist={sideWatch.filter((w) => !deleting.has(w.id))} running={running}
          onCollect={(ids) => setCollect({ ids, name: null })} onAddCompetitor={() => setShowWatch(true)}
          dropZone={<ScrapeDropZone ours={ours} onFiles={(files) => takeFiles(files, "zone")} onChoose={() => fileInput.current?.click()} busy={busy === "import"} busyText={importText} message={dropMessage} />} />
      )}
      <div ref={dropZone} className="scroll-mt-14">
        <CompetitorBoard productId={productId} watchlist={sideWatch.filter((w) => !deleting.has(w.id))} ads={ranked} lastImports={data.lastImports ?? {}} ours={ours}
          onManage={() => setShowWatch(true)}
          onAdd={async (name, pageId) => {
            const result = await post(`/api/research/${productId}/watch`, { name, page: pageId, own: ours }).catch(() => ({ error: t("Couldn't reach the server. Try again.") }));
            if (result.error) return notice(result.error, t("Couldn't add {name}", { name: shortName(name, 40) }));
            await load();
          }}
          onFollow={async (w) => {
            const result = await post(`/api/research/${productId}/watch?id=${w.id}`, { enabled: true }, "PATCH").catch(() => ({ error: t("Couldn't reach the server. Try again.") }));
            if (result.error) return notice(result.error, t("Couldn't follow {name}", { name: shortName(w.name, 40) }));
            await load();
          }}
          sourcesOf={(w) => networksFound(foundBy.get(w.id) ?? [])}
          onCollect={(w) => setCollect({ ids: [w.id], name: w.name })}
          onShowAds={(competitor) => {
            setFilters({ ...filters, competitor });
            requestAnimationFrame(() => adList.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
          }}
          dropZone={showGetAds ? null : <ScrapeDropZone ours={ours} onFiles={(files) => takeFiles(files, "zone")} onChoose={() => fileInput.current?.click()} busy={busy === "import"} busyText={importText} message={dropMessage} />} />
      </div>
      <PageDropOverlay shown={fileOver} />
      <ScrapeSafetyCard productId={productId} runs={data.localRuns ?? []} className="mb-4" />
      {!health && <p className="mb-3 text-xs text-muted" role="status">{t("The collectors couldn't be checked just now. Importing files works as usual; reload to check again.")}</p>}

      <details className="group mb-5" open={sourcesOpen ?? (ranked.length === 0 && !showGetAds)} onToggle={(e) => setSourcesOpen(e.currentTarget.open)}>
        <summary className="w-fit cursor-pointer list-none rounded-xs text-xs text-muted hover:text-ink">{t("How to get ads in, and stored media")} <span aria-hidden className="inline-block transition-transform group-open:rotate-90">›</span></summary>
        <div className="mt-3 grid gap-3">
          <SettingsGroup>
            <SettingsRow label={<span className="flex flex-wrap items-center gap-2">{t("The Ad Library extension")} <Badge tone="win">{t("Free, no key")}</Badge></span>}
              description={ours ? t("A Chrome extension that saves a Page's ads, with their media and Meta's impressions order, as a file you drop on this page.") : t("A Chrome extension that saves each competitor's ads, with their media and Meta's impressions order, as a file you drop on this page.")}
              below={(
                // The Ad Library extension: the short path here, every step with pictures in Settings (EXTENSION_GUIDE).
                <ol className="mt-2.5 ml-4 list-decimal space-y-1 text-sm text-muted">
                  <li>{rich(t("Install it once: {guide} shows each click, from unzipping to pinning it in Chrome."), { guide: <Link href={EXTENSION_GUIDE} className="font-medium text-accent hover:underline">{t("the step-by-step guide")}</Link> })}</li>
                  {/* {collect} is the extension's own button, in the words the extension shows (lib/extension-words.ts). */}
                  <li>{rich(metaWatch.length
                    ? ours
                      ? t("Click {open} on one of your Pages above (it opens the Ad Library in a new tab), then click the extension's orange icon and {collect}.")
                      : t("Click {open} on a competitor above (it opens the Ad Library in a new tab), then click the extension's orange icon and {collect}.")
                    : ours
                      ? t("Add your Facebook Page above, then click {open} on it (it opens the Ad Library in a new tab), then click the extension's orange icon and {collect}.")
                      : t("Add a competitor above, then click {open} on it (it opens the Ad Library in a new tab), then click the extension's orange icon and {collect}."), {
                    open: <span className="font-medium text-label">{metaWatch.length ? openWord : t("Open")}</span>,
                    collect: <span className="font-medium text-label">{extensionWords(locale).collectAds}</span>,
                  })}</li>
                  <li>{rich(t("Drop the file it saves in {folder} anywhere on this page."), { folder: <code className={codeClass}>Downloads/Ad Library</code> })}</li>
                </ol>
              )}>
              <Link href={EXTENSION_GUIDE} className={buttonClass("secondary", "sm")}>{t("Get the free extension")}</Link>
              <a href={EXTENSION_ZIP} download className={buttonClass("ghost", "sm")}>{t("Download")}</a>
            </SettingsRow>
            <SettingsRow label={t("Automatic collection")}
              description={<>{t("Meta and Google ads in any country, and TikTok ads shown in Europe, with your own keys. Billed per ad by Apify; you see the sources and the most it can cost before each collection.")}{gap}<Link href="/app/settings/research" className="font-medium text-accent hover:underline">{t("Choose the sources in Settings › Research sources.")}</Link></>}>
              {collectLocked ? <LockedNote state={collectLocked}>{t("Needs {keys}", { keys: collectLocked.missingKeys.join(" + ") })}</LockedNote> : collectOn ? <Badge tone="win">{t("On")}</Badge> : <Badge>{t("Off")}</Badge>}
            </SettingsRow>
            <SettingsRow label={t("Meta's Ad Library API")} description={t("Free. Covers ads shown in the EU and the UK only, so it adds to the two ways above.")}>
              {metaApiLocked ? <LockedNote state={metaApiLocked}>{t("Needs {keys}", { keys: metaApiLocked.missingKeys.join(" + ") })}</LockedNote> : metaApiOn ? <Badge tone="win">{t("On")}</Badge> : <Badge>{t("Off")}</Badge>}
            </SettingsRow>
            {tiktokOn && <SettingsRow label={t("TikTok ads")} description={health?.tiktok === "library" ? t("From TikTok's ad library (ads shown in the EU and the UK).") : t("From TikTok's Top Ads.")}><Badge tone="win">{t("On")}</Badge></SettingsRow>}
          </SettingsGroup>
          <div className="grid gap-2 text-xs text-muted">
            {data.pulls.length > 0 && (
              <p>
                {t("Last import or pull {when}", { when: new Date(data.pulls[0].started_at).toLocaleString(intl) })} · {lbl(t, SOURCE_LABEL[data.pulls[0].source], data.pulls[0].source)} · {data.pulls[0].status === "running" ? t("running") : data.pulls[0].status === "error" ? <span className="text-warn">{data.pulls[0].error}</span> : tn(data.pulls[0].ads, "{n} ad", "{n} ads")}
              </p>
            )}
            <p>{t(SCRAPE_RULE)}</p>
            <p><a href={repoFileUrl(COLLECTING_GUIDE)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-accent hover:underline">{t("Guide: the three ways to get competitors' ads")}<IconExternal className="size-3" /></a></p>
          </div>
          <StoredMediaCard productId={productId} status={data.mediaStatus} advertisers={advertisers} onChanged={load} />
          <PlaybookTips ids={["proven-market", "copy-why-not-assets"]} />
        </div>
      </details>

      {collect && <CollectAds productId={productId} target={collect} install={install} pulls={data.pulls} onClose={() => setCollect(null)} onPulled={() => { void load().then(() => readNew()); }} />}
      {showWatch && <Watchlist productId={productId} watchlist={sideWatch} deleting={deleting} suggestions={ours ? [] : data.suggestions} own={ours} tiktok={tiktokOn} metaApi={metaApiOn} collect={collectOn} onChange={load} onRemove={removeCompetitor} onClose={closeWatch} />}

      {reading && unread > 0 && (
        <p className="mb-3 flex items-center gap-2 text-xs text-muted" role="status"><Spinner />{tn(unread, "Reading {n} new ad: format, hook and what each line does. They fill in as they're read.", "Reading {n} new ads: format, hook and what each line does. They fill in as they're read.")}</p>
      )}
      {aiLocked && unread > 0 && (
        <LockedNote state={aiLocked} className="mb-3">{tn(unread, "{n} ad not read yet for format, hook and structure: reading needs {keys}. The rest of this page works without it.", "{n} ads not read yet for format, hook and structure: reading needs {keys}. The rest of this page works without it.", { keys: aiLocked.missingKeys.join(" + ") })}</LockedNote>
      )}

      {ours && (
        <HowWeCompare ours={ranked} theirs={allRanked.filter((ad) => !ad.is_own)}
          onTheirExamples={(read) => {
            setFilters({ ...DEFAULT_VIEW, side: "competitors", quick: ["long"], format: read.format ?? "", hook: read.hook ?? "" });
            requestAnimationFrame(() => adList.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
          }}
          onRefresh={() => {
            const refresh = presetsFor("ours").find((p) => p.id === "refresh");
            if (refresh) setFilters(applyPreset(filters, refresh));
            requestAnimationFrame(() => adList.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
          }} />
      )}
      <ResearchInsights ads={ranked} competitor={filters.competitor} ours={ours} onPick={(competitor) => {
        setFilters({ ...filters, competitor });
        if (competitor) requestAnimationFrame(() => adList.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
      }} />

      <Card ref={adList} className="mb-4 grid scroll-mt-14 grid-cols-2 gap-px overflow-hidden bg-line @3xl:grid-cols-4">
        <Stat label={t("Live ads")} value={active.length} hint={t("{n} tracked", { n: ranked.length })} />
        <Stat label={t("Running {n}+ days", { n: LONG_RUNNING_DAYS })} value={active.filter((ad) => (ad.days ?? 0) >= LONG_RUNNING_DAYS).length} hint={t("likely profitable")} />
        <Stat label={t("Scaled creatives")} value={new Set(active.filter((ad) => ad.groupSize >= 3).map((ad) => ad.creative_key)).size} hint={t("3+ live copies")} />
        <Stat label={ours ? t("Pages") : t("Advertising")} value={new Set(active.map((ad) => ad.competitor ?? ad.page_name)).size} hint={ours ? t("of ours") : t("competitors")} />
      </Card>

      {ranked.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5" role="group" aria-label={t("Quick views")}>
          <span className="eyebrow mr-1">{t("Quick views")}</span>
          {presetsFor(filters.side).map((p) => {
            const on = preset === p.id;
            return (
              <button key={p.id} type="button" title={t(p.title)} aria-pressed={on} className={chipClass(on)}
                onClick={() => setFilters(on ? { ...DEFAULT_VIEW, side: filters.side, competitor: filters.competitor } : applyPreset(filters, p))}>{t(p.label)}</button>
            );
          })}
          {(filters.format || filters.hook) && (
            <span className="ml-1 flex flex-wrap items-center gap-1.5">
              {filters.format && <button type="button" className={chipClass(true)} onClick={() => setFilters({ ...filters, format: "" })} title={t("Clear the format")}>{t("Format: {name}", { name: lbl(t, AD_FORMAT_LABEL[filters.format], filters.format) })}<IconX className="size-3" /></button>}
              {filters.hook && <button type="button" className={chipClass(true)} onClick={() => setFilters({ ...filters, hook: "" })} title={t("Clear the hook")}>{t("Hook: {name}", { name: lbl(t, HOOK_LABEL[filters.hook], filters.hook) })}<IconX className="size-3" /></button>}
            </span>
          )}
        </div>
      )}
      {ranked.length > 0 && (
        <AdvertiserSwitcher ads={ranked} activeOnly={filters.activeOnly} value={filters.competitor} media={filters.media} sort={filters.sort} ours={ours}
          onPick={(competitor) => setFilters({ ...filters, competitor })}
          onMedia={(media) => setFilters({ ...filters, media, sort: media && filters.sort === "score" ? "impressions" : filters.sort })} />
      )}
      {ranked.length > 0 && (
        <Card className="mb-4 grid gap-3 p-3">
          <div className="grid grid-cols-2 gap-3 @2xl:flex @2xl:flex-wrap @2xl:items-end">
            <Select label={t("Network")} value={filters.network} onChange={(v) => setFilters({ ...filters, network: v })} values={options(ranked.map((ad) => ad.network))} name={(v) => lbl(t, NETWORK_LABEL[v as "meta"], v)} />
            <Select label={t("Platform")} value={filters.placement} onChange={(v) => setFilters({ ...filters, placement: v })} values={[...META_PLATFORMS, ...options(ranked.flatMap((ad) => ad.placements)).filter((v) => !META_PLATFORMS.includes(v))]} name={(v) => lbl(t, PLACEMENT_LABEL[v], v)} />
            <Select label={t("Creative type")} value={filters.media} onChange={(v) => setFilters({ ...filters, media: v })} values={[...CREATIVE_TYPES, ...options(ranked.map((ad) => ad.media_type)).filter((v) => !CREATIVE_TYPES.includes(v as AdMediaType))]} name={(v) => lbl(t, MEDIA_LABEL[v as AdMediaType], v)} />
            <label className="flex min-w-0 flex-col gap-1.5 text-xs text-muted">{t("Running")}
              <select value={filters.minDays} onChange={(e) => setFilters({ ...filters, minDays: Number(e.target.value), launched: "" })} className={selectClass}>
                {[...new Set([...DAY_OPTIONS, filters.minDays])].sort((a, b) => a - b).map((d) => <option key={d} value={d}>{d ? t("{n}+ days", { n: d }) : t("Any time")}</option>)}
              </select>
            </label>
            <label className="flex min-w-0 flex-col gap-1.5 text-xs text-muted" title={t("New ads by the day they started running (the Ad Library's start date)")}>{t("Launched")}
              <select value={filters.launched} onChange={(e) => {
                const launched = e.target.value as LaunchWindow;
                setFilters({ ...filters, launched, minDays: launched ? 0 : filters.minDays, sort: launched && filters.sort === "score" ? "newest" : filters.sort });
              }} className={selectClass}>
                <option value="">{t("Any day")}</option>
                {LAUNCH_WINDOWS.map((w) => <option key={w.id} value={w.id}>{t(w.label)} ({(launchCounts.get(w.id) ?? 0).toLocaleString(intl)})</option>)}
              </select>
            </label>
            <label className="flex min-w-0 flex-col gap-1.5 text-xs text-muted" title={t("Whether the AI scan found the ad fits what you sell: advice only")}>{t("Fit")}
              <select value={filters.fit} onChange={(e) => setFilters({ ...filters, fit: e.target.value as AdFitFilter })} className={selectClass}>
                <option value="">{t("All")}</option>
                {FIT_FILTERS.map((f) => <option key={f.value} value={f.value}>{t(f.label)}</option>)}
              </select>
            </label>
            <label className="flex min-w-0 flex-col gap-1.5 text-xs text-muted">{t("Sort by")}
              <select value={filters.sort} onChange={(e) => setFilters({ ...filters, sort: e.target.value as AdSort })} className={selectClass}>
                <option value="score">{t("Strongest")}</option>
                <option value="impressions" title={t("The order under Meta's \"total impressions\" sort when the ads were collected; ranks compare within one advertiser")}>{t("Meta's impressions order")}</option>
                <option value="days">{t("Days running")}</option><option value="variants">{t("Variants")}</option><option value="newest">{t("Newest")}</option>
              </select>
            </label>
            <div className="col-span-2 flex flex-wrap gap-x-5 @2xl:ml-auto">
              <label className={checkClass}><input type="checkbox" checked={filters.byType} onChange={(e) => setFilters({ ...filters, byType: e.target.checked })} className="size-4 accent-win" />{t("Group by creative type")}</label>
              <label className={checkClass}><input type="checkbox" checked={filters.grouped} onChange={(e) => setFilters({ ...filters, grouped: e.target.checked })} className="size-4 accent-win" />{t("One per creative")}</label>
            </div>
          </div>
          <div className="grid gap-2 border-t border-line pt-3">
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("Quick filters")}>
              {QUICK_FILTERS.map((quick) => {
                // Our own ads' Top is judged against age (nothing is ever paused there, so old ads lead Meta's order).
                const q = ours && quick.id === "top" ? { ...quick, ...OWN_TOP_FILTER } : quick;
                const on = filters.quick.includes(q.id);
                // A stopped-ads filter turns "Active only" off when picked, so its count leaves that out too.
                const count = base.filter((ad) => (!filters.activeOnly || STOPPED_FILTERS.includes(q.id) || ad.active) && passes(ad, q.id, undefined, fits)).length;
                return (
                  <button key={q.id} type="button" title={t(q.title)} aria-pressed={on} className={chipClass(on)}
                    // A stopped-ads filter can't match with "Active only" on: turning one on turns that off.
                    onClick={() => setFilters({ ...filters, quick: on ? filters.quick.filter((x) => x !== q.id) : [...filters.quick, q.id], activeOnly: !on && STOPPED_FILTERS.includes(q.id) ? false : filters.activeOnly })}>
                    {t(q.label)}<span className={cx("font-normal tabular-nums", on ? "opacity-70" : "text-faint")}>{count.toLocaleString(intl)}</span>
                  </button>
                );
              })}
              <button type="button" aria-pressed={filters.activeOnly} className={chipClass(filters.activeOnly)} onClick={() => setFilters({ ...filters, activeOnly: !filters.activeOnly })}>
                {t("Active only")}<span className={cx("font-normal tabular-nums", filters.activeOnly ? "opacity-70" : "text-faint")}>{base.filter((ad) => ad.active).length.toLocaleString(intl)}</span>
              </button>
            </div>
            <p className="text-xs text-faint">{t(SIGNALS_NOTE)}</p>
          </div>
        </Card>
      )}

      {ours && ranked.length > 0 && <MoreLikeWinners productId={productId} ads={allRanked} fits={fits} appName={data.brand?.appName ?? data.workspace.name} />}
      {ranked.length > 0 && shown.length > 0 && <ViewSummary ads={shown} creatives={filters.grouped} />}
      {filters.byType
        ? TYPE_GROUPS.map((group) => {
          const ads = shown.filter((ad) => typeGroup(ad.media_type, ad.is_video) === group.id);
          if (!ads.length) return null;
          const closed = collapsed.has(group.id);
          return (
            <section key={group.id} className="mb-5">
              <button type="button" aria-expanded={!closed} className="-ml-1 mb-2 flex h-7 items-center gap-2 rounded-control pr-2 pl-1 text-left transition-colors hover:bg-hover"
                onClick={() => setCollapsed((c) => { const next = new Set(c); if (closed) next.delete(group.id); else next.add(group.id); return next; })}>
                <IconChevronDown className={cx("size-3.5 text-muted transition", closed && "-rotate-90")} />
                <span className="text-sm font-medium">{t(group.label)}</span>
                <Badge>{ads.length.toLocaleString(intl)}</Badge>
              </button>
              {!closed && (
                <div className="grid gap-3 @sm:grid-cols-2 @2xl:grid-cols-3 @4xl:grid-cols-4 @7xl:grid-cols-5">
                  {ads.slice(0, limit).map((ad) => <AdCard key={ad.id} ad={ad} curve={fitFor(fits, ad)} busy={busy} onOpen={() => { setMakeOnOpen(false); setOpen(ad); }} onSend={() => send(ad)} onMake={() => { setMakeOnOpen(true); setOpen(ad); }} appName={data.brand?.appName} />)}
                </div>
              )}
            </section>
          );
        })
        : (
          <div className="grid gap-3 @sm:grid-cols-2 @2xl:grid-cols-3 @4xl:grid-cols-4 @7xl:grid-cols-5">
            {shown.slice(0, limit).map((ad) => <AdCard key={ad.id} ad={ad} curve={fitFor(fits, ad)} busy={busy} onOpen={() => { setMakeOnOpen(false); setOpen(ad); }} onSend={() => send(ad)} onMake={() => { setMakeOnOpen(true); setOpen(ad); }} appName={data.brand?.appName} />)}
          </div>
        )}
      {shown.length > limit && <MoreCards key={limit} onMore={() => setLimit((n) => n + CARDS_PAGE)} />}
      {ranked.length === 0 && (ours
        ? <EmptyState title={t("None of your own ads yet")} body={t("Open your Facebook Page in the Ad Library, collect its ads with the Ad Library extension, then drop the file here and choose “Ours”.")}
            action={<Button variant="secondary" onClick={() => fileInput.current?.click()}>{t("Import file")}</Button>} />
        : <EmptyState title={t("No ads yet")} body={sideWatch.length ? t("Click {open} on a competitor above, collect its ads with the Ad Library extension and drop the file here. The steps are under “How to get ads in”.", { open: openWord }) : t("Add the competitors whose ads you want to follow, then collect their ads with the Ad Library extension.")}
            action={sideWatch.length ? undefined : <Button variant="secondary" onClick={() => setShowWatch(true)}>{t("Add competitors")}</Button>} />)}
      {ranked.length > 0 && shown.length === 0 && <EmptyState title={t("No ads match these filters")} action={<Button variant="secondary" onClick={() => setFilters({ ...DEFAULT_VIEW, side: filters.side })}>{t("Clear the filters")}</Button>} />}
      {open && <AdDrawer key={open.id} startMaking={makeOnOpen} productId={productId} ad={open} brand={data.brand} avatars={data.avatars ?? []} assets={data.assets ?? []} onAssetAdded={assetAdded} busy={busy} onScanned={(scan, scannedAt) => scanned(open.id, scan, scannedAt)} onClose={() => setOpen(null)} onReadAgain={() => readAgain(open)} onSend={() => send(open)} aiLocked={aiLocked} />}
    </Page>
  );
}

/**
 * Which competitor's ads (or ours, which Page) the list shows, one chip each with its live ads, biggest
 * first; and a quick switch between statics and videos. Meta's impressions order only compares ads within
 * one advertiser's scrape, so with several advertisers and that order the bar says to pick one.
 */
function AdvertiserSwitcher({ ads, activeOnly, value, media, sort, ours, onPick, onMedia }: {
  ads: RankedAdRow[]; activeOnly: boolean; value: string; media: string; sort: AdSort; ours: boolean;
  onPick: (competitor: string) => void; onMedia: (media: string) => void;
}) {
  const { t, intl } = useT();
  const counted = activeOnly ? ads.filter((ad) => ad.active) : ads;
  const byName = new Map<string, number>();
  for (const ad of counted) byName.set(ad.competitor ?? ad.page_name, (byName.get(ad.competitor ?? ad.page_name) ?? 0) + 1);
  const names = [...byName.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  // Each name's Facebook Page, for its logo.
  const pageOf = new Map<string, string>();
  for (const ad of ads) if (ad.page_id && !pageOf.has(ad.competitor ?? ad.page_name)) pageOf.set(ad.competitor ?? ad.page_name, ad.page_id);
  const mine = counted.filter((ad) => !value || (ad.competitor ?? ad.page_name) === value);
  const kinds: { id: string; label: string; count: number }[] = [
    { id: "", label: t("All types"), count: mine.length },
    { id: "image", label: t("Statics"), count: mine.filter((ad) => ad.media_type === "image" && !ad.is_video).length },
    { id: "video", label: t("Videos"), count: mine.filter((ad) => ad.media_type === "video" || Boolean(ad.is_video)).length },
  ];
  return (
    <Card className="mb-3 grid gap-2.5 p-3">
      <div className="grid gap-2">
        <p className="eyebrow">{ours ? t("Page") : t("Competitor")}{names.length > 1 ? ` · ${names.length}` : ""}</p>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={ours ? t("Page") : t("Competitor")}>
          {names.length > 1 && (
            <button type="button" aria-pressed={!value} className={chipClass(!value)} onClick={() => onPick("")}>
              {ours ? t("All Pages") : t("All competitors")}<span className={cx("font-normal tabular-nums", !value ? "opacity-70" : "text-faint")}>{counted.length.toLocaleString(intl)}</span>
            </button>
          )}
          {names.map(([name, count]) => {
            const on = value === name || names.length === 1;
            return (
              <button key={name} type="button" aria-pressed={on} className={chipClass(on)} onClick={() => onPick(value === name ? "" : name)}>
                <PageLogo pageId={pageOf.get(name)} name={name} size="xs" className="-ml-2" />{name}<span className={cx("font-normal tabular-nums", on ? "opacity-70" : "text-faint")}>{count.toLocaleString(intl)}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-2.5">
        <div className={segmentTrackClass} role="tablist" aria-label={t("Creative type")}>
          {kinds.map((k) => (
            <button key={k.id} type="button" role="tab" aria-selected={media === k.id} onClick={() => onMedia(k.id)} className={segmentClass(media === k.id)}>
              {k.label} <span className="ml-1 text-xs text-muted tabular-nums">{k.count.toLocaleString(intl)}</span>
            </button>
          ))}
        </div>
        <p className="text-xs text-muted">
          {sort === "impressions"
            ? !value && names.length > 1 ? t("Meta's impressions order compares ads within one advertiser: pick one to see their order.") : t("In Meta's impressions order: #1 was shown the most.")
            : t("Statics and Videos sort by Meta's impressions order.")}
        </p>
      </div>
    </Card>
  );
}

/**
 * A card's "Copy image" for a static: the picture to the clipboard, for a brief or a moodboard. When the
 * browser won't allow the clipboard (an embedded window, a denied permission), it's downloaded instead.
 */
function CopyImageAction({ ad, url }: { ad: RankedAdRow; url: string }) {
  const { t } = useT();
  const [state, setState] = useState<"idle" | "busy" | "copied" | "saved">("idle");
  const go = async () => {
    setState("busy");
    const copied = await copyImage(url).then(() => true, () => false);
    if (!copied) await downloadFile(url, fileName(ad));
    setState(copied ? "copied" : "saved");
    setTimeout(() => setState("idle"), 2200);
  };
  return (
    <button type="button" onClick={go} disabled={state === "busy"} className={cardActionClass} title={t("Copy the image to the clipboard")}>
      {state === "busy" ? <Spinner /> : state === "idle" ? <IconCopy /> : <IconCheck className="text-win" />}
      {state === "copied" ? t("Copied") : state === "saved" ? t("Saved instead") : t("Copy image")}
    </button>
  );
}

/**
 * Research → Our ads: our top long-runners of one kind (lib/winners.ts) become a Studio brief (what they
 * share, their images as style references, their offer wording), handed over in sessionStorage.
 */
function MoreLikeWinners({ productId, ads, fits, appName }: { productId: string; ads: RankedAdRow[]; fits: Map<string, RankFit>; appName: string }) {
  const router = useRouter();
  const { t } = useT();
  const picks = useMemo(() => ({ static: pickWinners(ads, "static", { fits }), video: pickWinners(ads, "video", { fits }) }), [ads, fits]);
  if (!picks.static.length && !picks.video.length) return null;
  const open = (kind: WinnerKind) => {
    const handoff = buildWinnersHandoff(picks[kind], kind, appName);
    if (!handoff) return;
    try { sessionStorage.setItem(WINNERS_KEY, JSON.stringify(handoff)); } catch { /* private mode: the Studio opens without the prefill */ }
    router.push(`/app/w/${productId}/studio?from=winners`);
  };
  return (
    <Card className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 p-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{t("More like our winners")}</p>
        <p className="text-xs text-muted">{t("Opens the Studio with a brief from what your top long-runners of a kind share (format, hook, proof, offer, CTA, layout), their images as style references and their offer wording. Every new ad still gets a new hook.")}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {(["static", "video"] as const).map((kind) => picks[kind].length > 0 && (
          <Button key={kind} size="sm" variant="secondary" onClick={() => open(kind)}
            title={t("Built from: {list}", { list: picks[kind].map((w) => w.beats != null ? t("{days} days, {beats} vs its age", { days: w.days, beats: `${w.beats >= 0 ? "+" : ""}${w.beats}` }) : t("{days} days", { days: w.days })).join(" · ") })}>
            {kind === "video" ? t("Videos like our top {n}", { n: picks[kind].length }) : t("Statics like our top {n}", { n: picks[kind].length })}
          </Button>
        ))}
      </div>
    </Card>
  );
}

/** The line above the list: what's in this view. */
function ViewSummary({ ads, creatives }: { ads: RankedAdRow[]; creatives: boolean }) {
  const { t, tn, intl } = useT();
  const s = summarizeAds(ads);
  const types = TYPE_GROUPS.filter((g) => s.byType[g.id]).map((g) => `${t(g.label)} ${s.byType[g.id].toLocaleString(intl)}`).join(" · ");
  // The numbers stand out (bold) inside each translated phrase: "{n}" is left in by `keep` and filled by rich().
  const num = (value: number | string) => <span className="font-medium text-label tabular-nums">{typeof value === "number" ? value.toLocaleString(intl) : value}</span>;
  const keep = { n: "{n}" };
  return (
    <p className="mb-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted tabular-nums">
      <span>{rich(creatives ? tn(s.total, "{n} creative", "{n} creatives", keep) : tn(s.total, "{n} ad", "{n} ads", keep), { n: num(s.total) })}</span>
      <span>{rich(t("{n} active"), { n: num(s.active) })}</span>
      {types && <span className="text-faint">{types}</span>}
      {s.medianDays != null && <span>{rich(t("median {n} days running"), { n: num(s.medianDays) })}</span>}
      <span>{rich(t("{pct}% long runners ({days}+ days)"), { pct: num(Math.round(s.longShare * 100)), days: LONG_RUNNER_DAYS })}</span>
    </p>
  );
}

function Select({ label, value, onChange, values, name = (v) => v }: { label: string; value: string; onChange: (v: string) => void; values: string[]; name?: (v: string) => string }) {
  const { t } = useT();
  return (
    <label className="flex min-w-0 flex-col gap-1.5 text-xs text-muted">{label}
      <select value={value} onChange={(e) => onChange(e.target.value)} className={selectClass}>
        <option value="">{t("All")}</option>{values.map((v) => <option key={v} value={v}>{name(v)}</option>)}
      </select>
    </label>
  );
}

function DaysBadge({ ad }: { ad: RankedAdRow }) {
  const { t, tn } = useT();
  if (ad.days == null) return ad.metrics?.ctr ? <Badge tone="accent">{t("top ad · CTR {pct}%", { pct: (ad.metrics.ctr * 100).toFixed(1) })}</Badge> : null;
  return <Badge tone={ad.days >= LONG_RUNNING_DAYS ? "win" : "neutral"}>{ad.active ? tn(ad.days, "running {n} day", "running {n} days") : tn(ad.days, "ran {n} day", "ran {n} days")}</Badge>;
}

/** Media links from the Ad Library are signed and expire after some days. */
const expiredText = (ad: RankedAdRow) => (ad.source === "meta_local" ? m("Media link expired: collect the ads again") : m("Media link expired: pull the ads again"));

const MEDIA_ICON: Partial<Record<AdMediaType, typeof IconImage>> = { video: IconVideo, image: IconImage, carousel: IconCarousel, dco: IconLayers, text: IconFile };

/**
 * What the card can show, in order: the thumb (stored copy, then the Ad Library link), then each media's
 * poster and file. A video without a poster shows its first frame.
 */
function cardSources(ad: RankedAdRow): { kind: "image" | "video"; url: string }[] {
  const out: { kind: "image" | "video"; url: string }[] = [];
  const add = (kind: "image" | "video", url: string | null | undefined) => { if (url && !out.some((s) => s.url === url)) out.push({ kind, url }); };
  add("image", ad.thumb);
  add("image", ad.thumb_source_url);
  for (const m of mediaOf(ad)) {
    add("image", m.thumbnail_url);
    add("image", m.thumbnail_source_url);
    add(m.type, m.url);
    add(m.type, m.source_url);
  }
  return out;
}

type CardSource = ReturnType<typeof cardSources>[number];

const CARDS_PAGE = 24;

/** The bottom of the grid: when it comes near the screen, the next page of cards renders. */
function MoreCards({ onMore }: { onMore: () => void }) {
  const [ref, near] = useNearViewport<HTMLDivElement>("800px");
  useEffect(() => { if (near) onMore(); }, [near, onMore]);
  return <div ref={ref} className="h-10" aria-hidden />;
}

/** True once the element has come within `margin` of the viewport (and stays true). */
function useNearViewport<T extends Element>(margin = "600px"): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    if (typeof IntersectionObserver === "undefined") { const id = requestAnimationFrame(() => setNear(true)); return () => cancelAnimationFrame(id); }
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { setNear(true); io.disconnect(); } }, { rootMargin: margin });
    io.observe(el);
    return () => io.disconnect();
  }, [near, margin]);
  return [ref, near];
}

/**
 * The card's media: an image, or a video's first frame (muted, no controls), cropped to the 4:5 frame.
 * Loaded only when the card comes near the screen: a page of video cards decoding at once froze the tab.
 */
function CardMedia({ ad, src, expired, onFail }: { ad: RankedAdRow; src: CardSource | undefined; expired: boolean; onFail: (url: string) => void }) {
  const [ref, near] = useNearViewport<HTMLSpanElement>();
  if (src && !near) return <span ref={ref} className="block size-full bg-canvas" aria-hidden />;
  return <CardMediaLoaded ad={ad} src={src} expired={expired} onFail={onFail} />;
}

function CardMediaLoaded({ ad, src, expired, onFail }: { ad: RankedAdRow; src: CardSource | undefined; expired: boolean; onFail: (url: string) => void }) {
  const { t } = useT();
  const media = "size-full object-cover transition group-hover:opacity-90";
  if (src?.kind === "image") {
    // eslint-disable-next-line @next/next/no-img-element
    return <img key={src.url} src={src.url} alt={ad.headline || ad.page_name} loading="lazy" decoding="async" onError={() => onFail(src.url)} className={media} />;
  }
  if (src?.kind === "video") {
    return <video key={src.url} src={`${src.url}#t=0.1`} muted playsInline preload="metadata" onError={() => onFail(src.url)} className={media} aria-label={ad.headline || ad.page_name} />;
  }
  const Icon = MEDIA_ICON[ad.media_type] ?? IconImage;
  return (
    <span className="flex size-full flex-col items-center justify-center gap-2 px-6 pb-10 text-center text-faint">
      <Icon className="size-6" strokeWidth={1.4} />
      <span className="text-xs">{expired ? t(expiredText(ad)) : t("No preview")}</span>
    </span>
  );
}

/** "Running 143 days", green with a dot from the long-running mark on; a top ad's CTR when there are no dates. */
function RunSignal({ ad }: { ad: RankedAdRow }) {
  const { t, tn } = useT();
  if (ad.days == null) return ad.metrics?.ctr ? <span className="text-accent">{t("Top ad · CTR {pct}%", { pct: (ad.metrics.ctr * 100).toFixed(1) })}</span> : null;
  const long = ad.days >= LONG_RUNNING_DAYS;
  const days = tn(ad.days, "{n} day", "{n} days");
  return (
    <span className={cx("inline-flex items-center gap-1.5", long && "text-win")} title={long ? t("Running {days}: {long}+ days, likely profitable", { days, long: LONG_RUNNING_DAYS }) : t("Running {days}", { days })}>
      {long && <span className="size-1.5 shrink-0 rounded-full bg-win" aria-hidden />}
      {ad.active ? days : <span><span className="text-warn">{t("Stopped")}</span> · {t("ran {days}", { days })}</span>}
    </span>
  );
}

const cardActionClass = "inline-flex h-7 min-w-0 items-center gap-1.5 rounded-control px-2 text-xs font-medium overflow-hidden whitespace-nowrap text-label [&>span]:truncate transition hover:bg-hover hover:text-ink disabled:pointer-events-none [&_svg]:size-3.5 [&_svg]:shrink-0";

/** "Outperforms its age by N": Meta's impressions rank against the rank an ad of its age usually has on this account. */
function AgeBadge({ ad, fit }: { ad: RankedAdRow; fit: RankFit }) {
  const { t, tn } = useT();
  const beats = outperformsBy(ad, fit);
  const age = rankAge(ad);
  if (beats == null || age == null || beats < OUTPERFORM_MIN) return null;
  const curve = fit.fitted ? t("this account's curve from {n} ranked ads ({formula})", { n: fit.n, formula: `${fit.a} − ${fit.b}·ln(days+1)` }) : t("the default curve ({formula})", { formula: "184.6 − 40.3·ln(days+1)" });
  return (
    <span className="shrink-0" title={t("Ranked #{rank} at {age}; an ad that age usually ranks about #{expected} ({curve}).", { rank: String(ad.impressions_rank), age: tn(age, "{n} day", "{n} days"), expected: String(Math.round(expectedRank(age, fit))), curve })}>
      <Badge tone="win">{t("Outperforms its age by {n}", { n: beats })}</Badge>
    </span>
  );
}

function AdCard({ ad, curve, busy, onOpen, onSend, onMake, appName }: { ad: RankedAdRow; curve: RankFit; busy: string | null; onOpen: () => void; onSend: () => void; onMake?: () => void; appName?: string }) {
  const { t, locale } = useT();
  // Chinese, Japanese and Korean labels run longer than the English ones: switch to the short labels on wider cards.
  const cjk = locale !== "en";
  const copy = ad.body || ad.headline || ad.description;
  const name = ad.competitor ?? ad.page_name;
  const where = ad.placements.map((p) => lbl(t, PLACEMENT_LABEL[p], p)).join(", ") || t(NETWORK_LABEL[ad.network]);
  const sources = useMemo(() => cardSources(ad), [ad]);
  // The stored copy first, then the Ad Library link; "expired" only when none loads.
  const [failed, setFailed] = useState<string[]>([]);
  const src = sources.find((s) => !failed.includes(s.url));
  const sending = busy === `send:${ad.id}`;
  const sent = Boolean(ad.sent_to_library_at);
  const signal = ad.days != null || Boolean(ad.metrics?.ctr) || ad.groupSize > 1 || ad.impressions_rank != null;
  const fit = ad.scan?.fit;
  const sendLabel = sent ? t("In the format library") : t("Send to the format library");
  return (
    <Card className="flex h-full min-w-0 flex-col overflow-hidden rounded-small">
      <div className="relative aspect-[4/5] overflow-hidden border-b border-line bg-canvas">
        <button type="button" onClick={onOpen} className="group absolute inset-0 block size-full text-left" aria-label={t("Open ad from {name}", { name })}>
          <CardMedia ad={ad} src={src} expired={sources.length > 0} onFail={(url) => setFailed((f) => [...f, url])} />
          {src && ad.media_type === "video" && (
            <span className="absolute right-2 bottom-2 grid size-6 place-items-center rounded-full bg-scrim/40 text-white backdrop-blur-sm" aria-hidden><IconPlay className="ml-px size-2.5" /></span>
          )}
        </button>
        {!src && ad.snapshot_url && (
          <a href={ad.snapshot_url} target="_blank" rel="noopener noreferrer" className="absolute inset-x-0 bottom-6 mx-auto w-fit rounded-control px-2 py-1 text-xs font-medium text-accent transition hover:bg-accent-soft">
            {ad.network === "meta" ? t("Open in Ad Library ↗") : t("Open in TikTok ↗")}
          </a>
        )}
      </div>
      {/* Fixed lines, so every card in a row lines up: name and rank · type and placements · days and copies · two lines of copy · tags. */}
      {/* The text opens the ad too (the picture is the button; this is the same click for a pointer). */}
      <div className="flex flex-1 cursor-pointer flex-col px-3 pt-2 pb-2" onClick={onOpen}>
        <div className="flex min-w-0 items-baseline gap-2">
          <p className="min-w-0 flex-1 truncate text-sm font-medium" title={name}>{name}</p>
          {ad.impressions_rank != null && (
            <span className="shrink-0 text-xs text-faint tabular-nums" title={t("#{rank} under Meta's \"total impressions\" sort when collected (#1 had the most)", { rank: String(ad.impressions_rank) })}>#{ad.impressions_rank}</span>
          )}
        </div>
        <div className="flex h-4 min-w-0 items-center gap-2 text-xs text-muted">
          <span className="shrink-0">{t(MEDIA_LABEL[ad.media_type])}</span>
          {ad.placements.length ? <PlacementIcons placements={ad.placements} /> : <span className="truncate">{where}</span>}
        </div>
        <div className="mt-2 flex h-4 min-w-0 items-center gap-2 overflow-hidden text-xs whitespace-nowrap text-muted tabular-nums">
          <span className="flex min-w-0 items-center gap-1.5 overflow-hidden">
            {signal ? <RunSignal ad={ad} /> : <span className="text-faint">{t("No run data")}</span>}
            {ad.groupSize > 1 && <><span className="text-faint" aria-hidden>·</span><span title={t("{n} live ads use this creative", { n: ad.groupSize })}>{t("{n} copies", { n: ad.groupSize })}</span></>}
          </span>
          {fit && (
            <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs text-faint" title={`${t("{fit} (AI advice)", { fit: t(FIT_LABEL[fit.level]) })}${fit.reason ? `: ${fit.reason}` : ""}`}>
              <FitDot level={fit.level} />{t(FIT_SHORT[fit.level])}
            </span>
          )}
        </div>
        <p className="mt-2 line-clamp-2 min-h-[2lh] text-xs leading-[1.45] whitespace-pre-line text-label">{copy || <span className="text-faint">{t("No ad copy")}</span>}</p>
        <TagRow className="mt-2">
          <AgeBadge ad={ad} fit={curve} />
          <EditedBadge ad={ad} />
          {ad.library?.lowImpressions && <span title={t(LOW_IMPRESSIONS_TITLE)}><Badge tone="caution">{t("Low impression count")}</Badge></span>}
          {ad.decoded && <Badge tone="accent">{lbl(t, AD_FORMAT_LABEL[ad.decoded.format], ad.decoded.format)}</Badge>}
          {ad.decoded?.hookType && <Badge tone="accent">{t("{name} hook", { name: lbl(t, HOOK_LABEL[ad.decoded.hookType], ad.decoded.hookType) })}</Badge>}
          {ad.library?.partner && <span title={t("Partnership ad with {name}", { name: ad.library.partner.name })}><Badge>{t("With {name}", { name: ad.library.partner.name.length > 24 ? `${ad.library.partner.name.slice(0, 23)}…` : ad.library.partner.name })}</Badge></span>}
          {ad.cta && <Badge>{ad.cta}</Badge>}
        </TagRow>
      </div>
      <div className="@container mt-auto flex items-center gap-1 border-t border-line p-1">
        {src?.kind === "image" && ad.media_type === "image" && !ad.is_video && <CopyImageAction ad={ad} url={src.url} />}
        {(ad.media_type === "video" || ad.is_video) && <button type="button" onClick={onOpen} className={cx(cardActionClass, "shrink-0")} title={t("Its script, shots and hook")}><IconVideo />{t("Breakdown")}</button>}
        {onMake && !ad.is_own && <button type="button" onClick={onMake} data-guide="make" className={cardActionClass} title={appName ? t("The same kind of ad for {app}: a ready-made prompt, one image here, or a batch in Studio", { app: appName }) : t("The same kind of ad for your app: a ready-made prompt, one image here, or a batch in Studio")}><IconWand /><span className={cjk ? "@max-[22rem]:hidden" : "@max-[16rem]:hidden"}>{appName ? t("Make for {app}", { app: appName }) : t("Make for your app")}</span><span className={cjk ? "hidden @max-[22rem]:inline" : "hidden @max-[16rem]:inline"}>{t("Make")}</span></button>}
        <button type="button" onClick={onSend} disabled={sent || sending} className={cx(cardActionClass, "ml-auto", sent && "text-muted")} title={sendLabel} aria-label={sendLabel}>
          {sending ? <Spinner /> : sent ? <IconCheck className="text-win" /> : <IconLayers />}
          {sent ? t("In library") : <><span className={cjk ? "@min-[22rem]:hidden" : "@min-[14rem]:hidden"}>{t("Library")}</span><span className={cjk ? "hidden @min-[22rem]:inline" : "hidden @min-[14rem]:inline"}>{t("Send to library")}</span></>}
        </button>
      </div>
    </Card>
  );
}

/**
 * A card's tags in two lines of fixed height, the same on every card: only whole tags show (the ones that
 * don't fit wrap out of sight, never cut in half), and a "+N" says how many more there are, naming them on hover.
 */
const TAG_LINES = 2;
function TagRow({ className, children }: { className?: string; children: React.ReactNode }) {
  const row = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  useEffect(() => {
    const el = row.current;
    if (!el) return;
    const measure = () => {
      const items = Array.from(el.children) as HTMLElement[];
      // The second line's top: anything below it is out of sight.
      const lines = [...new Set(items.map((item) => item.offsetTop))].sort((a, b) => a - b);
      const last = lines[TAG_LINES - 1] ?? Infinity;
      const off = items.filter((item) => item.offsetTop > last + 2).map((item) => item.textContent?.trim() ?? "").filter(Boolean);
      setHidden((before) => (before.join("|") === off.join("|") ? before : off));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [children]);
  return (
    <div className={cx("flex h-12 min-w-0 items-end gap-1", className)}>
      <div ref={row} className="flex h-12 min-w-0 flex-1 flex-wrap content-start gap-1 overflow-hidden">{children}</div>
      {hidden.length > 0 && <span className="shrink-0" title={hidden.join(" · ")}><Badge>+{hidden.length}</Badge></span>}
    </div>
  );
}

// MARK: Ad detail

interface Measure { width?: number | null; height?: number | null; duration?: number | null; aspect?: string | null }

/** The creative's media: the measured list from the collection when there is one, else the ad's own. */
function mediaOf(ad: RankedAdRow): CreativeMedia[] {
  if (ad.creative?.media?.length) return ad.creative.media;
  return ad.media.map((m) => ({ type: m.type, url: m.url, thumbnail_url: m.thumb ?? null, source_url: m.source_url ?? null, thumbnail_source_url: m.thumb_source_url ?? null }));
}

/** Stored size when the collection measured it, else what the browser measured. */
function sizeOf(media: CreativeMedia, measured?: Measure): Measure {
  if (media.width && media.height) return { width: media.width, height: media.height, duration: media.duration_sec ?? measured?.duration, aspect: media.aspect };
  return { ...measured, aspect: media.aspect ?? null, duration: media.duration_sec ?? measured?.duration };
}

const placementLabel = (p: Placement, t: (text: string) => string = (s) => s) => `${t(p.label)} (${p.aspect})`;

/**
 * One media, measured once it loads (image natural size; video size and length from its metadata). The
 * stored copy first, then the Ad Library link; `onFail` only when neither loads.
 */
function MediaView({ media, big, failed, onMeasure, onFail, expired }: { media: CreativeMedia; big?: boolean; failed: boolean; onMeasure: (m: Measure) => void; onFail: () => void; expired: string }) {
  const { t } = useT();
  const [fellBack, setFellBack] = useState(false);
  const src = fellBack && media.source_url ? media.source_url : media.url;
  const poster = (fellBack && media.thumbnail_source_url) || media.thumbnail_url || undefined;
  const error = () => (!fellBack && media.source_url && media.source_url !== media.url ? setFellBack(true) : onFail());
  if (failed) {
    return <div className={cx("grid place-items-center bg-canvas p-4 text-center text-xs text-muted", big ? "aspect-[4/3] w-full" : "size-16")}>{big ? expired : t("Expired")}</div>;
  }
  if (media.type === "video") {
    return (
      <video
        key={src} src={src} poster={poster} preload="metadata" playsInline controls={big} muted={!big}
        onLoadedMetadata={(e) => {
          const v = e.currentTarget;
          onMeasure({ width: v.videoWidth || null, height: v.videoHeight || null, duration: Number.isFinite(v.duration) ? v.duration : null });
        }}
        onError={error}
        className={cx("bg-canvas", big ? "max-h-[60vh] w-full" : "size-16 object-cover")}
      />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={src} src={src} alt="" onError={error}
      onLoad={(e) => onMeasure({ width: e.currentTarget.naturalWidth || null, height: e.currentTarget.naturalHeight || null })}
      className={cx("bg-canvas", big ? "max-h-[60vh] w-full object-contain" : "size-16 object-cover")}
    />
  );
}

/**
 * The card's "Edited" tag: an ad edited while it ran (same Library ID). Peach when the read (Jev's decode)
 * or the AI scan is from before the edit (they describe the earlier version), grey otherwise.
 */
function EditedBadge({ ad }: { ad: RankedAdRow }) {
  const { t, intl } = useT();
  if (!ad.creative_changed_at) return null;
  const stale = staleOf(ad);
  const when = shortDate(ad.creative_changed_at, intl);
  const reads = stale.decode || stale.scan;
  const title = stale.decode && stale.scan ? t("Edited on {when}: the read and the AI scan describe the earlier version.", { when })
    : stale.decode ? t("Edited on {when}: the read describes the earlier version.", { when })
    : stale.scan ? t("Edited on {when}: the AI scan describes the earlier version.", { when })
    : t("Edited on {when}: its copy, link or media changed while it ran.", { when });
  return (
    <span className="shrink-0" title={title}>
      <Badge tone={reads ? "caution" : "neutral"}>{reads ? (stale.decode ? t("Edited since read") : t("Edited since scanned")) : t("Edited")}</Badge>
    </span>
  );
}

/**
 * staleReads, with the read counted only once there is one: while the background read has an ad
 * claimed, `decoded_at` is set and `decoded` still empty.
 */
function staleOf(ad: RankedAdRow) {
  const stale = staleReads(ad);
  return { ...stale, decode: stale.decode && Boolean(ad.decoded) };
}

/** In the drawer: the read (or scan) is older than the ad's last edit. */
function EditedCallout({ ad, busy, onReadAgain, className }: { ad: RankedAdRow; busy: boolean; onReadAgain: () => void; className?: string }) {
  const { t, intl } = useT();
  const stale = staleOf(ad);
  if (!stale.decode && !stale.scan) return null;
  const when = shortDate(ad.creative_changed_at, intl);
  const text = stale.decode && stale.scan
    ? t("Edited on {when}, after it was read and scanned: both describe the earlier version. Recreate scans it again.", { when })
    : stale.decode
      ? t("Edited on {when}, after it was read: the read describes the earlier version.", { when })
      : t("Edited on {when}, after the AI scan: the scan describes the earlier version, so Recreate scans it again.", { when });
  return (
    <div className={cx("flex items-center gap-3 rounded-inner border border-caution/30 bg-caution-soft px-3 py-2.5 text-xs leading-relaxed text-caution-ink", className)} role="note">
      <p className="min-w-0 flex-1">{text}</p>
      {stale.decode && <Button size="sm" variant="secondary" className="shrink-0" onClick={onReadAgain} disabled={busy}>{busy && <Spinner />}{t("Read again")}</Button>}
    </div>
  );
}

/** The longest search terms a competitor keeps (app/api/research/[productId]/watch keeps no more). */
const SEARCH_TERMS_MAX = 100;
const LOW_IMPRESSIONS_TITLE = m("Impressions: <100. Meta's lowest bucket in the Ad Library, so this ad has barely been shown.");

/** What Meta's Ad Library says about an ad beyond its creative (the scraper's raw Ad Library data). */
function LibraryDetails({ library }: { library: AdLibraryDetails }) {
  const { t, intl } = useT();
  const rows: [string, React.ReactNode][] = [];
  if (library.impressions) rows.push([t("Impressions"), <span key="i" className="inline-flex items-center gap-1.5 tabular-nums">{library.impressions.text}{library.lowImpressions && <Badge tone="caution">{t("Low impression count")}</Badge>}</span>]);
  const posted = library.postedAs;
  if (posted) {
    const extra = [posted.categories[0], posted.likes != null ? t("{n} likes", { n: compact(posted.likes, intl) }) : null].filter(Boolean).join(" · ");
    rows.push([t("Ran from"), (
      <span key="p" className="inline-flex min-w-0 items-center gap-1.5">
        {posted.picture && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={posted.picture} alt="" className="size-4 shrink-0 rounded-full object-cover" referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.style.display = "none"; }} />
        )}
        {posted.profileUrl ? <a href={posted.profileUrl} target="_blank" rel="noopener noreferrer" className="truncate text-accent hover:underline">{posted.name}</a> : <span className="truncate">{posted.name}</span>}
        {extra && <span className="shrink-0 text-faint">{extra}</span>}
      </span>
    )]);
  }
  if (library.partner) rows.push([t("Partnership"), library.partner.profileUrl
    ? <a key="pa" href={library.partner.profileUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">{library.partner.name} ↗</a>
    : library.partner.name]);
  if (library.ctaType) rows.push([t("Button"), CTA_TYPE_LABEL[library.ctaType] ? t(CTA_TYPE_LABEL[library.ctaType]) : library.ctaType.toLowerCase().replace(/_/g, " ")]);
  if (library.landingDomain || library.linkHost) rows.push([t("Links to"), library.landingDomain ?? library.linkHost]);
  if (library.tracking) rows.push([t("Tracking"), library.tracking]);
  const flags = [library.ageGated && t("Age-restricted"), library.aiGenerated && t("AI-made media (Meta label)"), library.sensitive && t("Sensitive content")].filter(Boolean) as string[];
  if (flags.length) rows.push([t("Labels"), flags.join(" · ")]);
  if (library.categories?.length) rows.push([t("Category"), library.categories.map((c) => c.toLowerCase().replace(/_/g, " ")).join(", ")]);
  if (!rows.length) return null;
  return (
    <div className="grid gap-2">
      <p className="eyebrow">{t("From the Ad Library")}</p>
      <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-xs leading-5 text-muted">{label}</dt>
            <dd className="min-w-0 leading-5 [overflow-wrap:anywhere]">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function compact(n: number, intl: string) {
  return new Intl.NumberFormat(intl, { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

/**
 * In the drawer: how the ad is built (its format, hook and each line's job), read in the background when
 * it came in. "Read again" re-runs it; a video the scan heard is read from what's said.
 */
function AdRead({ ad, busy, onReadAgain, aiLocked }: { ad: RankedAdRow; busy: boolean; onReadAgain: () => void; aiLocked: FeatureState | null }) {
  const { t } = useT();
  const video = ad.media_type === "video" || Boolean(ad.is_video);
  const readable = Boolean(ad.body || ad.headline) || heardLines(ad) > 0;
  const again = aiLocked
    ? <LockedNote state={aiLocked}>{t("Reading needs {keys}", { keys: aiLocked.missingKeys.join(" + ") })}</LockedNote>
    : <Button size="sm" variant="ghost" onClick={onReadAgain} disabled={busy}>{busy && <Spinner />}{ad.decoded ? t("Read again") : t("Read now")}</Button>;
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <p className="eyebrow">{t("How it's built")}</p>
        {readable && again}
      </div>
      {!ad.decoded ? (
        ad.decode_error && readable
          ? <p className="mt-1 text-sm text-warn" role="status">{t("Couldn't read this ad: {error}", { error: ad.decode_error })}</p>
          : <p className="mt-1 text-sm text-muted">{!readable ? t("No copy to read yet. Collect its ads again to get its text.") : aiLocked ? t("Not read yet.") : t("Not read yet: new ads are read in the background, a few at a time.")}</p>
      ) : (
        <>
          <EditedCallout ad={ad} busy={busy} onReadAgain={onReadAgain} className="mt-2" />
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge tone="accent">{lbl(t, AD_FORMAT_LABEL[ad.decoded.format], ad.decoded.format)}</Badge>
            {ad.decoded.hookType && <Badge tone="accent">{t("{name} hook", { name: lbl(t, HOOK_LABEL[ad.decoded.hookType], ad.decoded.hookType) })}</Badge>}
          </div>
          <ol className="mt-3 grid gap-2">
            {ad.decoded.roles.map((line, i) => (
              <li key={i} className="text-sm"><span className="mr-1.5 text-xs text-muted">{lbl(t, ROLE_LABEL[line.role], line.role)}</span>{" "}{line.text}</li>
            ))}
          </ol>
          {ad.decoded.source === "transcript"
            ? <p className="mt-3 text-xs text-muted">{t("Read from what's said in the video, with the ad copy.")}</p>
            : video && <p className="mt-3 text-xs text-muted">{t("Read from the ad copy. Scanning it in Recreate hears the video, and it's read again from what's said.")}</p>}
        </>
      )}
    </div>
  );
}

function AdDrawer({ productId, ad, brand, avatars, assets, onAssetAdded, busy, onClose, onReadAgain, onSend, onScanned, aiLocked, startMaking = false }: {
  productId: string; ad: RankedAdRow; brand?: ResearchBrand; avatars: ResearchAvatar[]; assets: ProductAsset[]; onAssetAdded: (asset: ProductAsset) => void;
  /** Opened from a card's "Make for <app>": the sheet opens straight away. */
  startMaking?: boolean;
  busy: string | null; onClose: () => void; onReadAgain: () => void; onSend: () => void;
  onScanned: (scan: AdScan, scannedAt: string) => void;
  aiLocked: FeatureState | null;
}) {
  const { t, tn } = useT();
  const [recreating, setRecreating] = useState(false);
  const [making, setMaking] = useState(startMaking);
  const media = mediaOf(ad);
  const [measured, setMeasured] = useState<Record<number, Measure>>({});
  const [failed, setFailed] = useState<Record<number, boolean>>({});
  const measure = (i: number) => (m: Measure) => setMeasured((all) => ({ ...all, [i]: m }));
  const fail = (i: number) => () => setFailed((all) => ({ ...all, [i]: true }));
  const sizes = media.map((m, i) => sizeOf(m, measured[i]));
  const first = sizes[0];
  const placement = (ad.creative?.nearest_placement ? placementById(ad.creative.nearest_placement) : undefined)
    ?? (first?.width && first.height ? nearestPlacement(first.width, first.height) : undefined);
  const multi = media.length > 1 || ad.media_type === "carousel" || ad.media_type === "dco";
  const anyFailed = Object.values(failed).some(Boolean);
  const expired = t(expiredText(ad));
  const cards = ad.creative?.card_count ?? media.length;

  return (
    <PanelPortal onClose={onClose}>
    <div className={`${MODAL_OVERLAY} z-40`} onClick={onClose}>
      <aside className={`${MODAL} max-w-xl`} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={t("Ad details")}>
        <div className="sticky top-0 z-10 flex min-h-11 items-center justify-between gap-2 border-b border-line bg-card px-4 py-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2"><span className="truncate text-sm font-medium">{ad.competitor ?? ad.page_name}</span><DaysBadge ad={ad} /></div>
          <button type="button" onClick={onClose} className="grid size-7 place-items-center rounded-control text-muted transition hover:bg-hover hover:text-ink" aria-label={t("Close")}><IconX className="size-3.5" /></button>
        </div>
        <div className="grid gap-4 p-4">
          {media[0]
            ? <MediaView media={media[0]} big failed={Boolean(failed[0])} onMeasure={measure(0)} onFail={fail(0)} expired={expired} />
            : ad.thumb ? <MediaView media={{ type: "image", url: ad.thumb }} big failed={Boolean(failed[0])} onMeasure={measure(0)} onFail={fail(0)} expired={expired} /> : null}

          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-small border border-line bg-line @md:grid-cols-4">
            {([
              [t("Days running"), ad.days ?? "–"],
              [t("Variants"), ad.variants > 1 ? ad.variants : ad.groupSize],
              [t("Impressions rank"), ad.impressions_rank != null ? `#${ad.impressions_rank}` : "–"],
              [t("Since"), ad.started_at?.slice(0, 10) ?? "–"],
            ] as const).map(([label, value]) => (
              <div key={label} className="bg-card px-3 py-2"><p className="text-xs text-muted">{label}</p><p className="text-sm font-medium tabular-nums">{value}</p></div>
            ))}
          </div>
          {ad.impressions_rank != null && <p className="-mt-3 text-xs text-muted">{t("Its place under Meta's “total impressions” sort when {name}'s ads were collected (#1 had the most).", { name: ad.page_name })}</p>}

          <div className="flex flex-wrap gap-1.5">
            <Badge tone="accent">{t(MEDIA_LABEL[ad.media_type])}{multi && cards > 1 ? ` · ${tn(cards, "{n} card", "{n} cards")}` : ""}</Badge>
            {ad.placements.length > 0 && <PlacementIcons placements={ad.placements} size={18} className="gap-1.5" />}
            {ad.countries.map((c) => <Badge key={c}>{c}</Badge>)}
            {!ad.active && <Badge tone="warn">{t("stopped")}</Badge>}
            {ad.library?.lowImpressions && <span title={t(LOW_IMPRESSIONS_TITLE)}><Badge tone="caution">{t("Low impression count")}</Badge></span>}
          </div>

          {ad.library && <LibraryDetails library={ad.library} />}
          {ad.creative_changed_at && <AdChanges productId={productId} ad={ad} />}

          <div className="grid gap-3">
            <p className="eyebrow">{t("Creative size")}</p>
            {placement && (
              <div className="flex items-center gap-3">
                <span className="grid w-[72px] shrink-0 place-items-center rounded-small bg-canvas py-2"><PlacementSketch placement={placement} carousel={ad.media_type === "carousel" && placement.chrome !== "fullscreen"} /></span>
                <div className="grid gap-0.5 text-sm">
                  <span className="font-medium">{placementLabel(placement, t)}</span>
                  <span className="text-xs text-muted">{t("Nearest Meta placement · {where}", { where: placement.where.slice(0, 2).map((w) => t(w)).join(", ") })}</span>
                  {!multi && <span className="text-xs tabular-nums text-ink">{sizeLine(first ?? {}) || t("Measuring…")}</span>}
                </div>
              </div>
            )}
            {!placement && !multi && <p className="text-sm text-muted">{failed[0] ? t("Unknown: the media link has expired.") : media.length ? t("Measuring…") : t("No media to measure.")}</p>}
            {multi && media.length > 0 && (
              <ol className="grid gap-2">
                {media.map((m, i) => {
                  const size = sizes[i];
                  const near = size.width && size.height ? nearestPlacement(size.width, size.height) : undefined;
                  return (
                    <li key={`${m.url}-${i}`} className="flex items-center gap-3">
                      <span className="shrink-0 overflow-hidden rounded-sm">
                        <MediaView media={m} failed={Boolean(failed[i])} onMeasure={measure(i)} onFail={fail(i)} expired={expired} />
                      </span>
                      <span className="grid min-w-0 gap-0.5 text-sm">
                        <span className="font-medium">{m.type === "video" ? t("Card {n} · Video", { n: i + 1 }) : t("Card {n} · Image", { n: i + 1 })}</span>
                        <span className="text-xs tabular-nums text-muted">{failed[i] ? expired : sizeLine(size) || t("Measuring…")}{near && !failed[i] ? ` · ${placementLabel(near, t)}` : ""}</span>
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
            {anyFailed && <p className="text-xs text-warn">{expired}.</p>}
          </div>

          <div className="grid gap-2 text-sm">
            {ad.headline && <p className="font-medium">{ad.headline}</p>}
            {ad.body && <p className="whitespace-pre-line text-muted">{ad.body}</p>}
            {ad.description && <p className="text-muted">{ad.description}</p>}
            {ad.cta && <div><Badge>{ad.cta}</Badge></div>}
            <p className="text-xs text-muted">{t("From {source} · page {name}", { source: lbl(t, SOURCE_LABEL[ad.source], ad.source), name: ad.page_name })}</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {ad.snapshot_url && <a href={ad.snapshot_url} target="_blank" rel="noopener noreferrer" className="text-sm text-accent hover:underline">{ad.network === "meta" ? t("Open in Ad Library ↗") : t("Open in TikTok ↗")}</a>}
              {ad.link_url && <a href={ad.link_url.startsWith("http") ? ad.link_url : `https://${ad.link_url}`} target="_blank" rel="noopener noreferrer" className="text-sm text-accent hover:underline [overflow-wrap:anywhere]">{t("Landing page ↗")}</a>}
            </div>
          </div>
          {ad.media_type === "video" || ad.is_video
            ? <VideoBreakdown ad={ad} preview={media[0] && !failed[0] ? media[0] : null} onScanned={onScanned} />
            : <StaticActions ad={ad} images={media.filter((m, i) => m.type === "image" && !failed[i])} />}
          <p className="text-xs text-muted">{t("Make this for {app} gives you a ready-made prompt for this kind of ad with your brand in it, a one-click image here, or a full batch in Studio ({placement}). Their name, logo, people and words are never copied.", { app: brand?.appName || t("your app"), placement: placement ? placementLabel(placement, t) : t("a placement") })}</p>
          <AdRead ad={ad} busy={busy === `decode:${ad.id}`} onReadAgain={onReadAgain} aiLocked={aiLocked} />
        </div>
        {/* Always in reach, however far the ad's details scroll. */}
        <div className="sticky bottom-0 z-10 mt-auto flex flex-wrap gap-2 border-t border-line bg-card px-4 py-2.5">
          <Button size="sm" onClick={() => setMaking(true)}>{brand?.appName ? t("Make this for {app}", { app: brand.appName }) : t("Make this for your app")}</Button>
          <Button size="sm" variant="secondary" onClick={onSend} disabled={Boolean(ad.sent_to_library_at) || busy === `send:${ad.id}`}>{ad.sent_to_library_at ? t("In format library") : t("Send to format library")}</Button>
        </div>
      </aside>
      {making && (
        <MakeForApp productId={productId} ad={ad} brand={brand} assets={assets} measured={first ?? {}}
          media={media.filter((_, i) => !failed[i])} onClose={() => setMaking(false)} onOpenRecreate={() => { setMaking(false); setRecreating(true); }} />
      )}
      {recreating && (
        <RecreateAd onMake={() => { setRecreating(false); setMaking(true); }}
          productId={productId} ad={ad} brand={brand} avatars={avatars} placement={placement} measured={first ?? {}}
          preview={media[0] && !failed[0] ? media[0] : null} onClose={() => setRecreating(false)} onScanned={onScanned}
          references={media.filter((m, i) => m.type === "image" && !failed[i]).map((m) => m.url)}
          assets={assets} onAssetAdded={onAssetAdded}
        />
      )}
    </div>
    </PanelPortal>
  );
}

// MARK: Competitors (the watchlist)

/**
 * The Competitors panel (Our Pages on the Our ads side): the product's one competitor list, kept here.
 * Adding takes a name and, optionally, a Facebook Page link or id (the precise way to pull a Page's
 * ads); without one the name is searched. Network, search terms and countries sit under More options.
 */
function Watchlist({ productId, watchlist, deleting, suggestions, own = false, tiktok, metaApi, collect, onChange, onRemove, onClose }: {
  productId: string; watchlist: WatchRow[]; deleting: Set<string>; suggestions: Suggestion[]; own?: boolean;
  /** Which sources are connected: a network that isn't is not offered, and the hints only name what works. */
  tiktok: boolean; metaApi: boolean; collect: boolean;
  onChange: () => void; onRemove: (w: WatchRow) => void; onClose: () => void;
}) {
  const { t, tn } = useT();
  const base = `/api/research/${productId}/watch`;
  const empty = { name: "", network: "meta", page: "", searchTerms: "", tiktokAdvertiserId: "", countries: "US", candidateId: "", google: "", tiktok: "" };
  const [form, setForm] = useState(empty);
  // Each source's identifier (Page, website or Google advertiser, TikTok business) as pasted, and what the edited entry had.
  const ids: CompetitorIds = { page: form.page, google: form.google, tiktok: form.tiktok };
  const [idsBefore, setIdsBefore] = useState<CompetitorIds>(EMPTY_IDS);
  const [saving, setSaving] = useState(false);
  // The entry whose Page link, search terms and countries are being changed (the form above holds them).
  const [editing, setEditing] = useState<WatchRow | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const formTop = useRef<HTMLFormElement>(null);
  const watched = new Set(watchlist.map((w) => w.name.toLowerCase()));
  const open = suggestions.filter((s) => !watched.has(s.name.toLowerCase()));

  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    const wrong = idsError(ids, t);
    if (wrong) return notice(wrong, t("Check the competitor's details"));
    setSaving(true);
    const changed = changedIds(ids, idsBefore);
    const result = editing
      ? await post(`${base}?id=${editing.id}`, { page: form.page, searchTerms: form.searchTerms, countries: form.countries, google: changed.google, tiktok: changed.tiktok }, "PATCH").catch(() => ({ error: t("Couldn't reach the server. Try again.") }))
      : await post(base, { ...form, google: changed.google, tiktok: changed.tiktok, own }).catch(() => ({ error: t("Couldn't reach the server. Try again.") }));
    setSaving(false);
    if (result.error) return notice(result.error, editing ? t("Couldn't save the changes") : own ? t("Couldn't add the Page") : t("Couldn't add the competitor"));
    setForm(empty);
    setEditing(null);
    onChange();
  }
  async function toggle(w: WatchRow) {
    if (toggling) return;
    setToggling(w.id);
    const result = await post(`${base}?id=${w.id}`, { enabled: !w.enabled }, "PATCH").catch(() => ({ error: t("Couldn't reach the server. Try again.") }));
    setToggling(null);
    if (result.error) return notice(result.error);
    onChange();
  }
  /** Puts an entry's details in the form, to change its Page link, search terms or countries. */
  function edit(w: WatchRow) {
    setEditing(w);
    const before = idsOf(w);
    setIdsBefore(before);
    setForm({ ...empty, name: w.name, network: w.network, page: before.page, google: before.google, tiktok: before.tiktok, searchTerms: w.search_terms ?? "", tiktokAdvertiserId: w.tiktok_advertiser_id ?? "", countries: w.countries.join(", ") });
    formTop.current?.scrollIntoView({ block: "nearest" });
  }
  const stopEditing = () => { setEditing(null); setForm(empty); setIdsBefore(EMPTY_IDS); };


  return (
    <PanelPortal onClose={onClose}>
    <div className={`${MODAL_OVERLAY} z-40`} onClick={onClose}>
      <aside className={`${MODAL} max-w-2xl overflow-x-hidden`} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={own ? t("Our Pages") : t("Competitors")}>
        <div className="sticky top-0 z-10 flex min-h-11 items-center justify-between gap-2 border-b border-line bg-card px-4 py-2">
          <span className="text-sm font-medium">{own ? t("Our Pages") : t("Competitors")} <span className="font-normal text-muted tabular-nums">· {watchlist.length}</span></span>
          <button type="button" onClick={onClose} className="grid size-7 place-items-center rounded-control text-muted transition hover:bg-hover hover:text-ink" aria-label={t("Close")}><IconX className="size-3.5" /></button>
        </div>
        {/* One column that can shrink: a long name is cut short in its row instead of widening the panel past its edge. */}
        <div className="grid grid-cols-1 gap-4 p-4">
          <p className="text-xs text-muted">{own ? t("Your own Facebook Page(s): their ads are saved as Our ads.") : collect ? t("One competitor list for the whole app: creative checks keep these names out of your ads, and followed ones are included when you collect automatically.") : t("One competitor list for the whole app: creative checks keep these names out of your ads, and each one's imported ads are filed under it.")}</p>

          <form ref={formTop} onSubmit={add} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {editing && <p className="text-sm font-medium sm:col-span-2 [overflow-wrap:anywhere]">{t("Editing {name}", { name: editing.name })}</p>}
            {/* The name can't change: collected and imported ads are filed under it (ad_watchlist and the ads
                point at it by name), so renaming would leave them behind. Said under the field, in words. */}
            <Field label={own ? t("Page name") : t("Name")} hint={editing ? <span className="flex items-start gap-1"><IconLock className="mt-0.5 size-3 shrink-0" />{t("The name can't be changed: its ads are filed under it. To use another name, remove it and add it again.")}</span> : undefined}><input className={inputClass} value={form.name} maxLength={120} disabled={Boolean(editing)} title={editing ? t("The name can't be changed: its ads are filed under it. To use another name, remove it and add it again.") : undefined} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={own ? "Acme" : t("A competitor's Page name")} required /></Field>
            {form.network === "meta"
              ? <CompetitorIdFields className="sm:col-span-2" ids={ids} metaOnly={own} onChange={(next) => setForm({ ...form, ...next })} />
              : <Field label={t("TikTok advertiser id")} hint={t("From library.tiktok.com (ads shown in Europe)")}><input className={inputClass} value={form.tiktokAdvertiserId} onChange={(e) => setForm({ ...form, tiktokAdvertiserId: e.target.value })} /></Field>}
            <details className="group sm:col-span-2" open={editing ? true : undefined}>
              <summary className="w-fit cursor-pointer list-none rounded-xs text-xs text-muted hover:text-ink">{t("More options")} <span aria-hidden className="inline-block transition-transform group-open:rotate-90">›</span></summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                {!editing && (tiktok || form.network === "tiktok") && (
                  <Field label={t("Network")}>
                    <select className={inputClass} value={form.network} onChange={(e) => setForm({ ...form, network: e.target.value })}><option value="meta">Meta (Facebook, Instagram)</option><option value="tiktok">TikTok</option></select>
                  </Field>
                )}
                {/* At most 100 characters (the server keeps no more): the field stops there and says so, instead of a silent cut. */}
                <Field label={t("Search terms")} hint={form.searchTerms.length >= SEARCH_TERMS_MAX - 20
                  ? <span className={cx("tabular-nums", form.searchTerms.length >= SEARCH_TERMS_MAX && "text-warn")}>{t("{n} of {max} characters", { n: form.searchTerms.length, max: SEARCH_TERMS_MAX })}</span>
                  : t("Defaults to the name. Up to {max} characters.", { max: SEARCH_TERMS_MAX })}>
                  <input className={inputClass} value={form.searchTerms} maxLength={SEARCH_TERMS_MAX} onChange={(e) => setForm({ ...form, searchTerms: e.target.value.slice(0, SEARCH_TERMS_MAX) })} />
                </Field>
                <Field label={t("Countries")} hint={metaApi ? t("Two-letter codes. EU and UK ads come from Meta's free API.") : t("Two-letter codes, for automatic collection.")}><input className={inputClass} value={form.countries} onChange={(e) => setForm({ ...form, countries: e.target.value })} placeholder="US, GB, DE" /></Field>
              </div>
            </details>
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <Button type="submit" variant="secondary" disabled={saving || !form.name.trim()}>{saving && <Spinner />}{editing ? t("Save changes") : own ? t("Add our Page") : t("Add competitor")}</Button>
              {editing && <Button variant="ghost" onClick={stopEditing} disabled={saving}>{t("Cancel")}</Button>}
            </div>
          </form>

          {open.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="eyebrow mr-1">{t("Suggested")}</span>
              {open.slice(0, 12).map((s) => (
                <button key={s.id} type="button" title={s.from === "analysis" ? t("Picked in a competitor analysis") : t("Named by the AI profile")} onClick={() => setForm({ ...empty, name: s.name, searchTerms: s.name, candidateId: s.from === "analysis" ? s.id : "" })} className="inline-flex h-6 items-center rounded-full border border-hairline bg-raised px-2.5 text-xs font-medium text-label transition-colors hover:bg-hover hover:text-ink">+ {s.name}</button>
              ))}
            </div>
          )}

          {watchlist.length > 0
            ? (
              <ul className="-mx-2 grid">
                {watchlist.map((w) => (
                  <li key={w.id} className="flex min-h-11 min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-control px-2 py-1.5 transition-colors hover:bg-hover">
                    <PageLogo pageId={w.page_id} name={w.name} size="sm" className={cx(!w.enabled && "opacity-60")} />
                    <div className="min-w-0 flex-1 basis-44">
                      <p className={cx("truncate text-sm font-medium", !w.enabled && "text-muted")} title={w.name}>{w.name} <span className="text-xs font-normal text-muted">· {w.enabled ? t(NETWORK_LABEL[w.network]) : !own && w.source && w.source !== "research" ? t("not followed") : t("paused")}{!own && w.source && w.source !== "research" ? ` · ${t(COMPETITOR_SOURCE_LABEL[w.source])}` : ""}</span></p>
                      <p className="truncate text-xs text-muted">{[w.page_id && t("Page {id}", { id: w.page_id }), w.page_url, w.website, w.google_advertiser_id && `Google ${w.google_advertiser_id}`, w.search_terms && `“${w.search_terms}”`, w.tiktok_advertiser_id && `TikTok ${w.tiktok_advertiser_id}`, w.tiktok_business_name && `TikTok “${w.tiktok_business_name}”`].filter(Boolean).join(" · ")} · {w.countries.join(", ")}</p>
                    </div>
                    <div className="ml-auto flex flex-wrap justify-end gap-1">
                      {w.network === "meta" && (
                        <a href={adLibraryLink(w).url} target="_blank" rel="noopener noreferrer" title={t("Open in the Meta Ad Library")}
                          className={buttonClass("ghost", "sm")}>{t("Ad Library")}<IconExternal /></a>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => edit(w)} aria-pressed={editing?.id === w.id} title={t("Change its Page, website, TikTok business, search terms or countries")}>{t("Edit")}</Button>
                      <Button size="sm" variant="ghost" onClick={() => toggle(w)} disabled={toggling !== null} title={w.enabled ? t("Keep its ads, stop tracking when they were last collected") : t("Track when its ads were last collected")}>{toggling === w.id ? <Spinner /> : w.enabled ? t("Pause following") : t("Follow")}</Button>
                      <Button size="sm" variant="ghost" onClick={() => onRemove(w)} disabled={deleting.has(w.id)}>{deleting.has(w.id) ? <><Spinner /> {t("Deleting…")}</> : t("Remove")}</Button>
                    </div>
                  </li>
                ))}
              </ul>
            )
            : <p className="text-sm text-muted">{own ? t("None yet.") : t("No competitors yet. Add the brands whose ads you want to follow.")}</p>}

          {!own && <p className="text-xs text-muted">{rich(t("For their organic posts, see {link}."), { link: <Link href={researchHref(productId, "social")} className="text-accent hover:underline">{t("Social posts")}</Link> })}</p>}
        </div>
      </aside>
    </div>
    </PanelPortal>
  );
}

/**
 * The import pop-up's storage check: videos over the upload limit (skipped), the room left, and how many new
 * files won't fit (left behind until competitors are deleted and the same file is imported again).
 */
function StorageCheck({ preview: p, error }: { preview: MediaPreview | null; error: string | null }) {
  const { t, tn, locale } = useT();
  const gap = sentenceGap(locale);
  // Accounts mode: the per-file limit comes with the plan, not with a Supabase project of the person's own.
  const accounts = isAccountsMode(useInstall().install);
  if (error) return <p className="mt-3 rounded-inner border border-line bg-raised px-3 py-2 text-xs text-caution-ink">{t("Couldn't check storage ({error}). The import still works; videos over the upload limit are skipped.", { error })}</p>;
  if (!p) return null;
  const s = p.storage;
  const pct = s.quotaBytes ? Math.min(100, Math.round((s.usedBytes / s.quotaBytes) * 100)) : 0;
  const after = s.usedBytes + p.fit.bytes;
  return (
    <div className="mt-3 grid gap-2 rounded-inner border border-line bg-raised px-3 py-2.5 text-xs text-muted">
      <div className="flex items-center justify-between gap-3 text-ink">
        <span className="font-medium">{t("Storage")}</span>
        <span className="tabular-nums">{t("{used} of {quota} used ({pct}%) · {free} free", { used: formatBytes(s.usedBytes), quota: formatBytes(s.quotaBytes), pct, free: formatBytes(s.roomBytes) })}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-line" aria-hidden="true">
        <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
      <p>
        {p.stored
          ? tn(p.fit.files, "This import stores {n} file ({size}); {stored} are already stored and are skipped.", "This import stores {n} files ({size}); {stored} are already stored and are skipped.", { size: formatBytes(p.fit.bytes), stored: p.stored })
          : tn(p.fit.files, "This import stores {n} file ({size}).", "This import stores {n} files ({size}).", { size: formatBytes(p.fit.bytes) })}
        {gap}{t("After it, about {after} of {quota} is used.", { after: formatBytes(after), quota: formatBytes(s.quotaBytes) })}
        {p.new.unknown > 0 && <>{gap}{tn(p.new.unknown, "{n} file didn't report a size, so it's estimated.", "{n} files didn't report a size, so they're estimated.")}</>}
      </p>
      {p.tooBig.files > 0 && (
        <p className="text-caution-ink">
          <span className="font-medium">{p.tooBig.videos === p.tooBig.files
            ? tn(p.tooBig.files, "{n} video ({size}) is over the {limit} upload limit and won't be stored.", "{n} videos ({size}) are over the {limit} upload limit and won't be stored.", { size: formatBytes(p.tooBig.bytes), limit: formatBytes(p.tooBig.limitBytes) })
            : tn(p.tooBig.files, "{n} file ({size}) is over the {limit} upload limit and won't be stored.", "{n} files ({size}) are over the {limit} upload limit and won't be stored.", { size: formatBytes(p.tooBig.bytes), limit: formatBytes(p.tooBig.limitBytes) })}</span>
          {gap}{accounts ? t("Their ads, copy and posters still are. Freeing space doesn't change this per-file limit; it comes with your plan.") : t("Their ads, copy and posters still are. Freeing space doesn't change this per-file limit; it's your Supabase project's upload limit (Storage settings).")}
        </p>
      )}
      {p.left.files > 0 && (
        <p className="text-caution-ink">
          <span className="font-medium">{tn(p.left.files, "Not enough room: {n} file ({size}) will be left behind.", "Not enough room: {n} files ({size}) will be left behind.", { size: formatBytes(p.left.bytes) })}</span>
          {gap}{t("Delete competitors you're done with, then import this same file again: only what's missing is added, and the room is checked again.")}
        </p>
      )}
      {p.tooBig.files === 0 && p.left.files === 0 && <p className="text-win">{t("Everything new fits.")}</p>}
    </div>
  );
}
