"use client";
// Step 5 of "Send to Meta": every object that will be created (or used), its key settings and the
// money involved, in plain words; then, once created, links to Ads Manager, the ads' progress and
// Meta's own previews of them.
import { useEffect, useState } from "react";
import { refresh } from "@/lib/client-cache";
import { useT } from "@/lib/i18n/client";
import { m } from "@/lib/i18n/translate";
import type { ApprovedCreative } from "@/lib/creatives";
import { type AdPreviews, metaCall, money, type SendPlan, type SendResult } from "@/lib/launch/send";
import type { LaunchDraft } from "@/lib/launch/types";
import { Badge, Button, cx, Gear, Segmented, Spinner } from "../ui";
import { adsManagerAd } from "./drafts";
import { IN_PROGRESS } from "./parts";
import { callErrorText, planValue } from "./launch-words";
import { Group } from "./send-parts";

/**
 * The launch function writes the plan in English: its notes, line labels and the fixed values are
 * listed here so they show in the page's language (names, amounts and Meta's own words stay as sent).
 */
export { PLAN_WORDS } from "./launch-words";

export function Review({ plan, creatives }: { plan: SendPlan; creatives: ApprovedCreative[] }) {
  const tr = useT();
  const { t, intl } = tr;
  const amount = (n: number) => money(n, plan.money.currency, intl);
  const moneyText = [plan.money.daily ? t("{amount} a day", { amount: amount(plan.money.daily) }) : "", plan.money.lifetime ? t("{amount} in total", { amount: amount(plan.money.lifetime) }) : ""]
    .filter(Boolean).join(" + ") || t("No new budget (the ads join an existing budget).");
  return (
    <div className="grid gap-4">
      <p className="rounded-inner bg-caution-soft px-3 py-2.5 text-sm text-caution-ink">{t(plan.note)}</p>
      <div className="grid gap-2 rounded-inner border border-line bg-raised p-3">
        <p className="text-xs text-muted">{t("Money")}</p>
        <p className="text-sm font-medium">{moneyText}</p>
        <p className="text-xs text-muted">{t("In the ad account’s currency ({currency}). Budgets only start once you publish in Ads Manager.", { currency: plan.currency })}</p>
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
            <Badge tone={o.action === "create" ? "accent" : "neutral"}>{t(o.action === "create" ? NEW_LEVEL[o.level] : EXISTING_LEVEL[o.level])}</Badge>
            {o.action === "create" && <Badge>{t("Paused")}</Badge>}
          </div>
          <p className="mt-1.5 font-mono text-xs break-all">{o.name}</p>
          <dl className="mt-2 grid gap-1 text-sm">
            {o.lines.map((l) => (
              <div key={l.label} className="grid gap-x-3 @md:grid-cols-[140px_minmax(0,1fr)]"><dt className="text-muted">{t(l.label)}</dt><dd className="break-words">{planValue(tr, l.label, l.value)}</dd></div>
            ))}
          </dl>
        </section>
      ))}
      <details className="text-xs text-muted">
        <summary className="cursor-pointer">{t("Exactly what Meta will receive")}</summary>
        <pre className="mt-2 max-h-80 overflow-auto rounded-inner bg-console p-3 text-xs text-white/85">{JSON.stringify(plan.payloads, null, 2)}</pre>
      </details>
    </div>
  );
}

const NEW_LEVEL: Record<string, string> = { campaign: m("New campaign"), adset: m("New ad set"), ad: m("New ad") };
const EXISTING_LEVEL: Record<string, string> = { campaign: m("Existing campaign"), adset: m("Existing ad set"), ad: m("Existing ad") };

const STATUS: Record<string, { label: string; tone: "neutral" | "accent" | "win" | "warn" }> = {
  queued: { label: m("Queued"), tone: "neutral" }, processing: { label: m("Meta is processing the video"), tone: "accent" }, creating: { label: m("Creating the ad"), tone: "accent" },
  draft: { label: m("Paused ad on Meta"), tone: "win" }, error: { label: m("Failed"), tone: "warn" }, cancelled: { label: m("Cancelled"), tone: "neutral" },
};

