"use client";

// The Research page's competitor list: the free way to keep competitors' ads fresh. Each followed
// competitor has a link that opens its Ad Library page in a new tab (from its saved Page id, or a
// search for its name), how many of its ads are held here, and when they were last
// collected, as a compact grid that folds away. Opening one marks it "waiting for a file" until an import for that Page lands.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { adLibraryLink, FRESH_DAYS, freshness, STALE_DAYS, type Freshness, type PaidAdRow, type WatchRow } from "@/lib/research";
import { IconChevronDown, IconExternal } from "../icons";
import { Button, Card, cx, segmentClass, segmentTrackClass, Spinner, StatusPill } from "../ui";
import { PageLogo } from "./page-logo";
import { readStored, storageKey } from "@/lib/storage-keys";

const FRESH_DOT: Record<Freshness, string> = { fresh: "bg-win", due: "bg-caution", stale: "bg-warn", never: "bg-faint" };
const FRESH_HINT = `Green: collected in the last ${FRESH_DAYS} days · orange: ${FRESH_DAYS + 1}–${STALE_DAYS} days · pink: older`;

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
function ago(at: string, now: number) {
  const days = Math.floor((now - Date.parse(at)) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 21) return `${days} days ago`;
  return `${Math.round(days / 7)} weeks ago`;
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

export function CompetitorBoard({ productId, watchlist, ads, lastImports, ours, dropZone, onShowAds, onManage, onAdd, onFollow }: {
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
}) {
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
  const noun = ours ? "Page" : "competitor";
  const [open, setOpen] = useRemembered(storageKey(`research.board.${ours ? "ours" : "theirs"}`), true);
  const [onlyDue, setOnlyDue] = useState(false);
  const list = onlyDue ? due : rows;
  // What the link on each row says: "Open" with a saved Page, "Search" without one.
  const exact = followed.some((r) => r.link.exact), searched = followed.some((r) => !r.link.exact);
  const openWord = exact && searched ? "Open or Search" : searched ? "Search" : "Open";

  return (
    <Card className="mb-4 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3">
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="-ml-1 flex min-w-0 items-center gap-2 rounded-control py-1 pr-2 pl-1 text-left transition hover:bg-hover">
          <IconChevronDown className={cx("size-4 shrink-0 text-muted transition", !open && "-rotate-90")} />
          <span className="text-title font-medium">{ours ? "Our Pages" : "Competitors"}</span>
          <span className="text-sm text-muted tabular-nums">{rows.length}</span>
          {followed.length > 0 && (
            <StatusPill tone={due.length ? "caution" : "win"} className="ml-1">{due.length ? `${due.length} need${due.length === 1 ? "s" : ""} updating` : "All up to date"}</StatusPill>
          )}
        </button>
        <div className="flex items-center gap-1.5">
          {open && due.length > 0 && due.length < rows.length && (
            <div className={segmentTrackClass} role="group" aria-label="Which to show">
              <button type="button" aria-pressed={!onlyDue} onClick={() => setOnlyDue(false)} className={segmentClass(!onlyDue)}>All</button>
              <button type="button" aria-pressed={onlyDue} onClick={() => setOnlyDue(true)} className={segmentClass(onlyDue)}>Needs update</button>
            </div>
          )}
          <Button variant="secondary" size="sm" onClick={onManage}>{rows.length ? "Add or edit" : `Add ${noun}s`}</Button>
        </div>
      </div>

      {open && (
        <div className="grid gap-3 border-t border-line px-4 py-3">
          {rows.length > 0
            ? (
              <ul className={cx("grid grid-cols-1 gap-2 @xl:grid-cols-2 @4xl:grid-cols-3 @7xl:grid-cols-4", list.length > 12 && "max-h-[19rem] overflow-y-auto pr-1")}>
                {list.map((r) => {
                  const openedAt = opened[r.w.id];
                  // Opened since its last update: waiting for the file to be dropped.
                  const waiting = openedAt != null && (!r.updatedAt || openedAt > Date.parse(r.updatedAt)) && now - openedAt < 2 * 86_400_000;
                  // Never followed (typed in the app's profile, nothing collected yet): its Follow button says it, so no "Paused".
                  const status = !r.w.enabled ? (r.ads || r.updatedAt ? "Paused" : null) : waiting ? "Opened · drop its file" : r.updatedAt ? ago(r.updatedAt, now) : "Never collected";
                  const pageId = r.w.page_id;
                  return (
                    <li key={r.w.id} className={cx("flex min-w-0 items-center gap-2 rounded-inner border bg-raised py-2 pr-2 pl-3", waiting ? "border-accent/40" : "border-line")}>
                      <span className={cx("relative shrink-0", !r.w.enabled && "opacity-60")} title={FRESH_HINT}>
                        <PageLogo pageId={r.pageId} name={r.w.name} />
                        <span className={cx("absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-raised", waiting ? "bg-accent" : FRESH_DOT[r.fresh])} aria-hidden />
                      </span>
                      <button type="button" disabled={!r.ads} onClick={() => onShowAds(r.filterName)} title={r.ads ? `Show ${r.w.name}'s ads` : undefined}
                        className={cx("min-w-0 flex-1 rounded-xs text-left enabled:hover:[&>p:first-child]:underline disabled:cursor-default", !r.w.enabled && "opacity-60")}>
                        <p className="truncate text-sm font-medium" title={r.w.name}>{r.w.name}</p>
                        <p className={cx("truncate text-xs", waiting ? "text-accent" : "text-muted")}>
                          <span className="tabular-nums">{r.ads.toLocaleString()}</span> ads{r.ads > 0 && <> · <span className="tabular-nums">{r.live.toLocaleString()}</span> live</>}{status && <> · {status}</>}
                        </p>
                      </button>
                      {r.untracked && pageId && (
                        <Button size="sm" variant="ghost" disabled={adding !== null} title={`Not on the list yet: add ${r.w.name} to keep track of it`}
                          onClick={async () => { setAdding(r.w.id); await onAdd(r.w.name, pageId); setAdding(null); }}>
                          {adding === r.w.id ? <Spinner /> : "Add"}
                        </Button>
                      )}
                      {!r.w.enabled && !r.untracked && (
                        <Button size="sm" variant="ghost" disabled={adding !== null} title={`Follow ${r.w.name}: keeps track of when its ads were last collected`}
                          onClick={async () => { setAdding(r.w.id); await onFollow(r.w); setAdding(null); }}>
                          {adding === r.w.id ? <Spinner /> : "Follow"}
                        </Button>
                      )}
                      <a href={r.link.url} target="_blank" rel="noopener noreferrer" onClick={() => markOpened(r.w.id)}
                        title={r.link.exact ? `Open ${r.w.name}'s ads in the Meta Ad Library` : `No Page saved: searches the Ad Library for “${r.w.search_terms || r.w.name}”. Add its Page link under Add or edit to open its own page.`}
                        aria-label={`Open ${r.w.name} in the Ad Library`}
                        className={cx("inline-flex h-7 shrink-0 items-center gap-1 rounded-control px-2 text-xs font-medium transition-colors [&_svg]:size-3.5",
                          r.w.enabled && r.fresh !== "fresh" && !waiting ? "bg-accent-soft text-accent hover:bg-accent-soft/70" : "border border-hairline bg-raised text-ink hover:bg-hover")}>
                        {r.link.exact ? "Open" : "Search"}<IconExternal />
                      </a>
                    </li>
                  );
                })}
              </ul>
            )
            : <p className="text-sm text-muted">{ours ? "Add your own Facebook Page to see your ads next to theirs." : "Add the competitors whose ads you want to follow. Then open each one in the Ad Library and collect its ads."}</p>}
          {dropZone}
          {followed.length > 0 && <p className="text-xs text-faint">To refresh one: click {openWord}, click <span className="text-label">Collect ads</span> in the Ad Library extension, then drop the saved file above. Click a name to see its ads.</p>}
        </div>
      )}
    </Card>
  );
}
