"use client";
// Taking a competitor's ad away from Research: a static's image (copied to the clipboard or downloaded)
// and its text, and a video's breakdown, which reads the video the same way Recreate's scan does (key
// frames from the stored copy plus speech-to-text) and shows it as a script with shots and timings.
// Copy their format and structure, never their assets: the copies are for reference and briefs.
import { useState } from "react";
import { staleReads, type AdScan, type AdVideoScan, type CreativeMedia, type RankedAdRow } from "@/lib/research";
import { videoFrames } from "@/lib/video-frames";
import { IconCheck, IconCopy, IconDownload } from "../icons";
import { Button, Spinner } from "../ui";
import { LockedNote, useLocked } from "./gates";
import { VideoReading } from "./recreate-ad";
import { useT } from "@/lib/i18n/client";

/** "0:07": seconds as minutes and seconds. */
export const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** The ad's words as they'd be pasted into a brief: headline, primary text, description, button. */
export function adText(ad: Pick<RankedAdRow, "headline" | "body" | "description" | "cta">): string {
  return [ad.headline && `Headline: ${ad.headline}`, ad.body && `Primary text:\n${ad.body}`, ad.description && `Description: ${ad.description}`, ad.cta && `Button: ${ad.cta}`]
    .filter(Boolean).join("\n\n");
}

/**
 * What's said in the video, line by line with timings. A video nobody speaks in (captions over music)
 * gets its on-screen text, shot by shot, instead.
 */
export function videoScript(video: AdVideoScan): { lines: { start: number; end: number; text: string }[]; kind: "spoken" | "on_screen" | "none" } {
  const said = (video.transcript ?? []).filter((l) => l.text?.trim());
  if (said.length) return { lines: said, kind: "spoken" };
  const shown = video.shots.filter((x) => x.on_screen_text?.trim()).map((x) => ({ start: x.start, end: x.end, text: x.on_screen_text.trim() }));
  return shown.length ? { lines: shown, kind: "on_screen" } : { lines: [], kind: "none" };
}

/** The script as plain text, one timed line each ("0:00–0:03  …"). */
export const scriptText = (lines: { start: number; end: number; text: string }[]) => lines.map((l) => `${clock(l.start)}–${clock(l.end)}  ${l.text.trim()}`).join("\n");

/** The whole breakdown as a brief: hook, script, shots and how it's made. */
export function breakdownText(ad: Pick<RankedAdRow, "competitor" | "page_name">, video: AdVideoScan): string {
  const script = videoScript(video);
  const out = [
    `${ad.competitor ?? ad.page_name}: video breakdown${video.duration_sec ? ` (${Math.round(video.duration_sec)} s)` : ""}`,
    video.hook.what_happens || video.hook.line ? `Hook (first ${Math.round(video.hook.seconds * 10) / 10} s): ${video.hook.what_happens}${video.hook.line ? ` "${video.hook.line}"` : ""}` : "",
    video.structure ? `Beats: ${video.structure}` : "",
    script.lines.length ? `${script.kind === "spoken" ? "Script (what's said)" : "Script (on-screen text)"}:\n${scriptText(script.lines)}` : "",
    video.shots.length ? `Shots:\n${video.shots.map((x) => `${clock(x.start)}–${clock(x.end)}  ${x.shot_type.replace(/_/g, " ")}: ${x.visual}${x.on_screen_text ? ` | caption: ${x.on_screen_text}` : ""}`).join("\n")}` : "",
    [["Voiceover", video.voiceover_style], ["Captions", video.captions_style], ["Sound", video.music_sound], ["Pacing", video.pacing], ["Presenter", video.presenter]]
      .filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join("\n"),
  ];
  return out.filter(Boolean).join("\n\n");
}

/** An image drawn to a canvas as PNG: the only image type every browser's clipboard takes. */
async function pngOf(url: string): Promise<Blob> {
  const response = await fetch(url, { mode: "cors" });
  if (!response.ok) throw new Error(`The image answered ${response.status}.`);
  const bitmap = await createImageBitmap(await response.blob());
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't draw the image."))), "image/png"));
}

