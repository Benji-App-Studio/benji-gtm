"use client";
// Drafts Launch made (or is making): where each one is, and a link to it in Ads Manager.
import { useState } from "react";
import type { LaunchDraft } from "@/lib/launch/types";
import { Badge, Card, EmptyState, Gear } from "../ui";
import { IN_PROGRESS, Section } from "./parts";

const STATUS: Record<LaunchDraft["status"], { label: string; tone: "neutral" | "accent" | "win" | "warn" }> = {
  queued: { label: "Queued", tone: "neutral" },
  processing: { label: "Meta is processing the video", tone: "accent" },
  creating: { label: "Creating the ad", tone: "accent" },
  draft: { label: "Paused draft", tone: "win" },
  error: { label: "Failed", tone: "warn" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

const SOURCE: Record<LaunchDraft["source"], string> = { manual: "", automation: "daily upload", promotion: "promoted" };

export function adsManagerAd(adAccountId: string | undefined, adId: string) {
  return adAccountId ? `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${adAccountId}&selected_ad_ids=${adId}` : `https://adsmanager.facebook.com/adsmanager/manage/ads?selected_ad_ids=${adId}`;
}

export function Drafts({ drafts, adAccountId }: { drafts: LaunchDraft[]; adAccountId?: string }) {
  const [all, setAll] = useState(false);
  const shown = all ? drafts : drafts.slice(0, 12);
  const working = drafts.filter((d) => IN_PROGRESS.has(d.status)).length;
  return (
    <Section id="drafts" title="Drafts on Meta" hint={working ? `${working} on the way` : "Publish them in Ads Manager when you're happy with them."}>
      {drafts.length === 0 ? (
        <EmptyState className="py-8" title="Nothing launched yet" body="Pick approved creatives above and launch them: they arrive here as paused drafts." />
      ) : (
        <Card className="divide-y divide-line">
          {shown.map((d) => {
            const s = STATUS[d.status];
            return (
              <div key={d.id} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3">
                <div className="min-w-0 flex-1 basis-64">
                  <p className="font-mono text-xs break-all">{d.ad_name}</p>
                  <p className="mt-0.5 truncate text-xs text-muted">{d.headline || d.primary_text}</p>
                  {d.error && <p className="mt-1 text-xs text-warn">{d.error}</p>}
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {SOURCE[d.source] && <Badge>{SOURCE[d.source]}</Badge>}
                  <Badge>{d.stage === "TEST" ? "testing" : "scaling"}</Badge>
                  <Badge tone={s.tone}>{IN_PROGRESS.has(d.status) && <Gear className="size-3" />}{s.label}</Badge>
                  {d.ad_id && <a href={adsManagerAd(adAccountId, d.ad_id)} target="_blank" rel="noreferrer" className="text-xs font-medium underline-offset-2 hover:underline">Ads Manager ↗</a>}
                </div>
              </div>
            );
          })}
          {drafts.length > shown.length && <button type="button" onClick={() => setAll(true)} className="w-full px-4 py-2.5 text-left text-xs text-muted hover:text-ink">Show all {drafts.length}</button>}
        </Card>
      )}
    </Section>
  );
}
