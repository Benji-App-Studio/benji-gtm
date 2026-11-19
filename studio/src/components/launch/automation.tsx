"use client";
// The daily-uploads switch (off by default): each morning the newest approved creatives become
// paused drafts in the testing ad set, within the caps below. Lives in the settings drawer.
import { useState } from "react";
import type { LaunchSettings } from "@/lib/launch/types";
import { ask, notice } from "../dialog";
import { Card, cx, Field, inputClass, Spinner, Toggle } from "../ui";
import { Section, send } from "./parts";

export function Automation({ productId, settings, onSaved }: { productId: string; settings: LaunchSettings | null; onSaved: () => Promise<unknown> }) {
  const on = settings?.automation_enabled ?? false;
  const [perDay, setPerDay] = useState(String(settings?.automation_max_ads_per_day ?? 3));
  const [inAdSet, setInAdSet] = useState(String(settings?.automation_max_ads_in_adset ?? 20));
  const [saving, setSaving] = useState(false);

  async function save(enabled: boolean) {
    if (!settings) return notice("Save the setup above first.", "Not set up yet");
    if (enabled && !on) {
      const ok = await ask({
        title: "Turn on daily uploads?",
        body: (
          <div className="space-y-2">
            <p>Every morning (09:30 IST) Launch takes up to {perDay} new approved creative{perDay === "1" ? "" : "s"} and creates them as <strong className="text-ink">paused</strong> drafts in the testing ad set.</p>
            <p>It stops when the ad set holds {inAdSet} ads, and does nothing if the ad set&apos;s daily budget is over your {settings.max_daily_budget ?? "–"} guardrail. It never publishes or creates campaigns.</p>
          </div>
        ),
        confirm: "Turn on",
      });
      if (!ok) return;
    }
    setSaving(true);
    try {
      await send(`/api/launch/${productId}`, { automation_enabled: enabled, automation_max_ads_per_day: Number(perDay), automation_max_ads_in_adset: Number(inAdSet) }, "PATCH");
      await onSaved();
    } catch (error) {
      notice(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section id="automation" title="Daily uploads" hint="Off unless you turn it on. Drafts stay paused for you to review.">
      <Card className="grid gap-4 p-4 @xl:grid-cols-[minmax(0,1fr)_auto] @xl:items-end">
        <div className="grid gap-3 @lg:grid-cols-2">
          <Field label="New drafts a day, at most"><input type="number" min={1} max={20} value={perDay} onChange={(e) => setPerDay(e.target.value)} className={inputClass} /></Field>
          <Field label="Stop when the testing ad set holds"><input type="number" min={1} max={50} value={inAdSet} onChange={(e) => setInAdSet(e.target.value)} className={inputClass} /></Field>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {on && <button type="button" disabled={saving} onClick={() => save(true)} className="rounded-xs text-xs font-medium text-accent hover:underline">Save limits</button>}
          <span className={cx("flex items-center gap-2 text-sm font-medium", saving && "opacity-60")}>
            {saving ? <Spinner className="size-3.5" /> : <Toggle label="Daily uploads" checked={on} onChange={(next) => { void save(next); }} />}
            Daily uploads {on ? "on" : "off"}
          </span>
        </div>
        {settings?.automation_last_run_at && (
          <p className="text-xs text-muted @xl:col-span-2">Last run {new Date(settings.automation_last_run_at).toLocaleString()}: {settings.automation_last_note}</p>
        )}
      </Card>
    </Section>
  );
}