/** Copies an image to the clipboard (Safari wants the item created inside the click, with a promise). */
export async function copyImage(url: string): Promise<void> {
  await navigator.clipboard.write([new ClipboardItem({ "image/png": pngOf(url) })]);
}

/** Saves the file under a readable name; falls back to opening it when the link can't be fetched here. */
export async function downloadFile(url: string, name: string): Promise<void> {
  try {
    const response = await fetch(url, { mode: "cors" });
    if (!response.ok) throw new Error(String(response.status));
    const blob = await response.blob();
    const ext = (blob.type.split("/")[1] || "jpg").replace("jpeg", "jpg").replace(/[^a-z0-9]/g, "");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${name}.${ext}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

/** A file name from the advertiser and the ad: "some-advertiser-123456789". */
export const fileName = (ad: Pick<RankedAdRow, "competitor" | "page_name" | "ad_id">, part?: number) =>
  `${(ad.competitor ?? ad.page_name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "ad"}-${ad.ad_id}${part ? `-${part}` : ""}`;

type Done = "copied" | "failed" | null;

/** A button that runs `run` and says "Copied" (or why not) for a moment. */
export function CopyButton({ label, run, size = "sm", variant = "secondary", icon = "copy", className }: {
  label: string; run: () => Promise<void>; size?: "sm" | "md"; variant?: "secondary" | "ghost"; icon?: "copy" | "download"; className?: string;
}) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Done>(null);
  const go = async () => {
    setBusy(true);
    const ok = await run().then(() => true, () => false);
    setBusy(false);
    setDone(ok ? "copied" : "failed");
    setTimeout(() => setDone(null), 2200);
  };
  const Icon = icon === "download" ? IconDownload : IconCopy;
  return (
    <Button size={size} variant={variant} onClick={go} disabled={busy} className={className}>
      {busy ? <Spinner /> : done === "copied" ? <IconCheck className="size-3.5 text-win" /> : <Icon className="size-3.5" />}
      {done === "copied" ? (icon === "download" ? t("Saved") : t("Copied")) : done === "failed" ? t("Couldn't") : label}
    </Button>
  );
}

/** A static's take-away: copy or save each image, and copy its text. */
export function StaticActions({ ad, images }: { ad: RankedAdRow; images: CreativeMedia[] }) {
  const { t } = useT();
  const text = adText(ad);
  if (!images.length && !text) return null;
  return (
    <div className="grid gap-2">
      <p className="eyebrow">{t("Copy this static")}</p>
      <div className="flex flex-wrap gap-2">
        {images.length === 1 && <>
          <CopyButton label={t("Copy image")} run={() => copyImage(images[0].url).catch(() => downloadFile(images[0].url, fileName(ad)))} />
          <CopyButton label={t("Download image")} icon="download" run={() => downloadFile(images[0].url, fileName(ad))} />
        </>}
        {images.length > 1 && images.map((m, i) => (
          <CopyButton key={`${m.url}-${i}`} label={t("Card {n}", { n: i + 1 })} icon="download" run={() => downloadFile(m.url, fileName(ad, i + 1))} />
        ))}
        {text && <CopyButton label={t("Copy text")} run={() => navigator.clipboard.writeText(text)} />}
      </div>
      <p className="text-xs text-muted">{t("For reference and briefs: remake the format for your brand, never reuse their image or words as they are.")}</p>
    </div>
  );
}

/**
 * A video's breakdown in the ad drawer: its script (what's said, or its captions when nobody speaks),
 * then the hook, the shots and how it's made. Not read yet: one button reads it like Recreate's scan.
 */
export function VideoBreakdown({ ad, preview, onScanned }: { ad: RankedAdRow; preview: CreativeMedia | null; onScanned: (scan: AdScan, scannedAt: string) => void }) {
  const { t, intl } = useT();
  const stale = staleReads(ad).scan;
  const video = !stale ? ad.scan?.video ?? null : null;
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const aiLocked = useLocked("ai");

  async function breakDown() {
    setError(null);
    // Key frames from the stored copy (null when the browser can't read it; the poster is read then).
    let grabbed: Awaited<ReturnType<typeof videoFrames>> = null;
    if (preview?.type === "video") {
      setStage(t("Taking key frames…"));
      grabbed = await videoFrames(preview.url).catch(() => null);
    }
    setStage(t("Watching and listening…"));
    const response = await fetch(`/api/research/ads/${ad.id}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "scan", force: Boolean(ad.scan) || stale, ...(grabbed ? { frames: grabbed.frames, duration: grabbed.duration } : {}) }),
    }).catch(() => null);
    const data = await response?.json().catch(() => null) as { scan?: AdScan; scannedAt?: string; error?: string } | null;
    setStage(null);
    if (!response?.ok || !data?.scan) return setError(data?.error ?? t("Couldn't reach the scan. Try again."));
    onScanned(data.scan, data.scannedAt ?? new Date().toISOString());
  }

  const script = video ? videoScript(video) : null;
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="eyebrow">{t("Video breakdown")}</p>
        {video && (
          <div className="flex flex-wrap gap-1.5">
            {script && script.lines.length > 0 && <CopyButton variant="ghost" label={t("Copy script")} run={() => navigator.clipboard.writeText(scriptText(script.lines))} />}
            <CopyButton variant="ghost" label={t("Copy breakdown")} run={() => navigator.clipboard.writeText(breakdownText(ad, video))} />
          </div>
        )}
      </div>
      {!video ? (
        <div className="grid gap-2 rounded-inner border border-line bg-raised p-3">
          <p className="text-sm">{stale ? t("The ad was edited after its last read.") : t("See how it's made, shot by shot, and get its full script.")}</p>
          <p className="text-xs text-muted">{t("Key frames are taken from the stored video and its sound is transcribed: one AI scan, the same one Recreate uses.")}</p>
          <div className="flex items-center gap-3">
            {aiLocked
              ? <LockedNote state={aiLocked}>{t("Needs {keys}", { keys: new Intl.ListFormat(intl, { type: "conjunction" }).format(aiLocked.missingKeys) })}</LockedNote>
              : <Button size="sm" variant="secondary" onClick={breakDown} disabled={Boolean(stage)}>{stage ? <><Spinner /> {stage}</> : stale ? t("Break it down again") : t("Break down this video")}</Button>}
          </div>
          {error && <p role="alert" className="text-xs text-warn">{error}</p>}
        </div>
      ) : (
        <>
          <div className="rounded-inner border border-line bg-raised p-3">
            <p className="mb-2 text-xs font-medium text-label">
              {script?.kind === "spoken" ? t("Script: what's said") : script?.kind === "on_screen" ? t("Script: on-screen text (nobody speaks)") : t("Script")}
            </p>
            {script && script.lines.length > 0 ? (
              <ol className="grid gap-1 text-sm">
                {script.lines.map((l, i) => (
                  <li key={i} className="grid grid-cols-[84px_minmax(0,1fr)] gap-2">
                    <span className="pt-px font-mono text-xs text-muted tabular-nums">{clock(l.start)}–{clock(l.end)}</span>
                    <span className="[overflow-wrap:anywhere]">{l.text}</span>
                  </li>
                ))}
              </ol>
            ) : <p className="text-sm text-muted">{video.transcript_note || t("No words in this video: see the shots below.")}</p>}
          </div>
          <VideoReading video={video} transcript="hidden" />
          <div className="flex items-center gap-3">
            {!aiLocked && <Button size="sm" variant="ghost" onClick={breakDown} disabled={Boolean(stage)}>{stage ? <><Spinner /> {stage}</> : t("Read it again")}</Button>}
            {error && <p role="alert" className="text-xs text-warn">{error}</p>}
          </div>
        </>
      )}
    </div>
  );
}
