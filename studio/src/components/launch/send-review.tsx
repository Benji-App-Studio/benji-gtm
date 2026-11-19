"use client";
// Step 5 of "Send to Meta": every object that will be created (or used), its key settings and the
// money involved, in plain words; then, once created, links to Ads Manager, the ads' progress and
// Meta's own previews of them.
import { useEffect, useState } from "react";
import { refresh } from "@/lib/client-cache";
import type { ApprovedCreative } from "@/lib/creatives";
import { type AdPreviews, metaCall, type SendPlan, type SendResult } from "@/lib/launch/send";
import type { LaunchDraft } from "@/lib/launch/types";
import { Badge, Button, cx, Gear, Segmented, Spinner } from "../ui";
import { adsManagerAd } from "./drafts";
import { IN_PROGRESS } from "./parts";
import { Group } from "./send-parts";

const LEVEL: Record<string, string> = { campaign: "Campaign", adset: "Ad set", ad: "Ad" };

export function Review({ plan, creatives }: { plan: SendPlan; creatives: ApprovedCreative[] }) {
  return (
    <div className="grid gap-4">
      <p className="rounded-inner bg-caution-soft px-3 py-2.5 text-sm text-caution-ink">{plan.note}</p>
      <div className="grid gap-2 rounded-inner border border-line bg-raised p-3">
        <p className="text-xs text-muted">Money</p>
        <p className="text-title font-medium">{plan.money.text}</p>
        <p className="text-xs text-muted">In the ad account’s currency ({plan.currency}). Budgets only start once you publish in Ads Manager.</p>
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {creatives.map((c) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={c.id} src={c.thumbnailUrl ?? c.url} alt={c.title ?? ""} className="h-20 w-16 shrink-0 rounded object-cover" />
        ))}
      </div>
      {plan.objects.map((o, i) => (
        <section key={`${o.level}-${i}`} className="rounded-inner border border-line p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={o.action === "create" ? "accent" : "neutral"}>{o.action === "create" ? "New" : "Existing"} {LEVEL[o.level].toLowerCase()}</Badge>
            {o.action === "create" && <Badge>paused</Badge>}
          </div>
          <p className="mt-1.5 font-mono text-xs break-all">{o.name}</p>
          <dl className="mt-2 grid gap-1 text-sm">
            {o.lines.map((l) => (
              <div key={l.label} className="grid gap-x-3 @md:grid-cols-[140px_minmax(0,1fr)]"><dt className="text-muted">{l.label}</dt><dd className="break-words">{l.value}</dd></div>
            ))}
          </dl>
        </section>
      ))}
      <details className="text-xs text-muted">
        <summary className="cursor-pointer">Exactly what Meta will receive</summary>
        <pre className="mt-2 max-h-80 overflow-auto rounded-inner bg-console p-3 text-xs text-white/85">{JSON.stringify(plan.payloads, null, 2)}</pre>
      </details>
    </div>
  );
}

const STATUS: Record<string, { label: string; tone: "neutral" | "accent" | "win" | "warn" }> = {
  queued: { label: "Queued", tone: "neutral" }, processing: { label: "Meta is processing the video", tone: "accent" }, creating: { label: "Creating the ad", tone: "accent" },
  draft: { label: "Paused ad on Meta", tone: "win" }, error: { label: "Failed", tone: "warn" }, cancelled: { label: "Cancelled", tone: "neutral" },
};

