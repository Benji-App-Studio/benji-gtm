"use client";
// Launch settings for a workspace: where ads go (objective, links, Meta ids), which campaigns and
// ad sets are "testing" and "scaling" (or create them, paused), budgets and the guardrail, and the
// promotion rules. Shown in the Launch page's settings drawer (settings-drawer.tsx).
import { useState, type ReactNode } from "react";
import { fromMinor } from "@/lib/launch/currency";
import { OBJECTIVE_INFO, type MetaObjective } from "@/lib/launch/rules";
import { DEFAULT_THRESHOLDS, type Thresholds } from "@/lib/launch/promotion";
import type { LaunchSettings, Objective } from "@/lib/launch/types";
import { ask, Facts, notice } from "../dialog";
import { PlaybookTip } from "../playbook-tip";
import { Button, Card, cx, Field, inputClass, Spinner } from "../ui";
import { Section, send } from "./parts";
import { useT } from "@/lib/i18n/client";
import { m } from "@/lib/i18n/translate";

type Form = Omit<LaunchSettings, "thresholds" | "countries"> & { countries: string; thresholds: Thresholds };

const toForm = (s: LaunchSettings): Form => ({ ...s, countries: (s.countries ?? []).join(", "), thresholds: { ...DEFAULT_THRESHOLDS, ...s.thresholds } });

