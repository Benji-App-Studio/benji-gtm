"use client";
// Settings → Storage: how much of the Supabase plan's storage is used (a bar against the quota), where
// it goes (by kind and by app), and the cleanups. Every cleanup is previewed first: the confirm says
// exactly what will be deleted and how much space it frees, then the backend removes the files and the
// database rows that point at them (supabase/functions/install/storage.ts). Linear style: settings groups
// of rows, one accent action per row at most.
import Link from "next/link";
import { useState } from "react";
import {
  CLEANUP_LABEL, cleanupSentence, formatBytes, KIND_LABEL, limitMb, noticeText, percent, type CleanupAction, type CleanupPreview, type StorageKind, type StorageSummary,
} from "@/lib/storage-usage";
import { refreshStorage, useStorage } from "@/lib/use-storage";
import { repoFileUrl } from "@/lib/brand-config";
import { ask, notice } from "../dialog";
import { IconExternal } from "../icons";
import { Button, cx, ErrorNote, inputClass, SettingsGroup, SettingsRow, Spinner } from "../ui";
import { api, SettingsPage, SettingsRowsSkeleton } from "./settings-ui";

const KINDS: StorageKind[] = ["competitor_media", "creatives", "uploads", "other"];
const KIND_HINT: Record<StorageKind, string> = {
  competitor_media: "Saved copies of competitors' ad images and videos, so they don't expire.",
  creatives: "Images and videos made in Studio and Playground.",
  uploads: "Your product images, brand files, fonts and Playground uploads.",
  other: "Thumbnails and the Style Library images.",
};

export function StorageSettings() {
  const { summary, error, loading } = useStorage();
  return (
    <SettingsPage page="storage">
      {loading ? <SettingsRowsSkeleton groups={3} rows={3} /> : !summary ? (
        <ErrorNote title="Storage couldn't be measured">{error ?? "Try again in a moment."}</ErrorNote>
      ) : <StorageBody summary={summary} />}
    </SettingsPage>
  );
}

function UsageBar({ summary }: { summary: StorageSummary }) {
  const width = Math.min(100, Math.max(summary.usedBytes > 0 ? 1 : 0, summary.ratio * 100));
  const tone = summary.level === "full" || summary.level === "warn" ? "bg-warn" : summary.level === "notice" ? "bg-caution" : "bg-accent";
  return (
    <div className="grid gap-2 px-4 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-ink tabular-nums">{formatBytes(summary.usedBytes)} of {formatBytes(summary.quotaBytes)} used</span>
        <span className="text-xs text-muted tabular-nums">{percent(summary.ratio)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-control" role="progressbar" aria-label="Storage used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(summary.ratio * 100)}>
        <div className={cx("h-full rounded-full transition-[width]", tone)} style={{ width: `${width}%` }} />
      </div>
      {noticeText(summary) && <p className={cx("text-xs", summary.level === "notice" ? "text-caution-ink" : "text-warn")}>{noticeText(summary)} {summary.level !== "notice" ? "Delete something below, or upgrade your Supabase plan." : "Nothing is blocked yet."}</p>}
    </div>
  );
}

