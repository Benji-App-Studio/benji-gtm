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
import { useT } from "@/lib/i18n/client";
import { sentenceGap } from "../rich";
import { m } from "@/lib/i18n/translate";
import { refreshStorage, useStorage } from "@/lib/use-storage";
import { repoFileUrl } from "@/lib/brand-config";
import { ask, notice } from "../dialog";
import { IconExternal } from "../icons";
import { Button, cx, ErrorNote, inputClass, SettingsGroup, SettingsRow, Spinner } from "../ui";
import { api, sayError, SettingsPage, SettingsRowsSkeleton } from "./settings-ui";

const KINDS: StorageKind[] = ["competitor_media", "creatives", "uploads", "other"];
const KIND_HINT: Record<StorageKind, string> = {
  competitor_media: m("Saved copies of competitors' ad images and videos, so they don't expire."),
  creatives: m("Images and videos made in the Studio."),
  uploads: m("Your product images, brand files, fonts and Remix uploads."),
  other: m("Thumbnails and the Style Library images."),
};

export function StorageSettings() {
  const { t } = useT();
  const { summary, error, loading } = useStorage();
  return (
    <SettingsPage page="storage">
      {loading ? <SettingsRowsSkeleton groups={3} rows={3} /> : !summary ? (
        <ErrorNote title={t("Storage couldn't be measured")}>{error ?? t("Try again in a moment.")}</ErrorNote>
      ) : <StorageBody summary={summary} />}
    </SettingsPage>
  );
}

