"use client";
// Drafts Launch made (or is making): where each one is, and a link to it in Ads Manager.
import { useState } from "react";
import type { LaunchDraft } from "@/lib/launch/types";
import { Badge, Card, EmptyState, Gear } from "../ui";
import { IN_PROGRESS, Section } from "./parts";
import { m } from "@/lib/i18n/translate";
import { useT } from "@/lib/i18n/client";

const STATUS: Record<LaunchDraft["status"], { label: string; tone: "neutral" | "accent" | "win" | "warn" }> = {
  queued: { label: m("Queued"), tone: "neutral" },
  processing: { label: m("Meta is processing the video"), tone: "accent" },
  creating: { label: m("Creating the ad"), tone: "accent" },
  draft: { label: m("Paused draft"), tone: "win" },
  error: { label: m("Failed"), tone: "warn" },
  cancelled: { label: m("Cancelled"), tone: "neutral" },
};

const SOURCE: Record<LaunchDraft["source"], string> = { manual: "", automation: m("daily upload"), promotion: m("promoted") };

export function adsManagerAd(adAccountId: string | undefined, adId: string) {
  return adAccountId ? `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${adAccountId}&selected_ad_ids=${adId}` : `https://adsmanager.facebook.com/adsmanager/manage/ads?selected_ad_ids=${adId}`;
}

export function Drafts({ drafts, adAccountId }: { drafts: LaunchDraft[]; adAccountId?: string }) {
  const [all, setAll] = useState(false);
  const shown = all ? drafts : drafts.slice(0, 12);
  const working = drafts.filter((d) => IN_PROGRESS.has(d.status)).length;
  const { t } = useT();
  return (
    <Section id="drafts" title={t("Drafts on Meta")} hint={working ? t("{n} on the way", { n: working }) : t("Publish them in Ads Manager when you're happy with them.")}>
      {drafts.length === 0 ? (
        <EmptyState className="py-8" title={t("Nothing launched yet")} body={t("Pick approved creatives above and launch them: they arrive here as paused drafts.")} />
      ) : (
        <Card className="overflow-hidden py-1">
          {shown.map((d) => {
            const s = STATUS[d.status];
            return (
              <div key={d.id} className="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-1.5 px-3 py-2 transition-colors hover:bg-hover">
                <div className="min-w-0 flex-1 basis-64">
                  <p className="font-mono text-xs break-all">{d.ad_name}</p>
                  <p className="mt-0.5 truncate text-xs text-muted">{d.headline || d.primary_text}</p>
                  {d.error && <p className="mt-1 text-xs text-warn">{d.error}</p>}
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {SOURCE[d.source] && <Badge>{t(SOURCE[d.source])}</Badge>}
                  <Badge>{d.stage === "TEST" ? t("testing") : t("scaling")}</Badge>
                  <Badge tone={s.tone}>{IN_PROGRESS.has(d.status) && <Gear className="size-3" />}{t(s.label)}</Badge>
                  {d.ad_id && <a href={adsManagerAd(adAccountId, d.ad_id)} target="_blank" rel="noreferrer" className="text-xs font-medium underline-offset-2 hover:underline">{t("Ads Manager ↗")}</a>}
                </div>
              </div>
            );
          })}
          {drafts.length > shown.length && <button type="button" onClick={() => setAll(true)} className="h-9 w-full px-3 text-left text-xs text-muted hover:text-ink">{t("Show all {n}", { n: drafts.length })}</button>}
        </Card>
      )}
    </Section>
  );
}