function StorageBody({ summary }: { summary: StorageSummary }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [days, setDays] = useState({ unused: 30, media: 90 });

  /** Preview, confirm with the exact sentence, then run. */
  async function clean(action: CleanupAction, o: { appId?: string; appName?: string; days?: number } = {}) {
    const key = `${action}:${o.appId ?? ""}`;
    setBusy(key);
    const body = { action, appId: o.appId, days: o.days };
    const preview = await api<CleanupPreview>("/api/storage/cleanup", "POST", body);
    if (!preview.ok) { setBusy(null); return notice(preview.error); }
    if (!preview.data.files && !preview.data.items) { setBusy(null); return notice("There's nothing to delete for this right now.", "Nothing to delete"); }
    const sentence = cleanupSentence(preview.data, o.appName, o.days);
    const ok = await ask({ title: CLEANUP_LABEL[action], body: <p className="text-sm text-label">{sentence}</p>, confirm: `Delete and free ${formatBytes(preview.data.bytes)}`, danger: true });
    if (!ok) { setBusy(null); return; }
    const done = await api<CleanupPreview>("/api/storage/cleanup", "POST", { ...body, run: true });
    setBusy(null);
    await refreshStorage();
    if (!done.ok) return notice(done.error);
    void notice(`Freed ${formatBytes(done.data.bytes)} (${done.data.files.toLocaleString("en-US")} file${done.data.files === 1 ? "" : "s"}).`, "Done");
  }
  const spinning = (action: CleanupAction, appId = "") => busy === `${action}:${appId}`;
  const dayInput = (value: number, onChange: (n: number) => void, label: string) => (
    <input type="number" min={7} max={3650} value={value} aria-label={label} onChange={(e) => onChange(Math.max(7, Math.min(3650, Number(e.target.value) || 7)))} className={cx(inputClass, "h-7 w-16! px-2 py-1 text-xs tabular-nums")} />
  );

  return (
    <div className="grid gap-10">
      <SettingsGroup title="Usage" description={<>Your Supabase plan includes {formatBytes(summary.quotaBytes)} of storage; one file can be up to {limitMb(summary.uploadLimitBytes)}.</>}>
        <UsageBar summary={summary} />
        {KINDS.filter((k) => summary.byKind[k] > 0 || k !== "other").map((k) => (
          <SettingsRow key={k} label={KIND_LABEL[k]} description={KIND_HINT[k]}>
            <span className="text-sm text-ink tabular-nums">{formatBytes(summary.byKind[k])}</span>
          </SettingsRow>
        ))}
      </SettingsGroup>

      <SettingsGroup title="By app" description="Each app keeps its files in its own folder, so it can be measured and cleared on its own.">
        {summary.apps.length === 0 && summary.orphans.length === 0 && <SettingsRow label="No app files yet" description="Files appear here once you collect ads, upload images or generate creatives." />}
        {summary.apps.map((a) => (
          <SettingsRow key={a.appId} label={a.name}
            description={[a.byKind.competitor_media ? `${formatBytes(a.byKind.competitor_media)} competitors' media` : "", a.byKind.creatives ? `${formatBytes(a.byKind.creatives)} creatives` : "", a.byKind.uploads ? `${formatBytes(a.byKind.uploads)} uploads` : ""].filter(Boolean).join(" · ") || "No files"}>
            <span className="text-sm text-ink tabular-nums">{formatBytes(a.bytes)}</span>
            {Boolean(a.byKind.competitor_media) && (
              <Button size="sm" variant="secondary" disabled={Boolean(busy)} onClick={() => clean("app_media", { appId: a.appId, appName: a.name })}>
                {spinning("app_media", a.appId) && <Spinner className="size-3.5" />}Delete competitor media
              </Button>
            )}
          </SettingsRow>
        ))}
        {summary.orphans.map((o) => (
          <SettingsRow key={o.appId} label="Files of a deleted app" description={`${o.files.toLocaleString("en-US")} files left behind by an app deleted before its files were removed with it.`}>
            <span className="text-sm text-ink tabular-nums">{formatBytes(o.bytes)}</span>
            <Button size="sm" variant="secondary" disabled={Boolean(busy)} onClick={() => clean("app_files", { appId: o.appId, appName: "the deleted app" })}>
              {spinning("app_files", o.appId) && <Spinner className="size-3.5" />}Remove
            </Button>
          </SettingsRow>
        ))}
      </SettingsGroup>

      <SettingsGroup title="Free up space" description="Each one shows exactly what it deletes and how much it frees before anything goes. Deleting an app (in its settings) removes all its files.">
        <SettingsRow label="Rejected creatives" description="Creatives you marked rejected in Studio. Anything sent to Meta is kept.">
          <Button size="sm" variant="secondary" disabled={Boolean(busy)} onClick={() => clean("rejected_creatives")}>{spinning("rejected_creatives") && <Spinner className="size-3.5" />}Delete</Button>
        </SettingsRow>
        <SettingsRow label="Unused creatives" description={<span className="inline-flex flex-wrap items-center gap-1.5">Never approved or sent to Meta, older than {dayInput(days.unused, (n) => setDays((d) => ({ ...d, unused: n })), "Days")} days.</span>}>
          <Button size="sm" variant="secondary" disabled={Boolean(busy)} onClick={() => clean("unused_creatives", { days: days.unused })}>{spinning("unused_creatives") && <Spinner className="size-3.5" />}Delete</Button>
        </SettingsRow>
        <SettingsRow label="Old saved media" description={<span className="inline-flex flex-wrap items-center gap-1.5">Competitors&apos; saved ad images and videos older than {dayInput(days.media, (n) => setDays((d) => ({ ...d, media: n })), "Days")} days. The ads stay, with their text and links.</span>}>
          <Button size="sm" variant="secondary" disabled={Boolean(busy)} onClick={() => clean("old_media", { days: days.media })}>{spinning("old_media") && <Spinner className="size-3.5" />}Delete</Button>
        </SettingsRow>
      </SettingsGroup>

      <p className="text-xs text-muted">
        What fills space and when to upgrade:{" "}
        <Link href={repoFileUrl("docs/TROUBLESHOOTING.md#running-out-of-space")} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-xs font-medium text-accent hover:underline">Running out of space<IconExternal className="size-3" /></Link>
      </p>
    </div>
  );
}
