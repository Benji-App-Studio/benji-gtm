"use client";
// Research's "Get ads" panel, while no competitor ads are in: the best way this account has, picked by
// itself (lib/onboarding.ts adsRoute). With an Apify key, one button collects them; with Meta's Ad Library
// key, the same button (free, ads shown in the EU and the UK); otherwise the free Chrome extension in three
// short steps with a small moving picture each, its download already pointing at this dashboard
// (app/api/extension), and the drop zone for the file it saves. The full guide with screenshots stays in
// Settings > Ad Library extension.
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { EXTENSION_GUIDE, EXTENSION_ZIP_PERSONAL } from "@/lib/extension-download";
import { useT } from "@/lib/i18n/client";
import type { AdsRoute } from "@/lib/onboarding";
import { adLibraryLink, type WatchRow } from "@/lib/research";
import { IconCheck, IconCopy, IconDownload, IconExternal, IconPlus } from "../icons";
import { Button, buttonClass, Card, cx, Spinner } from "../ui";

export function GetAds({ route, watchlist, running, onCollect, onAddCompetitor, dropZone }: {
  route: AdsRoute;
  /** The competitors on the list (Meta ones get an "Open" button for the extension). */
  watchlist: Pick<WatchRow, "id" | "name" | "page_id" | "search_terms" | "network" | "enabled">[];
  running: boolean;
  /** Collect these list entries (the followed ones, else every one on the list: the plan takes named entries even when paused). */
  onCollect: (ids: string[]) => void;
  onAddCompetitor: () => void;
  /** The drop zone for the extension's file (research-ads.tsx owns the import). */
  dropZone: ReactNode;
}) {
  const { t } = useT();
  const meta = watchlist.filter((w) => w.network === "meta");
  const none = watchlist.length === 0;
  const followed = watchlist.filter((w) => w.enabled);
  const targets = (followed.length ? followed : watchlist).map((w) => w.id);

  return (
    <Card className="mb-5 p-4" aria-labelledby="get-ads-title">
      <h2 id="get-ads-title" className="text-title font-medium">{t("Get your competitors' ads")}</h2>
      {route === "extension" ? (
        <p className="mt-1 max-w-2xl text-sm text-muted">{t("Meta only shows its Ad Library to people, not to other websites, so a free Chrome extension reads it in your browser and saves the ads as a file you drop here.")}</p>
      ) : route === "collect" ? (
        <p className="mt-1 max-w-2xl text-sm text-muted">{t("Your Apify key collects their ads for you, in any country. You see what it can cost before it starts.")}</p>
      ) : (
        <p className="mt-1 max-w-2xl text-sm text-muted">{t("Your Meta Ad Library key brings in their ads for free. Meta's API only covers ads shown in the EU and the UK.")}</p>
      )}

      {none ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button onClick={onAddCompetitor} data-guide="ads"><IconPlus />{t("Add a competitor")}</Button>
          <span className="text-xs text-muted">{t("Start with one: whose ads would you like to see?")}</span>
        </div>
      ) : route !== "extension" ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button onClick={() => onCollect(targets)} disabled={running} data-guide="ads">{running ? <><Spinner className="size-3.5" />{t("Collecting…")}</> : t("Collect their ads")}</Button>
          <span className="text-xs text-muted">{t("Usually one to five minutes. The ads show up here as they come in.")}</span>
        </div>
      ) : (
        <ol className="mt-4 grid gap-3 @3xl:grid-cols-3">
          <Step n={1} title={t("Add the free extension to Chrome")} picture={<PictureInstall />}>
            <p>{t("Download it, unzip it, open Chrome's extensions page, turn on Developer mode and click Load unpacked.")}</p>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <a href={EXTENSION_ZIP_PERSONAL} download className={buttonClass("primary", "sm")} data-guide="ads"><IconDownload />{t("Download")}</a>
              <CopyChip value="chrome://extensions" />
            </div>
            <p className="mt-2 text-xs"><Link href={EXTENSION_GUIDE} className="font-medium text-accent hover:underline">{t("Every click, with pictures")}</Link></p>
          </Step>
          <Step n={2} title={t("Open a competitor, then press Collect ads")} picture={<PictureCollect />}>
            <p>{t("Their ads open in Meta's Ad Library. Click the extension's orange icon, then Collect ads.")}</p>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {meta.slice(0, 4).map((w) => (
                <a key={w.id} href={adLibraryLink(w).url} target="_blank" rel="noopener noreferrer" className={cx(buttonClass("secondary", "sm"), "max-w-full min-w-0")}>
                  <span className="max-w-36 truncate">{t("Open {name}", { name: w.name })}</span><IconExternal />
                </a>
              ))}
            </div>
          </Step>
          <Step n={3} title={t("Drop the file here")} picture={<PictureDrop />}>
            <p>{t("It's saved in Downloads, in the Ad Library folder. Drop it anywhere on this page.")}</p>
            <div className="mt-2.5">{dropZone}</div>
          </Step>
        </ol>
      )}
    </Card>
  );
}

