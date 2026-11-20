"use client";

// The Research page's competitor list: the free way to keep competitors' ads fresh. Each followed
// competitor has a link that opens its Ad Library page in a new tab (from its saved Page id, or a
// search for its name), how many of its ads are held here, and when they were last
// collected, as a compact grid that folds away. Opening one marks it "waiting for a file" until an import for that Page lands.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useT } from "@/lib/i18n/client";
import { adLibraryLink, FRESH_DAYS, freshness, STALE_DAYS, type Freshness, type PaidAdRow, type WatchRow } from "@/lib/research";
import { IconChevronDown, IconExternal } from "../icons";
import { Button, Card, cx, segmentClass, segmentTrackClass, Spinner, StatusPill } from "../ui";
import { PageLogo } from "./page-logo";
import { readStored, storageKey } from "@/lib/storage-keys";

const FRESH_DOT: Record<Freshness, string> = { fresh: "bg-win", due: "bg-caution", stale: "bg-warn", never: "bg-faint" };

/** A yes/no kept in this browser (the section's open state). */
function useRemembered(key: string, initial: boolean) {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    const restore = async () => {
      try { const saved = readStored(localStorage, key); if (saved != null) setValue(saved === "1"); } catch { /* not kept */ }
    };
    restore();
  }, [key]);
  const set = (next: boolean) => {
    setValue(next);
    try { localStorage.setItem(key, next ? "1" : "0"); } catch { /* not kept */ }
  };
  return [value, set] as const;
}

/** "today", "yesterday", "5 days ago", "3 weeks ago". */
function ago(at: string, now: number, t: ReturnType<typeof useT>["t"]) {
  const days = Math.floor((now - Date.parse(at)) / 86_400_000);
  if (days <= 0) return t("today");
  if (days === 1) return t("yesterday");
  if (days < 21) return t("{n} days ago", { n: days });
  return t("{n} weeks ago", { n: Math.round(days / 7) });
}

/** Which competitors were opened in the Ad Library and when, per product, kept across reloads in this browser. */
function useOpened(productId: string) {
  const key = storageKey(`research.opened.${productId}`);
  const [opened, setOpened] = useState<Record<string, number>>({});
  useEffect(() => {
    const restore = async () => {
      try { setOpened(JSON.parse(readStored(localStorage, key) ?? "{}")); } catch { /* private window: start empty */ }
    };
    restore();
  }, [key]);
  const mark = (id: string) => setOpened((o) => {
    const next = { ...o, [id]: Date.now() };
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* not kept */ }
    return next;
  });
  return [opened, mark] as const;
}

interface Row {
  w: WatchRow;
  /** The name the ad list filters on (the ads' competitor), for "Show ads". */
  filterName: string;
  /** Its Facebook Page (saved, or from its ads), for the logo. */
  pageId: string | null;
  ads: number;
  live: number;
  updatedAt: string | null;
  fresh: Freshness;
  link: { url: string; exact: boolean };
  /** A Page whose ads are here but that isn't on the list (offered with "Add"). */
  untracked?: boolean;
}

