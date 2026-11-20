"use client";
// Promote-to-scaling and pause suggestions from Measure's per-ad numbers, each with its reasons.
// Promoting makes a paused copy in the scaling ad set; pausing pauses the ad. Both are confirmed.
import { useState } from "react";
import type { Suggestion, Thresholds } from "@/lib/launch/promotion";
import { ask, Facts, notice } from "../dialog";
import { Badge, Button, ButtonLink, Card, cx, EmptyState, Spinner } from "../ui";
import { workspaceHref } from "@/lib/workspace-schema";
import { money, Section, send } from "./parts";
import { useT } from "@/lib/i18n/client";
import { m } from "@/lib/i18n/translate";
import { checkDetail, checkLabel, events, eventsTitle, summaryText } from "./judgement";

const VERDICT: Record<Suggestion["verdict"], { label: string; tone: "win" | "warn" | "neutral" | "accent" }> = {
  promote: { label: m("Promote"), tone: "win" },
  pause: { label: m("Pause"), tone: "warn" },
  keep_testing: { label: m("Keep testing"), tone: "neutral" },
  promoted: { label: m("In scaling"), tone: "accent" },
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
  const tr = useT();
  const { t, intl } = tr;
  const ev = thresholds.conversionEvent;
  const $ = (n: number | null | undefined, currency: string) => money(n, currency, intl);

  async function act(s: Suggestion) {
    const promote = s.verdict === "promote";
    const ok = await ask({
      title: promote ? t("Copy this ad to the scaling campaign?") : t("Pause this ad?"),
      body: (
        <div className="space-y-3">
          <p className="font-mono text-[11px] break-all text-ink">{s.adName}</p>
          <Facts rows={[
            [t("Spend"), $(s.spend, s.currency)],
            [eventsTitle(tr, s.event), s.conversions.toLocaleString(intl)],
            ["CAC", $(s.cac, s.currency)],
            [t("Likely CAC"), s.cacLow != null ? `${$(s.cacLow, s.currency)} – ${$(s.cacHigh, s.currency)}` : "–"],
          ]} />
          <p className="text-xs">{promote ? t("Meta duplicates the ad into the scaling ad set, paused, named with SCALE. The testing ad keeps running until you pause it.") : t("The ad stops delivering. You can turn it back on in Ads Manager.")}</p>
        </div>
      ),
      confirm: promote ? t("Copy to scaling (paused)") : t("Pause ad"),
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
      title={t("Suggestions")}
      hint={thresholds.targetCac
        ? t("From {since} to {until}, judged on {events} against a {target} target CAC.", { since: range.since, until: range.until, events: events(tr, ev), target: $(thresholds.targetCac, suggestions[0]?.currency ?? "USD") })
        : t("From {since} to {until}, judged on {events}.", { since: range.since, until: range.until, events: events(tr, ev) })}
      action={suggestions.length > shown.length || showAll ? <button type="button" onClick={() => setShowAll(!showAll)} className="text-xs text-muted hover:text-ink">{showAll ? t("Only actionable") : t("All {n} ads", { n: suggestions.length })}</button> : null}
    >
      {!thresholds.targetCac ? (
        <EmptyState className="py-8" title={t("No target CAC yet")} body={t("Set a target CAC in Launch settings to get promote and pause suggestions.")}
          action={<Button variant="secondary" size="sm" onClick={onOpenSettings}>{t("Open Launch settings")}</Button>} />
      ) : suggestions.length === 0 ? (
        <EmptyState className="py-8" title={t("No numbers yet")} body={t("Suggestions appear once Measure has spend and {events} for the ads Launch sent.", { events: events(tr, thresholds.conversionEvent) })}
          action={<ButtonLink href={workspaceHref(productId, "measure")} variant="secondary" size="sm">{t("Open Measure")}</ButtonLink>} />
      ) : (
        <div className="grid gap-2 @3xl:grid-cols-2">
          {shown.map((s) => {
            const v = VERDICT[s.verdict];
            return (
              <Card key={s.adId} className="flex min-w-0 flex-col gap-2 p-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 font-mono text-[11px] break-all text-muted">{s.adName}</p>
                  <Badge tone={v.tone}>{t(v.label)}</Badge>
                </div>
                <p className="text-sm font-medium">{s.summaryCode ? summaryText(tr, s) : s.summary}</p>
                <ul className="grid gap-1 text-xs">
                  {s.checks.map((c) => (
                    <li key={c.code ?? c.label} className="flex gap-2">
                      <span aria-hidden className={cx("w-3 shrink-0 text-center font-medium", c.pass === true ? "text-win" : c.pass === false ? "text-warn" : "text-faint")}>{c.pass === true ? "✓" : c.pass === false ? "✗" : "–"}</span>
                      <span className="min-w-0"><span className="font-medium">{c.code ? t("{label}:", { label: checkLabel(tr, c, ev) }) : `${c.label}:`}</span> <span className="text-muted">{c.code ? checkDetail(tr, c, ev, s.currency) : c.detail}</span></span>
                    </li>
                  ))}
                </ul>
                {(s.verdict === "promote" || s.verdict === "pause") && (
                  <div className="mt-auto flex justify-end">
                    <Button size="sm" variant={s.verdict === "pause" ? "danger" : "primary"} disabled={busy === s.adId} onClick={() => act(s)}>
                      {busy === s.adId && <Spinner />}{s.verdict === "promote" ? t("Copy to scaling (paused)") : t("Pause ad")}
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