export function Results({ productId, result, drafts, adAccountId }: { productId: string; result: SendResult; drafts: LaunchDraft[]; adAccountId?: string }) {
  const ids = new Set(result.drafts.map((d) => d.id));
  const mine = drafts.filter((d) => ids.has(d.id));
  const rows = mine.length ? mine : result.drafts.map((d) => ({ ad_id: null, error: null, ...d } as unknown as LaunchDraft));
  const working = rows.some((d) => IN_PROGRESS.has(d.status));
  const [preview, setPreview] = useState<string | null>(null);

  // Follow the uploads: Meta takes a minute or two to process a video.
  useEffect(() => {
    const url = `/api/launch/${productId}/drafts`;
    refresh(url).catch(() => {});
    if (!working && mine.length) return;
    const timer = setInterval(() => { refresh(url).catch(() => {}); }, 4000);
    return () => clearInterval(timer);
  }, [productId, working, mine.length]);

  return (
    <div className="grid gap-5">
      <Group title="On Meta">
        <ul className="grid gap-1.5 text-sm">
          {result.created.campaign && <li>New campaign <a className="font-medium underline-offset-2 hover:underline" href={result.created.campaign.url} target="_blank" rel="noreferrer">{result.created.campaign.name} ↗</a></li>}
          {result.created.adSet && <li>New ad set <a className="font-medium underline-offset-2 hover:underline" href={result.created.adSet.url} target="_blank" rel="noreferrer">{result.created.adSet.name} ↗</a></li>}
          {!result.created.adSet && <li>Ads added to the ad set <a className="font-medium underline-offset-2 hover:underline" href={result.adSet.url} target="_blank" rel="noreferrer">in Ads Manager ↗</a></li>}
        </ul>
      </Group>
      <Group title="Ads" hint={working ? "Uploading the media and creating the ads. You can close this; they keep going and show on the Launch page." : "Publish them in Ads Manager when you're happy with them."}>
        <ul className="grid gap-2">
          {rows.map((d) => {
            const s = STATUS[d.status] ?? STATUS.queued;
            return (
              <li key={d.id} className="rounded-inner border border-line p-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="min-w-0 flex-1 font-mono text-xs break-all">{d.ad_name}</p>
                  <Badge tone={s.tone}>{IN_PROGRESS.has(d.status) && <Gear className="size-3" />}{s.label}</Badge>
                  {d.ad_id && <a href={adsManagerAd(adAccountId, d.ad_id)} target="_blank" rel="noreferrer" className="text-xs font-medium underline-offset-2 hover:underline">Ads Manager ↗</a>}
                  {d.ad_id && <Button size="sm" variant="secondary" onClick={() => setPreview(preview === d.ad_id ? null : d.ad_id)}>{preview === d.ad_id ? "Hide preview" : "Preview"}</Button>}
                </div>
                {d.error && <p className="mt-1 text-xs text-warn">{d.error}</p>}
                {preview === d.ad_id && d.ad_id && <AdPreview productId={productId} adId={d.ad_id} />}
              </li>
            );
          })}
        </ul>
      </Group>
    </div>
  );
}

const FORMAT_LABEL: Record<string, string> = { MOBILE_FEED_STANDARD: "Facebook Feed", INSTAGRAM_STANDARD: "Instagram Feed", INSTAGRAM_STORY: "Instagram Stories" };

/** Meta's own rendering of a (paused) ad in three placements. */
function AdPreview({ productId, adId }: { productId: string; adId: string }) {
  const [data, setData] = useState<AdPreviews | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [format, setFormat] = useState("MOBILE_FEED_STANDARD");
  useEffect(() => {
    metaCall<AdPreviews>(productId, "ad-preview", { adId }).then(setData).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [productId, adId]);
  if (error) return <p className="mt-2 text-xs text-warn">{error}</p>;
  if (!data) return <p className="mt-2 flex items-center gap-2 text-xs text-muted"><Spinner className="size-3" />Asking Meta for previews…</p>;
  const current = data.previews.find((p) => p.format === format);
  return (
    <div className="mt-3 grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented label="Placement" value={format} onChange={setFormat} options={data.previews.map((p) => ({ value: p.format, label: FORMAT_LABEL[p.format] ?? p.format }))} />
        <a href={data.url} target="_blank" rel="noreferrer" className="text-xs text-muted underline-offset-2 hover:underline">Open in Ads Manager ↗</a>
      </div>
      {current?.src
        ? <iframe title={`${FORMAT_LABEL[format]} preview`} src={current.src} sandbox="allow-scripts allow-same-origin allow-popups" className={cx("h-[640px] w-full max-w-[420px] rounded-inner border border-line bg-white")} />
        : <p className="text-xs text-muted">{current?.error ?? "Meta has no preview for this placement yet."}</p>}
    </div>
  );
}
