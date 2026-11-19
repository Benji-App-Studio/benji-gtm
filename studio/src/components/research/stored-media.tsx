"use client";
// Research → Ads: the "Stored media" line. An import saves its ads' images and videos to storage (the
// Ad Library's links expire after some days); this shows how far that got, refreshes every 20 s while
// files are waiting, and deletes the stored copies, all of them or one advertiser's, when asked. They
// are never deleted otherwise.
import { useEffect, useRef, useState } from "react";
import { formatBytes, storedMediaLine, type MediaCounts, type MediaStatus } from "@/lib/ad-media";
import { ask, Facts, notice } from "../dialog";
import { IconStack } from "../icons";
import { Button, cx, Spinner } from "../ui";

const POLL_MS = 20_000;
const n = (value: number) => value.toLocaleString();
const filesOf = (c: MediaCounts) => c.queued + c.downloading + c.done + c.failed;

async function post<T>(url: string, body: unknown): Promise<T & { error?: string }> {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  const data = await response?.json().catch(() => null);
  if (!response?.ok || !data) return { ...(data ?? {}), error: data?.error ?? "Couldn't reach the server. Try again." } as T & { error: string };
  return data;
}

export function StoredMediaCard({ productId, status: initial, advertisers, onChanged, className }: {
  productId: string;
  status: MediaStatus | null | undefined;
  /** Advertiser names by Page id. */
  advertisers: Record<string, string>;
  /** Stored files changed (the backlog finished, or some were deleted): reload the ads to show them. */
  onChanged: () => void;
  className?: string;
}) {
  const url = `/api/research/${productId}`;
  // A poll's answer holds until the page hands in fresher data.
  const [polled, setPolled] = useState<{ base: MediaStatus | null | undefined; value: MediaStatus } | null>(null);
  const status = polled && polled.base === initial ? polled.value : initial;
  const [busy, setBusy] = useState<string | null>(null);
  const working = Boolean(status && status.queued + status.downloading > 0);
  const changed = useRef(onChanged);
  useEffect(() => { changed.current = onChanged; }, [onChanged]);

  useEffect(() => {
    if (!working) return;
    const timer = setInterval(async () => {
      const fresh = await post<MediaStatus>(url, { action: "media-status" });
      if (fresh.error || typeof fresh.queued !== "number") return;
      setPolled({ base: initial, value: fresh });
      if (fresh.queued + fresh.downloading === 0) changed.current();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [working, url, initial]);

  if (!status || !status.files) return null;
  const { line } = storedMediaLine(status);
  const pages = status.pages.filter((p) => filesOf(p) > 0);
  const name = (pageId: string | null) => (pageId && advertisers[pageId]) || (pageId ? `Page ${pageId}` : "Other advertisers");

  async function clear(pageId: string | null | "all") {
    const scope = pageId === "all" ? pages : pages.filter((p) => p.pageId === pageId);
    const files = scope.reduce((sum, p) => sum + filesOf(p), 0);
    const bytes = scope.reduce((sum, p) => sum + p.bytes, 0);
    const names = scope.map((p) => name(p.pageId));
    const ok = await ask({
      title: pageId === "all" && names.length > 1 ? "Delete all stored media?" : `Delete ${names[0] ?? "the"}'s stored media?`,
      confirm: `Delete ${n(files)} file${files === 1 ? "" : "s"}`,
      danger: true,
      body: (
        <Facts
          rows={[["Advertiser" + (names.length > 1 ? "s" : ""), names.join(", ")], ["Files", n(files)], ["Size", formatBytes(bytes)]]}
          note="The images and videos are deleted from storage. The ads stay in the list and fall back to their Ad Library links, which stop working after a few days. Collect the ads again and import the file to save them again."
        />
      ),
    });
    if (!ok) return;
    setBusy(pageId ?? "none");
    // "all" also takes the files of ads without a Page id.
    const result = await post<{ files?: number }>(url, { action: "media-clear", ...(pageId && pageId !== "all" ? { pageId } : {}) });
    if (result.error) {
      setBusy(null);
      return notice(result.error, "Couldn't delete the stored media");
    }
    setBusy(null);
    changed.current();
  }

  return (
    <div className={cx("grid gap-1.5 rounded-inner border border-line bg-card py-1.5 pr-1.5 pl-3 text-xs leading-relaxed", className)} role="region" aria-label="Stored media">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <p className="flex min-w-0 items-center gap-2.5 py-1">
          {working ? <Spinner className="shrink-0 text-muted" /> : <IconStack className="size-4 shrink-0 text-faint" />}
          <span><span className="font-medium text-ink">Stored media</span> <span className="text-muted tabular-nums">· {line}</span></span>
        </p>
        {pages.length <= 1 && (
          <Button size="sm" variant="ghost" onClick={() => clear("all")} disabled={busy != null}>{busy ? <><Spinner /> Deleting…</> : "Delete stored media"}</Button>
        )}
      </div>
      {status.failed > 0 && <p className="pr-1.5 pl-6.5 text-muted">{n(status.failed)} file{status.failed === 1 ? "" : "s"} couldn&apos;t be saved. Either their link expired before they were saved (collect the advertiser&apos;s ads again and import the file), or they&apos;re videos over the storage upload limit, which aren&apos;t stored (their ads and posters are).</p>}
      {pages.length > 1 && (
        <ul className="grid divide-y divide-line border-t border-line">
          {pages.map((p) => (
            <li key={p.pageId ?? "none"} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
              <span className="min-w-0 text-ink [overflow-wrap:anywhere]">{name(p.pageId)}</span>
              <span className="flex items-center gap-3">
                <span className="tabular-nums text-muted">
                  {n(p.done)} of {n(filesOf(p))} stored · {formatBytes(p.bytes)}{p.failed ? ` · ${n(p.failed)} failed` : ""}
                </span>
                {p.pageId && (
                  <Button size="sm" variant="ghost" onClick={() => clear(p.pageId)} disabled={busy != null}>{busy === p.pageId ? <><Spinner /> Deleting…</> : "Delete"}</Button>
                )}
              </span>
            </li>
          ))}
          <li className="flex justify-end pt-2">
            <Button size="sm" variant="ghost" onClick={() => clear("all")} disabled={busy != null}>{busy === "all" ? <><Spinner /> Deleting…</> : "Delete all stored media"}</Button>
          </li>
        </ul>
      )}
    </div>
  );
}