export function Results({ productId, result, drafts, adAccountId }: { productId: string; result: SendResult; drafts: LaunchDraft[]; adAccountId?: string }) {
  const ids = new Set(result.drafts.map((d) => d.id));
  const mine = drafts.filter((d) => ids.has(d.id));
  const rows = mine.length ? mine : result.drafts.map((d) => ({ ad_id: null, error: null, ...d } as unknown as LaunchDraft));
  const working = rows.some((d) => IN_PROGRESS.has(d.status));
  const [preview, setPreview] = useState<string | null>(null);
  const { t } = useT();

  // Follow the uploads: Meta takes a minute or two to process a video.
  useEffect(() => {
    const url = `/api/launch/${productId}/drafts`;
    refresh(url).catch(() => {});
    if (!working && mine.length) return;
    const timer = setInterval(() => { refresh(url).catch(() => {}); }, 4000);
    return () => clearInterval(timer);
  }, [productId, working, mine.length]);

  return (
    <div className="grid gap-4">
      <Group title={t("On Meta")}>
        <ul className="grid gap-1.5 text-sm">
          {result.created.campaign && <li>{t("New campaign")} <a className="font-medium underline-offset-2 hover:underline" href={result.created.campaign.url} target="_blank" rel="noreferrer">{result.created.campaign.name} ↗</a></li>}
          {result.created.adSet && <li>{t("New ad set")} <a className="font-medium underline-offset-2 hover:underline" href={result.created.adSet.url} target="_blank" rel="noreferrer">{result.created.adSet.name} ↗</a></li>}
          {!result.created.adSet && <li><a className="font-medium underline-offset-2 hover:underline" href={result.adSet.url} target="_blank" rel="noreferrer">{t("Ads added to the ad set (open in Ads Manager)")} ↗</a></li>}
        </ul>
      </Group>
      <Group title={t("Ads")} hint={working ? t("Uploading the media and creating the ads. You can close this; they keep going and show on the Launch page.") : t("Publish them in Ads Manager when you're happy with them.")}>
        <ul className="grid gap-2">
          {rows.map((d) => {
            const s = STATUS[d.status] ?? STATUS.queued;
            return (
              <li key={d.id} className="rounded-inner border border-line p-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="min-w-0 flex-1 font-mono text-xs break-all">{d.ad_name}</p>
                  <Badge tone={s.tone}>{IN_PROGRESS.has(d.status) && <Gear className="size-3" />}{t(s.label)}</Badge>
                  {d.ad_id && <a href={adsManagerAd(adAccountId, d.ad_id)} target="_blank" rel="noreferrer" className="text-xs font-medium underline-offset-2 hover:underline">{t("Ads Manager")} ↗</a>}
                  {d.ad_id && <Button size="sm" variant="secondary" onClick={() => setPreview(preview === d.ad_id ? null : d.ad_id)}>{preview === d.ad_id ? t("Hide preview") : t("Preview")}</Button>}
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

const FORMAT_LABEL: Record<string, string> = { MOBILE_FEED_STANDARD: m("Facebook Feed"), INSTAGRAM_STANDARD: m("Instagram Feed"), INSTAGRAM_STORY: m("Instagram Stories") };

/** Meta's own rendering of a (paused) ad in three placements. */
function AdPreview({ productId, adId }: { productId: string; adId: string }) {
  const [data, setData] = useState<AdPreviews | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [format, setFormat] = useState("MOBILE_FEED_STANDARD");
  const tr = useT();
  const { t } = tr;
  useEffect(() => {
    metaCall<AdPreviews>(productId, "ad-preview", { adId }).then(setData).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [productId, adId]);
  if (error) return <p className="mt-2 text-xs text-warn">{callErrorText(tr, error)}</p>;
  if (!data) return <p className="mt-2 flex items-center gap-2 text-xs text-muted"><Spinner className="size-3" />{t("Asking Meta for previews…")}</p>;
  const current = data.previews.find((p) => p.format === format);
  return (
    <div className="mt-3 grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented label={t("Placement")} value={format} onChange={setFormat} options={data.previews.map((p) => ({ value: p.format, label: FORMAT_LABEL[p.format] ? t(FORMAT_LABEL[p.format]) : p.format }))} />
        <a href={data.url} target="_blank" rel="noreferrer" className="text-xs text-muted underline-offset-2 hover:underline">{t("Open in Ads Manager")} ↗</a>
      </div>
      {current?.src
        ? <iframe title={t("{placement} preview", { placement: FORMAT_LABEL[format] ? t(FORMAT_LABEL[format]) : format })} src={current.src} sandbox="allow-scripts allow-same-origin allow-popups" className={cx("h-[640px] w-full max-w-[420px] rounded-inner border border-line bg-white")} />
        : <p className="text-xs text-muted">{current?.error ?? t("Meta has no preview for this placement yet.")}</p>}
    </div>
  );
}