function UsageBar({ summary }: { summary: StorageSummary }) {
  const { t, locale } = useT();
  const gap = sentenceGap(locale);
  const width = Math.min(100, Math.max(summary.usedBytes > 0 ? 1 : 0, summary.ratio * 100));
  const tone = summary.level === "full" || summary.level === "warn" ? "bg-warn" : summary.level === "notice" ? "bg-caution" : "bg-accent";
  return (
    <div className="grid gap-2 px-4 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-ink tabular-nums">{t("{used} of {quota} used", { used: formatBytes(summary.usedBytes), quota: formatBytes(summary.quotaBytes) })}</span>
        <span className="text-xs text-muted tabular-nums">{percent(summary.ratio)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-control" role="progressbar" aria-label={t("Storage used")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(summary.ratio * 100)}>
        <div className={cx("h-full rounded-full transition-[width]", tone)} style={{ width: `${width}%` }} />
      </div>
      {noticeText(summary, t) && <p className={cx("text-xs", summary.level === "notice" ? "text-caution-ink" : "text-warn")}>{noticeText(summary, t)}{gap}{summary.level === "notice" ? t("Nothing is blocked yet.") : summary.scope === "account" ? t("Delete rejected or unused creatives, or old saved ad media, below.") : t("Delete something below, or upgrade your Supabase plan.")}</p>}
    </div>
  );
}

function StorageBody({ summary }: { summary: StorageSummary }) {
  const { t, tn } = useT();
  const [busy, setBusy] = useState<string | null>(null);
  const [days, setDays] = useState({ unused: 30, media: 90 });

  /** Preview, confirm with the exact sentence, then run. */
  async function clean(action: CleanupAction, o: { appId?: string; appName?: string; days?: number } = {}) {
    const key = `${action}:${o.appId ?? ""}`;
    setBusy(key);
    const body = { action, appId: o.appId, days: o.days };
    const preview = await api<CleanupPreview>("/api/storage/cleanup", "POST", body);
    if (!preview.ok) { setBusy(null); return notice(sayError(t, preview.error)); }
    if (!preview.data.files && !preview.data.items) { setBusy(null); return notice(t("There's nothing to delete for this right now."), t("Nothing to delete")); }
    const sentence = cleanupSentence(preview.data, o.appName, o.days, t);
    const ok = await ask({ title: t(CLEANUP_LABEL[action]), body: <p className="text-sm text-label">{sentence}</p>, confirm: t("Delete and free {size}", { size: formatBytes(preview.data.bytes) }), danger: true });
    if (!ok) { setBusy(null); return; }
    const done = await api<CleanupPreview>("/api/storage/cleanup", "POST", { ...body, run: true });
    setBusy(null);
    await refreshStorage();
    if (!done.ok) return notice(sayError(t, done.error));
    void notice(tn(done.data.files, "Freed {size} ({n} file).", "Freed {size} ({n} files).", { size: formatBytes(done.data.bytes) }), t("Done"));
  }
  const spinning = (action: CleanupAction, appId = "") => busy === `${action}:${appId}`;
  const dayInput = (value: number, onChange: (n: number) => void, label: string) => (
    <input type="number" min={7} max={3650} value={value} aria-label={label} onChange={(e) => onChange(Math.max(7, Math.min(3650, Number(e.target.value) || 7)))} className={cx(inputClass, "h-7 w-16! px-2 py-1 text-xs tabular-nums")} />
  );

  return (
    <div className="grid gap-10">
      <SettingsGroup title={t("Usage")} description={summary.scope === "account"
        ? t("Your plan includes {quota} of storage; one file can be up to {file}.", { quota: formatBytes(summary.quotaBytes), file: limitMb(summary.uploadLimitBytes) })
        : t("Your Supabase plan includes {quota} of storage; one file can be up to {file}.", { quota: formatBytes(summary.quotaBytes), file: limitMb(summary.uploadLimitBytes) })}>
        <UsageBar summary={summary} />
        {KINDS.filter((k) => summary.byKind[k] > 0 || k !== "other").map((k) => (
          <SettingsRow key={k} label={t(KIND_LABEL[k])} description={t(KIND_HINT[k])}>
            <span className="text-sm text-ink tabular-nums">{formatBytes(summary.byKind[k])}</span>
          </SettingsRow>
        ))}
      </SettingsGroup>

      <SettingsGroup title={t("By app")} description={t("Each app keeps its files in its own folder, so it can be measured and cleared on its own.")}>
        {summary.apps.length === 0 && summary.orphans.length === 0 && <SettingsRow label={t("No app files yet")} description={t("Files appear here once you collect ads, upload images or generate creatives.")} />}
        {summary.apps.map((a) => (
          <SettingsRow key={a.appId} label={a.name}
            description={[a.byKind.competitor_media ? t("{size} competitors' media", { size: formatBytes(a.byKind.competitor_media) }) : "", a.byKind.creatives ? t("{size} creatives", { size: formatBytes(a.byKind.creatives) }) : "", a.byKind.uploads ? t("{size} uploads", { size: formatBytes(a.byKind.uploads) }) : ""].filter(Boolean).join(" · ") || t("No files")}>
            <span className="text-sm text-ink tabular-nums">{formatBytes(a.bytes)}</span>
            {Boolean(a.byKind.competitor_media) && (
              <Button size="sm" variant="secondary" disabled={Boolean(busy)} onClick={() => clean("app_media", { appId: a.appId, appName: a.name })}>
                {spinning("app_media", a.appId) && <Spinner className="size-3.5" />}{t("Delete competitor media")}
              </Button>
            )}
          </SettingsRow>
        ))}
        {summary.orphans.map((o) => (
          <SettingsRow key={o.appId} label={t("Files of a deleted app")} description={tn(o.files, "{n} file left behind by an app deleted before its files were removed with it.", "{n} files left behind by an app deleted before its files were removed with it.")}>
            <span className="text-sm text-ink tabular-nums">{formatBytes(o.bytes)}</span>
            <Button size="sm" variant="secondary" disabled={Boolean(busy)} onClick={() => clean("app_files", { appId: o.appId, appName: t("the deleted app") })}>
              {spinning("app_files", o.appId) && <Spinner className="size-3.5" />}{t("Remove")}
            </Button>
          </SettingsRow>
        ))}
      </SettingsGroup>

      <SettingsGroup title={t("Free up space")} description={t("Each one shows exactly what it deletes and how much it frees before anything goes. Deleting an app (in its settings) removes all its files.")}>
        <SettingsRow label={t("Rejected creatives")} description={t("Creatives you marked rejected in Studio. Anything sent to Meta is kept.")}>
          <Button size="sm" variant="secondary" disabled={Boolean(busy)} onClick={() => clean("rejected_creatives")}>{spinning("rejected_creatives") && <Spinner className="size-3.5" />}{t("Delete")}</Button>
        </SettingsRow>
        <SettingsRow label={t("Unused creatives")} description={<span className="inline-flex flex-wrap items-center gap-1.5">{t("Never approved or sent to Meta, older than this many days:")} {dayInput(days.unused, (n) => setDays((d) => ({ ...d, unused: n })), t("Days"))}</span>}>
          <Button size="sm" variant="secondary" disabled={Boolean(busy)} onClick={() => clean("unused_creatives", { days: days.unused })}>{spinning("unused_creatives") && <Spinner className="size-3.5" />}{t("Delete")}</Button>
        </SettingsRow>
        <SettingsRow label={t("Old saved media")} description={<span className="inline-flex flex-wrap items-center gap-1.5">{t("Competitors' saved ad images and videos older than this many days:")} {dayInput(days.media, (n) => setDays((d) => ({ ...d, media: n })), t("Days"))} {t("The ads stay, with their text and links.")}</span>}>
          <Button size="sm" variant="secondary" disabled={Boolean(busy)} onClick={() => clean("old_media", { days: days.media })}>{spinning("old_media") && <Spinner className="size-3.5" />}{t("Delete")}</Button>
        </SettingsRow>
      </SettingsGroup>

      <p className="text-xs text-muted">
        {t("What fills space and when to upgrade:")}{" "}
        <Link href={repoFileUrl("docs/TROUBLESHOOTING.md#running-out-of-space")} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-xs font-medium text-accent hover:underline">{t("Running out of space")}<IconExternal className="size-3" /></Link>
      </p>
    </div>
  );
}