export function CompetitorBoard({ productId, watchlist, ads, lastImports, ours, dropZone, onShowAds, onManage, onAdd, onFollow, sourcesOf, onCollect }: {
  productId: string;
  /** This side's list: competitors, or our own Pages. */
  watchlist: WatchRow[];
  /** This side's ads. */
  ads: Pick<PaidAdRow, "watch_id" | "page_id" | "competitor" | "page_name" | "active" | "last_seen_at">[];
  lastImports: Record<string, string>;
  ours: boolean;
  dropZone: ReactNode;
  onShowAds: (name: string) => void;
  onManage: () => void;
  /** Puts a Page found in the ads on the list. */
  onAdd: (name: string, pageId: string) => Promise<void>;
  /** Starts following an entry that is on the list but isn't followed (typed in the app's profile, or paused). */
  onFollow: (w: WatchRow) => Promise<void>;
  /** Which sources found this competitor's ads ("Meta", "Google"), shown on its row. */
  sourcesOf?: (w: WatchRow) => string[];
  /** Collect ads: opens the collect dialog for this competitor. */
  onCollect?: (w: WatchRow) => void;
}) {
  const { t, tn } = useT();
  const freshHint = t("Green: collected in the last {fresh} days · orange: {from}–{stale} days · pink: older", { fresh: FRESH_DAYS, from: FRESH_DAYS + 1, stale: STALE_DAYS });
  const [adding, setAdding] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  const [opened, markOpened] = useOpened(productId);
  const rows = useMemo<Row[]>(() => [
    ...watchlist.filter((w) => w.network === "meta"),
    // Pages whose ads are here but that aren't on the list (say, our own Page imported without adding it).
    ...[...new Map(ads.filter((ad) => ad.page_id && !watchlist.some((w) => w.id === ad.watch_id || w.page_id === ad.page_id))
      .map((ad) => [ad.page_id!, ad])).values()]
      .map((ad): WatchRow & { untracked: true } => ({
        id: `page:${ad.page_id}`, product_id: productId, name: ad.competitor ?? ad.page_name, network: "meta", page_id: ad.page_id, page_url: null,
        search_terms: null, tiktok_advertiser_id: null, countries: [], candidate_id: null, enabled: true, created_at: "", untracked: true,
      })),
  ]
    .map((w) => {
      const own = ads.filter((ad) => ad.watch_id === w.id || (w.page_id != null && ad.page_id === w.page_id));
      // The newest scraper import for its Page, or the last time any of its ads was seen (a pull, an older import).
      const seen = own.reduce<string | null>((max, ad) => (ad.last_seen_at && (!max || ad.last_seen_at > max) ? ad.last_seen_at : max), null);
      const imported = w.page_id ? lastImports[w.page_id] ?? null : null;
      const updatedAt = [imported, seen].filter((x): x is string => Boolean(x)).sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
      return {
        w, filterName: own[0]?.competitor ?? own[0]?.page_name ?? w.name,
        pageId: w.page_id ?? own.find((ad) => ad.page_id)?.page_id ?? null,
        ads: own.length, live: own.filter((ad) => ad.active).length,
        updatedAt, fresh: freshness(updatedAt, now), link: adLibraryLink(w), untracked: "untracked" in w,
      };
    })
    // Followed first, then by name, so the list stays put while you work down it.
    .sort((a, b) => Number(b.w.enabled) - Number(a.w.enabled) || a.w.name.localeCompare(b.w.name)), [watchlist, ads, lastImports, now, productId]);

  const followed = rows.filter((r) => r.w.enabled);
  const due = followed.filter((r) => r.fresh !== "fresh");
  const [open, setOpen] = useRemembered(storageKey(`research.board.${ours ? "ours" : "theirs"}`), true);
  const [onlyDue, setOnlyDue] = useState(false);
  const list = onlyDue ? due : rows;
  // What the link on each row says: "Open" with a saved Page, "Search" without one.
  const exact = followed.some((r) => r.link.exact), searched = followed.some((r) => !r.link.exact);
  const openWord = exact && searched ? t("Open or Search") : searched ? t("Search") : t("Open");

  return (
    <Card className="mb-4 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3 py-2">
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex h-7 min-w-0 items-center gap-2 rounded-control pr-2 pl-1 text-left transition-colors hover:bg-hover">
          <IconChevronDown className={cx("size-3.5 shrink-0 text-muted transition", !open && "-rotate-90")} />
          <span className="text-sm font-medium">{ours ? t("Our Pages") : t("Competitors")}</span>
          <span className="text-xs text-muted tabular-nums">{rows.length}</span>
          {followed.length > 0 && (
            <StatusPill tone={due.length ? "caution" : "win"} className="ml-1">{due.length ? tn(due.length, "{n} needs updating", "{n} need updating") : t("All up to date")}</StatusPill>
          )}
        </button>
        <div className="flex items-center gap-1.5">
          {open && due.length > 0 && due.length < rows.length && (
            <div className={segmentTrackClass} role="group" aria-label={t("Which to show")}>
              <button type="button" aria-pressed={!onlyDue} onClick={() => setOnlyDue(false)} className={segmentClass(!onlyDue)}>{t("All")}</button>
              <button type="button" aria-pressed={onlyDue} onClick={() => setOnlyDue(true)} className={segmentClass(onlyDue)}>{t("Needs update")}</button>
            </div>
          )}
          <Button variant="secondary" size="sm" onClick={onManage}>{rows.length ? t("Add or edit") : ours ? t("Add Pages") : t("Add competitors")}</Button>
        </div>
      </div>

      {open && (
        <div className="grid gap-3 border-t border-line px-3 py-2">
          {rows.length > 0
            ? (
              <ul className={cx("grid grid-cols-1 gap-x-4 @3xl:grid-cols-2 @6xl:grid-cols-3", list.length > 12 && "max-h-[20rem] overflow-y-auto pr-1")}>
                {list.map((r) => {
                  const openedAt = opened[r.w.id];
                  // Opened since its last update: waiting for the file to be dropped.
                  const waiting = openedAt != null && (!r.updatedAt || openedAt > Date.parse(r.updatedAt)) && now - openedAt < 2 * 86_400_000;
                  // Never followed (typed in the app's profile, nothing collected yet): its Follow button says it, so no "Paused".
                  const status = !r.w.enabled ? (r.ads || r.updatedAt ? t("Paused") : null) : waiting ? t("Opened · drop its file") : r.updatedAt ? ago(r.updatedAt, now, t) : t("Never collected");
                  const pageId = r.w.page_id;
                  return (
                    <li key={r.w.id} className={cx("flex min-h-11 min-w-0 items-center gap-2.5 rounded-control px-2 py-1.5 transition-colors", waiting ? "bg-accent-soft" : "hover:bg-hover")}>
                      <span className={cx("relative shrink-0", !r.w.enabled && "opacity-60")} title={freshHint}>
                        <PageLogo pageId={r.pageId} name={r.w.name} />
                        <span className={cx("absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-card", waiting ? "bg-accent" : FRESH_DOT[r.fresh])} aria-hidden />
                      </span>
                      <button type="button" disabled={!r.ads} onClick={() => onShowAds(r.filterName)} title={r.ads ? t("Show {name}'s ads", { name: r.w.name }) : undefined}
                        className={cx("min-w-0 flex-1 rounded-xs text-left enabled:hover:[&>p:first-child]:underline disabled:cursor-default", !r.w.enabled && "opacity-60")}>
                        <p className="truncate text-sm font-medium" title={r.w.name}>{r.w.name}</p>
                        <p className={cx("truncate text-xs", waiting ? "text-accent" : "text-muted")}>
                          <span className="tabular-nums">{tn(r.ads, "{n} ad", "{n} ads")}</span>{r.ads > 0 && <> · <span className="tabular-nums">{t("{n} live", { n: r.live })}</span></>}{r.ads > 0 && sourcesOf && sourcesOf(r.w).length > 0 && <> · {sourcesOf(r.w).join(", ")}</>}{status && <> · {status}</>}
                        </p>
                      </button>
                      {r.untracked && pageId && (
                        <Button size="sm" variant="ghost" disabled={adding !== null} title={t("Not on the list yet: add {name} to keep track of it", { name: r.w.name })}
                          onClick={async () => { setAdding(r.w.id); await onAdd(r.w.name, pageId); setAdding(null); }}>
                          {adding === r.w.id ? <Spinner /> : t("Add")}
                        </Button>
                      )}
                      {!r.w.enabled && !r.untracked && (
                        <Button size="sm" variant="ghost" disabled={adding !== null} title={t("Follow {name}: keeps track of when its ads were last collected", { name: r.w.name })}
                          onClick={async () => { setAdding(r.w.id); await onFollow(r.w); setAdding(null); }}>
                          {adding === r.w.id ? <Spinner /> : t("Follow")}
                        </Button>
                      )}
                      {onCollect && !r.untracked && (
                        <Button size="sm" variant="ghost" onClick={() => onCollect(r.w)} title={t("Collect {name}'s ads with the sources that are on: you see what it costs first", { name: r.w.name })}>{t("Collect")}</Button>
                      )}
                      <a href={r.link.url} target="_blank" rel="noopener noreferrer" onClick={() => markOpened(r.w.id)}
                        title={r.link.exact ? t("Open {name}'s ads in the Meta Ad Library", { name: r.w.name }) : t("No Page saved: searches the Ad Library for “{terms}”. Add its Page link under Add or edit to open its own page.", { terms: r.w.search_terms || r.w.name })}
                        aria-label={t("Open {name} in the Ad Library", { name: r.w.name })}
                        className={cx("inline-flex h-7 shrink-0 items-center gap-1 rounded-control px-2 text-xs font-medium transition-colors [&_svg]:size-3.5",
                          r.w.enabled && r.fresh !== "fresh" && !waiting ? "bg-accent-soft text-accent hover:bg-accent-soft/70" : "border border-hairline bg-raised text-ink hover:bg-hover")}>
                        {r.link.exact ? t("Open") : t("Search")}<IconExternal />
                      </a>
                    </li>
                  );
                })}
              </ul>
            )
            : <p className="text-sm text-muted">{ours ? t("Add your own Facebook Page to see your ads next to theirs.") : t("Add the competitors whose ads you want to follow. Then open each one in the Ad Library and collect its ads.")}</p>}
          {dropZone}
          {followed.length > 0 && <p className="text-xs text-faint">{t("To refresh one: click {open}, click “Collect ads” in the Ad Library extension, then drop the saved file above. Click a name to see its ads.", { open: openWord })}</p>}
        </div>
      )}
    </Card>
  );
}