export function LaunchSettingsForm({ productId, settings, saved, onSaved, onCancel }: { productId: string; settings: LaunchSettings; saved: boolean; onSaved: () => Promise<unknown>; onCancel: () => void }) {
  const [form, setForm] = useState<Form>(() => toForm(settings));
  const [justSaved, setJustSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [building, setBuilding] = useState(false);
  const { t, intl } = useT();
  const edit = (next: (f: Form) => Form) => { setJustSaved(false); setForm(next); };
  const set = (patch: Partial<Form>) => edit((f) => ({ ...f, ...patch }));
  const meta = (patch: Partial<Form["meta"]>) => edit((f) => ({ ...f, meta: { ...f.meta, ...patch } }));
  const rule = (patch: Partial<Thresholds>) => edit((f) => ({ ...f, thresholds: { ...f.thresholds, ...patch } }));
  const blank = (v: number | null | undefined) => (v == null ? "" : String(v));
  const numberOrNull = (v: string) => (v.trim() === "" ? null : Number(v));

  async function save() {
    setSaving(true);
    try {
      const { automation_enabled: _enabled, automation_last_run_at: _at, automation_last_note: _note, product_id: _id, ...rest } = form;
      void _enabled; void _at; void _note; void _id;
      await send(`/api/launch/${productId}`, { ...rest, countries: form.countries }, "PATCH");
      await onSaved();
      setJustSaved(true);
    } catch (error) {
      notice(error instanceof Error ? error.message : String(error), t("Couldn't save"));
    } finally {
      setSaving(false);
    }
  }

  async function createStructure() {
    if (!saved) return notice(t("Save the settings first."), t("Not saved yet"));
    const stages = [...(form.testing_adset_id ? [] : ["TEST"]), ...(form.scaling_adset_id ? [] : ["SCALE"])];
    if (!stages.length) return notice(t("Both ad sets are already chosen. Clear an id to create a new one."), t("Nothing to create"));
    setBuilding(true);
    try {
      const { plan, currency } = await send<{ plan: { stage: string; campaign: Record<string, unknown>; adSet: Record<string, unknown> }[]; currency: string }>(`/api/launch/${productId}/actions`, { action: "setup", stages });
      const ok = await ask({
        title: plan.length === 2 ? t("Create the testing and scaling campaigns, paused?") : plan[0].stage === "TEST" ? t("Create the testing campaign, paused?") : t("Create the scaling campaign, paused?"),
        body: (
          <div className="space-y-3">
            {plan.map((p) => (
              <Facts key={p.stage} rows={[
                [t("Campaign"), <span key="c" className="font-mono text-[11px]">{String(p.campaign.name)}</span>],
                [t("Ad set"), <span key="a" className="font-mono text-[11px]">{String(p.adSet.name)}</span>],
                [t("Objective"), t(OBJECTIVE_INFO[String(p.campaign.objective) as MetaObjective]?.label ?? String(p.campaign.objective))],
                [t("Daily budget"), `${fromMinor(Number(p.adSet.daily_budget ?? p.campaign.daily_budget), currency).toLocaleString(intl)} ${currency}`],
                [t("Budget on"), p.campaign.daily_budget != null ? t("Campaign (CBO)") : t("Ad set (ABO)")],
                [t("Optimises for"), optimisesFor(p.adSet)],
                [t("Status"), t("Paused")],
              ]} />
            ))}
            <p className="text-xs">{t("Both stay paused with no ads until you publish them in Ads Manager.")}</p>
          </div>
        ),
        confirm: t("Create paused"),
      });
      if (!ok) return;
      await send(`/api/launch/${productId}/actions`, { action: "setup", stages, confirm: true });
      await onSaved();
    } catch (error) {
      notice(error instanceof Error ? error.message : String(error));
    } finally {
      setBuilding(false);
    }
  }

  /** What the ad set optimises for, in words: an app event, or the goal. */
  function optimisesFor(adSet: Record<string, unknown>): string {
    const goal = String(adSet.optimization_goal);
    if (goal !== "OFFSITE_CONVERSIONS") return goal === "APP_INSTALLS" ? t("App installs") : goal === "LINK_CLICKS" ? t("Link clicks") : goal === "LANDING_PAGE_VIEWS" ? t("Landing page views") : goal.replace(/_/g, " ").toLowerCase();
    const event = String((adSet.promoted_object as { custom_event_type?: string } | undefined)?.custom_event_type ?? "");
    return t("App event: {event}", { event: event === "START_TRIAL" ? t("trial start") : event === "PURCHASE" ? t("purchase") : event });
  }

  const th = form.thresholds;
  return (
    <Section title={t("Launch setup")} hint={saved ? t("Where ads go, the testing and scaling ad sets, and the promotion rules.") : t("Not saved yet: these are the defaults. Fill in the Meta ids and save.")}>
      <Card className="grid gap-6 p-4">
        <Group title={t("Destination")}>
          <div className="flex flex-wrap gap-2 @xl:col-span-2">
            {(["app_promotion", "website_traffic"] as Objective[]).map((o) => (
              <button key={o} type="button" onClick={() => set({ objective: o })} aria-pressed={form.objective === o}
                className={cx("rounded-control border px-3 py-2 text-left text-sm transition-colors", form.objective === o ? "border-accent bg-accent-soft" : "border-hairline hover:bg-hover")}>
                <span className="block font-medium">{o === "app_promotion" ? t("App promotion (iOS)") : t("Website traffic")}</span>
                <span className="block text-xs text-muted">{o === "app_promotion" ? t("App installs; needs the app live on the App Store") : t("Until the app is live: clicks to the site")}</span>
              </button>
            ))}
          </div>
          <Field label={t("App Store link")}><input value={form.meta.appStoreUrl ?? ""} onChange={(e) => meta({ appStoreUrl: e.target.value })} placeholder="https://apps.apple.com/app/id…" className={inputClass} /></Field>
          <Field label={t("Website")}><input value={form.meta.websiteUrl ?? ""} onChange={(e) => meta({ websiteUrl: e.target.value })} placeholder="https://" className={inputClass} /></Field>
          <Field label={t("Meta app id")} hint={t("From developers.facebook.com, with the iOS App Store id added (app promotion only).")}><input value={form.meta.appId ?? ""} onChange={(e) => meta({ appId: e.target.value })} inputMode="numeric" className={inputClass} /></Field>
          <Field label={t("Countries")} hint={t("Two-letter codes, comma separated.")}><input value={form.countries} onChange={(e) => set({ countries: e.target.value })} className={inputClass} /></Field>
          <Field label={t("Short code for names")} hint={t("Starts every name: ACME | TEST | format | hook | v01 | date")}><input value={form.app_code ?? ""} onChange={(e) => set({ app_code: e.target.value.toUpperCase() })} maxLength={6} placeholder="ACME" className={inputClass} /></Field>
          <Field label={t("Page name in previews")}><input value={form.meta.appName ?? ""} onChange={(e) => meta({ appName: e.target.value })} className={inputClass} /></Field>
        </Group>

        <Group title="Meta">
          <Field label={t("Ad account id")}><input value={form.meta.adAccountId ?? ""} onChange={(e) => meta({ adAccountId: e.target.value.replace(/^act_/, "") })} inputMode="numeric" className={inputClass} /></Field>
          <Field label={t("Facebook Page id")}><input value={form.meta.pageId ?? ""} onChange={(e) => meta({ pageId: e.target.value })} inputMode="numeric" className={inputClass} /></Field>
          <Field label={t("Instagram account id")} hint={t("Optional: without it, Instagram placements show the Page.")}><input value={form.meta.instagramId ?? ""} onChange={(e) => meta({ instagramId: e.target.value })} inputMode="numeric" className={inputClass} /></Field>
          <Field label={t("Pixel / dataset id")} hint={t("Optional: website traffic then optimises for landing page views.")}><input value={form.meta.pixelId ?? ""} onChange={(e) => meta({ pixelId: e.target.value })} inputMode="numeric" className={inputClass} /></Field>
        </Group>

        <Group title={t("How campaigns are set up")} hint={t("Used when Launch creates the campaigns below. Both follow the Meta ads playbook by default; change them if your account needs it.")}>
          <div className="grid gap-2">
            <span className="text-sm font-medium">{t("Scaling budget")}</span>
            <Choice value={form.scaling_budget ?? "campaign"} onChange={(v) => set({ scaling_budget: v })} options={[
              { value: "campaign", label: m("Campaign budget (CBO)"), hint: m("Meta moves money to the best ads. Recommended for scaling.") },
              { value: "adset", label: m("Ad set budget (ABO)"), hint: m("You control each ad set's spend. Testing always uses this.") },
            ]} />
          </div>
          <div className="grid gap-2">
            <span className="text-sm font-medium">{t("App ad sets optimise for")}</span>
            <Choice value={form.optimize_for ?? "install"} onChange={(v) => set({ optimize_for: v })} disabled={form.objective !== "app_promotion"} options={[
              { value: "install", label: m("Installs"), hint: m("Works from day one; finds people who install.") },
              { value: "trial", label: m("Trial starts"), hint: m("Finds people who start a trial. Needs the StartTrial event from the SDK or MMP.") },
              { value: "purchase", label: m("Purchases"), hint: m("Finds people who pay. Needs the Purchase event; use once it fires often.") },
            ]} />
            {form.objective !== "app_promotion" && <span className="text-xs text-muted">{t("Website traffic optimises for clicks or landing page views.")}</span>}
          </div>
          <PlaybookTip id="abo-cbo" />
          <PlaybookTip id="deepest-event" />
        </Group>

        <Group title={t("Testing and scaling")}>
          <Field label={t("Testing campaign id")}><input value={form.testing_campaign_id ?? ""} onChange={(e) => set({ testing_campaign_id: e.target.value || null })} inputMode="numeric" className={inputClass} /></Field>
          <Field label={t("Testing ad set id")} hint={t("New drafts go here.")}><input value={form.testing_adset_id ?? ""} onChange={(e) => set({ testing_adset_id: e.target.value || null })} inputMode="numeric" className={inputClass} /></Field>
          <Field label={t("Scaling campaign id")}><input value={form.scaling_campaign_id ?? ""} onChange={(e) => set({ scaling_campaign_id: e.target.value || null })} inputMode="numeric" className={inputClass} /></Field>
          <Field label={t("Scaling ad set id")} hint={t("Promoted ads are copied here.")}><input value={form.scaling_adset_id ?? ""} onChange={(e) => set({ scaling_adset_id: e.target.value || null })} inputMode="numeric" className={inputClass} /></Field>
          <Field label={t("Testing daily budget")} hint={t("Ad account currency; used when Launch creates the ad set.")}><input type="number" min={0} value={blank(form.testing_daily_budget)} onChange={(e) => set({ testing_daily_budget: numberOrNull(e.target.value) })} className={inputClass} /></Field>
          <Field label={t("Scaling daily budget")}><input type="number" min={0} value={blank(form.scaling_daily_budget)} onChange={(e) => set({ scaling_daily_budget: numberOrNull(e.target.value) })} className={inputClass} /></Field>
          <Field label={t("Guardrail: max daily budget per ad set")} hint={t("Setup refuses budgets above it; daily uploads stop if the testing ad set goes over it.")}><input type="number" min={0} value={blank(form.max_daily_budget)} onChange={(e) => set({ max_daily_budget: numberOrNull(e.target.value) })} className={inputClass} /></Field>
          <div className="flex items-end">
            <Button variant="secondary" size="sm" disabled={building || !saved} onClick={createStructure}>{building && <Spinner />}{t("Create missing campaigns (paused)…")}</Button>
          </div>
        </Group>

        <Group title={t("Promotion rules")} hint={t("A testing ad is suggested for scaling only when every rule passes, so one lucky day isn't a result.")}>
          <Field label={t("Target CAC")} hint={t("Cost per conversion you're happy to pay (ad account currency).")}><input type="number" min={0} value={th.targetCac || ""} onChange={(e) => rule({ targetCac: Number(e.target.value) || 0 })} className={inputClass} /></Field>
          <Field label={t("Judge by")}><select value={th.conversionEvent} onChange={(e) => rule({ conversionEvent: e.target.value as Thresholds["conversionEvent"] })} className={inputClass}>
            <option value="trial">{t("Trial starts")}</option><option value="purchase">{t("Purchases")}</option><option value="install">{t("Installs")}</option><option value="link_click">{t("Link clicks")}</option>
          </select></Field>
          <Field label={t("Target ROAS")} hint={t("Empty: don't judge ROAS (e.g. before revenue).")}><input type="number" min={0} step="0.1" value={blank(th.targetRoas)} onChange={(e) => rule({ targetRoas: numberOrNull(e.target.value) })} className={inputClass} /></Field>
          <Field label={t("Minimum spend, × target CAC")}><input type="number" min={0.5} step="0.5" value={th.minSpendMultiple} onChange={(e) => rule({ minSpendMultiple: Number(e.target.value) })} className={inputClass} /></Field>
          <Field label={t("Minimum conversions")}><input type="number" min={1} value={th.minConversions} onChange={(e) => rule({ minConversions: Number(e.target.value) })} className={inputClass} /></Field>
          <Field label={t("Minimum days with spend")}><input type="number" min={1} value={th.minDays} onChange={(e) => rule({ minDays: Number(e.target.value) })} className={inputClass} /></Field>
          <Field label={t("Confidence CAC is below target (%)")}><input type="number" min={50} max={99} value={Math.round(th.confidence * 100)} onChange={(e) => rule({ confidence: Number(e.target.value) / 100 })} className={inputClass} /></Field>
          <Field label={t("Most conversions on one day (%)")}><input type="number" min={20} max={100} value={Math.round(th.maxDayShare * 100)} onChange={(e) => rule({ maxDayShare: Number(e.target.value) / 100 })} className={inputClass} /></Field>
          <Field label={t("Pause after spend, × target CAC")}><input type="number" min={0.5} step="0.5" value={th.pauseSpendMultiple} onChange={(e) => rule({ pauseSpendMultiple: Number(e.target.value) })} className={inputClass} /></Field>
          <Field label={t("…when this sure CAC is above target (%)")}><input type="number" min={50} max={99} value={Math.round(th.pauseConfidence * 100)} onChange={(e) => rule({ pauseConfidence: Number(e.target.value) / 100 })} className={inputClass} /></Field>
        </Group>

        <div className="flex items-center justify-end gap-2 border-t border-line pt-4">
          {justSaved && <span className="mr-auto text-sm text-win">{t("Saved.")}</span>}
          <Button variant="ghost" onClick={onCancel}>{justSaved ? t("Close") : t("Cancel")}</Button>
          <Button disabled={saving} onClick={save}>{saving && <Spinner />}{t("Save settings")}</Button>
        </div>
      </Card>
    </Section>
  );
}

function Choice<T extends string>({ value, onChange, options, disabled }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; hint: string }[]; disabled?: boolean }) {
  const { t } = useT();
  return (
    <div className="grid gap-1.5">
      {options.map((o) => (
        <button key={o.value} type="button" disabled={disabled} onClick={() => onChange(o.value)} aria-pressed={value === o.value}
          className={cx("rounded-control border px-3 py-2 text-left text-sm transition-colors disabled:opacity-50", value === o.value ? "border-accent bg-accent-soft" : "border-hairline hover:bg-hover")}>
          <span className="block font-medium">{t(o.label)}</span>
          <span className="block text-xs text-muted">{t(o.hint)}</span>
        </button>
      ))}
    </div>
  );
}

function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset className="grid min-w-0 gap-4 @xl:grid-cols-2">
      <legend className="mb-3 @xl:col-span-2">
        <span className="text-sm font-medium text-ink">{title}</span>
        {hint && <span className="mt-0.5 block text-xs text-muted">{hint}</span>}
      </legend>
      {children}
    </fieldset>
  );
}
