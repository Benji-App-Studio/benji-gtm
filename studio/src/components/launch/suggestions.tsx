"use client";
// Promote-to-scaling and pause suggestions from Measure's per-ad numbers, each with its reasons.
// Promoting makes a paused copy in the scaling ad set; pausing pauses the ad. Both are confirmed.
import { useState } from "react";
import { EVENT_LABEL, type Suggestion, type Thresholds } from "@/lib/launch/promotion";
import { ask, Facts, notice } from "../dialog";
import { Badge, Button, ButtonLink, Card, cx, EmptyState, Spinner } from "../ui";
import { workspaceHref } from "@/lib/workspace-schema";
import { money, Section, send } from "./parts";

const VERDICT: Record<Suggestion["verdict"], { label: string; tone: "win" | "warn" | "neutral" | "accent" }> = {
  promote: { label: "Promote", tone: "win" },
  pause: { label: "Pause", tone: "warn" },
  keep_testing: { label: "Keep testing", tone: "neutral" },
  promoted: { label: "In scaling", tone: "accent" },
};

export function Suggestions({ productId, suggestions, thresholds, range, onChanged, onOpenSettings }: {
  productId: string;
  suggestions: Suggestion[];
  thresholds: Thresholds;
  range: { since: string; until: string };
  onChanged: () => Promise<unknown>;
  /** Opens the Launch settings drawer (where the target CAC is set). */
  onOpenSettings: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const actionable = suggestions.filter((s) => s.verdict === "promote" || s.verdict === "pause");
  const shown = showAll ? suggestions : actionable.length ? actionable : suggestions.slice(0, 4);
  const e = EVENT_LABEL[thresholds.conversionEvent];

  async function act(s: Suggestion) {
    const promote = s.verdict === "promote";
    const ok = await ask({
      title: promote ? "Copy this ad to the scaling campaign?" : "Pause this ad?",
      body: (
        <div className="space-y-3">
          <p className="font-mono text-[11px] break-all text-ink">{s.adName}</p>
          <Facts rows={[
            ["Spend", money(s.spend, s.currency)],
            [e.many[0].toUpperCase() + e.many.slice(1), String(s.conversions)],
            ["CAC", money(s.cac, s.currency)],
            ["Likely CAC", s.cacLow != null ? `${money(s.cacLow, s.currency)} – ${money(s.cacHigh, s.currency)}` : "–"],
          ]} />
          <p className="text-xs">{promote ? "Meta duplicates the ad into the scaling ad set, paused, named with SCALE. The testing ad keeps running until you pause it." : "The ad stops delivering. You can turn it back on in Ads Manager."}</p>
        </div>
      ),
      confirm: promote ? "Copy to scaling (paused)" : "Pause ad",
      danger: !promote,
    });
    if (!ok) return;
    setBusy(s.adId);
    try {
      await send(`/api/launch/${productId}/actions`, { action: promote ? "promote" : "pause", adId: s.adId, reason: s.summary });
      await onChanged();
    } catch (error) {
      notice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Section
      id="suggestions"
      title="Suggestions"
      hint={`From ${range.since} to ${range.until}, judged on ${e.many}${thresholds.targetCac ? ` against a ${money(thresholds.targetCac, suggestions[0]?.currency ?? "USD")} target CAC` : ""}.`}
      action={suggestions.length > shown.length || showAll ? <button type="button" onClick={() => setShowAll(!showAll)} className="text-xs text-muted hover:text-ink">{showAll ? "Only actionable" : `All ${suggestions.length} ads`}</button> : null}
    >
      {!thresholds.targetCac ? (
        <EmptyState className="py-8" title="No target CAC yet" body="Set a target CAC in Launch settings to get promote and pause suggestions."
          action={<Button variant="secondary" size="sm" onClick={onOpenSettings}>Open Launch settings</Button>} />
      ) : suggestions.length === 0 ? (
        <EmptyState className="py-8" title="No numbers yet" body={`Suggestions appear once Measure has spend and ${e.many} for ads in the testing ad set.`}
          action={<ButtonLink href={workspaceHref(productId, "measure")} variant="secondary" size="sm">Open Measure</ButtonLink>} />
      ) : (
        <div className="grid gap-3 @3xl:grid-cols-2">
          {shown.map((s) => {
            const v = VERDICT[s.verdict];
            return (
              <Card key={s.adId} className="flex min-w-0 flex-col gap-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 font-mono text-[11px] break-all text-muted">{s.adName}</p>
                  <Badge tone={v.tone}>{v.label}</Badge>
                </div>
                <p className="text-sm font-medium">{s.summary}</p>
                <ul className="grid gap-1 text-xs">
                  {s.checks.map((c) => (
                    <li key={c.label} className="flex gap-2">
                      <span aria-hidden className={cx("w-3 shrink-0 text-center font-medium", c.pass === true ? "text-win" : c.pass === false ? "text-warn" : "text-faint")}>{c.pass === true ? "✓" : c.pass === false ? "✗" : "–"}</span>
                      <span className="min-w-0"><span className="font-medium">{c.label}:</span> <span className="text-muted">{c.detail}</span></span>
                    </li>
                  ))}
                </ul>
                {(s.verdict === "promote" || s.verdict === "pause") && (
                  <div className="mt-auto flex justify-end">
                    <Button size="sm" variant={s.verdict === "pause" ? "danger" : "primary"} disabled={busy === s.adId} onClick={() => act(s)}>
                      {busy === s.adId && <Spinner />}{s.verdict === "promote" ? "Copy to scaling (paused)" : "Pause ad"}
                    </Button>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </Section>
  );
}