function Step({ n, title, picture, children }: { n: number; title: string; picture: ReactNode; children: ReactNode }) {
  return (
    <li className="flex min-w-0 flex-col rounded-inner border border-line bg-raised p-3">
      <div aria-hidden className="mb-3 h-20 overflow-hidden rounded-small border border-line bg-canvas">{picture}</div>
      <p className="flex items-center gap-2 text-sm font-medium">
        <span className="grid size-5 shrink-0 place-items-center rounded-full bg-control text-[11px] font-medium text-label tabular-nums">{n}</span>{title}
      </p>
      <div className="mt-1 text-sm text-muted">{children}</div>
    </li>
  );
}

function CopyChip({ value }: { value: string }) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  return (
    <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* select by hand */ } }}
      className="inline-flex h-7 min-w-0 items-center gap-1.5 rounded-control border border-hairline bg-canvas px-2 font-mono text-xs text-ink hover:bg-hover" title={t("Copy")}>
      <span className="truncate">{value}</span>{copied ? <IconCheck className="size-3 shrink-0 text-win" /> : <IconCopy className="size-3 shrink-0 text-muted" />}
    </button>
  );
}

// MARK: The small pictures (drawn, so they follow the theme; still with reduced motion)

/** A browser bar with the extensions page's Developer mode switch, and a pointer moving to it. */
function PictureInstall() {
  return (
    <div className="relative h-full w-full p-2.5">
      <div className="flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-hairline" /><span className="size-1.5 rounded-full bg-hairline" /><span className="h-3 flex-1 rounded-full bg-control" /></div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="h-2 w-16 rounded-full bg-control" />
        <span className="flex items-center gap-1"><span className="h-1.5 w-8 rounded-full bg-control" /><span className="relative h-3 w-5 rounded-full bg-accent-fill"><span className="absolute top-0.5 right-0.5 size-2 rounded-full bg-canvas" /></span></span>
      </div>
      <div className="mt-2 flex gap-1.5"><span className="h-4 w-14 rounded-[4px] border border-accent bg-accent-soft" /><span className="h-4 w-10 rounded-[4px] border border-line" /></div>
      <Pointer className="top-10 left-6" toX={10} toY={-2} />
    </div>
  );
}

/** An ad grid with the orange extension icon in the bar, and a pointer moving to it. */
function PictureCollect() {
  return (
    <div className="relative h-full w-full p-2.5">
      <div className="flex items-center gap-1.5"><span className="h-3 flex-1 rounded-full bg-control" /><span className="size-3 rounded-[4px] bg-[#f97316]" /></div>
      <div className="mt-2 grid grid-cols-4 gap-1.5">{[0, 1, 2, 3].map((i) => <span key={i} className="h-9 rounded-[4px] bg-control" />)}</div>
      <Pointer className="top-11 left-1/2" toX={38} toY={-30} />
    </div>
  );
}

/** A file dropping into a dashed box. */
function PictureDrop() {
  return (
    <div className="grid h-full w-full place-items-center p-2.5">
      <div className="relative grid h-12 w-32 place-items-center rounded-small border border-dashed border-hairline">
        <span className="get-ads-drop flex h-6 w-5 items-end justify-center rounded-[3px] border border-line bg-raised pb-0.5 text-[7px] font-medium text-muted">JSON</span>
      </div>
    </div>
  );
}

function Pointer({ className, toX, toY }: { className: string; toX: number; toY: number }) {
  return (
    <svg viewBox="0 0 12 16" className={cx("get-ads-cursor absolute size-3.5 text-ink drop-shadow-sm", className)} style={{ ["--to-x" as string]: `${toX}px`, ["--to-y" as string]: `${toY}px` }}>
      <path d="M1 1 L1 13 L4 10 L6.5 15 L8.5 14 L6 9 L10.5 9 Z" fill="currentColor" stroke="var(--color-canvas)" strokeWidth="1" />
    </svg>
  );
}
