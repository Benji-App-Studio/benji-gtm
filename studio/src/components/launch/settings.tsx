"use client";
// Launch settings for a workspace: where ads go (objective, links, Meta ids), which campaigns and
// ad sets are "testing" and "scaling" (or create them, paused), budgets and the guardrail, and the
// promotion rules. Shown in the Launch page's settings drawer (settings-drawer.tsx).
import { useState, type ReactNode } from "react";
import { fromMinor } from "@/lib/launch/currency";
import { DEFAULT_THRESHOLDS, type Thresholds } from "@/lib/launch/promotion";
import type { LaunchSettings, Objective } from "@/lib/launch/types";
import { ask, Facts, notice } from "../dialog";
import { PlaybookTip } from "../playbook-tip";
import { Button, Card, cx, Field, inputClass, Spinner } from "../ui";
import { Section, send } from "./parts";
import { UI_LOCALE } from "@/lib/ui-locale";

type Form = Omit<LaunchSettings, "thresholds" | "countries"> & { countries: string; thresholds: Thresholds };

const toForm = (s: LaunchSettings): Form => ({ ...s, countries: (s.countries ?? []).join(", "), thresholds: { ...DEFAULT_THRESHOLDS, ...s.thresholds } });

export function LaunchSettingsForm({ productId, settings, saved, onSaved, onCancel }: { productId: string; settings: LaunchSettings; saved: boolean; onSaved: () => Promise<unknown>; onCancel: () => void }) {
  const [form, setForm] = useState<Form>(() => toForm(settings));
  const [justSaved, setJustSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [building, setBuilding] = useState(false);
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
      notice(error instanceof Error ? error.message : String(error), "Couldn't save");
    } finally {
      setSaving(false);
    }
  }

  async function createStructure() {
    if (!saved) return notice("Save the settings first.", "Not saved yet");
    const stages = [...(form.testing_adset_id ? [] : ["TEST"]), ...(form.scaling_adset_id ? [] : ["SCALE"])];
    if (!stages.length) return notice("Both ad sets are already chosen. Clear an id to create a new one.", "Nothing to create");
    setBuilding(true);
    try {
      const { plan, currency } = await send<{ plan: { stage: string; campaign: Record<string, unknown>; adSet: Record<string, unknown> }[]; currency: string }>(`/api/launch/${productId}/actions`, { action: "setup", stages });
      const ok = await ask({
        title: `Create ${plan.length === 2 ? "the testing and scaling campaigns" : `the ${plan[0].stage === "TEST" ? "testing" : "scaling"} campaign`}, paused?`,
        body: (
          <div className="space-y-3">
            {plan.map((p) => (
              <Facts key={p.stage} rows={[
                ["Campaign", <span key="c" className="font-mono text-[11px]">{String(p.campaign.name)}</span>],
                ["Ad set", <span key="a" className="font-mono text-[11px]">{String(p.adSet.name)}</span>],
                ["Objective", String(p.campaign.objective)],
                ["Daily budget", `${fromMinor(Number(p.adSet.daily_budget ?? p.campaign.daily_budget), currency).toLocaleString(UI_LOCALE)} ${currency}`],
                ["Budget on", p.campaign.daily_budget != null ? "Campaign (CBO)" : "Ad set (ABO)"],
                ["Optimises for", String(p.adSet.optimization_goal) === "OFFSITE_CONVERSIONS" ? `App event: ${String((p.adSet.promoted_object as { custom_event_type?: string } | undefined)?.custom_event_type ?? "").replace("START_TRIAL", "trial start").replace("PURCHASE", "purchase")}` : String(p.adSet.optimization_goal).replace(/_/g, " ").toLowerCase()],
                ["Status", "Paused"],
              ]} />
            ))}
            <p className="text-xs">Both stay paused with no ads until you publish them in Ads Manager.</p>
          </div>
        ),
        confirm: "Create paused",
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

  const t = form.thresholds;
  return (
    <Section title="Setup" hint={saved ? "Where ads go, the testing and scaling ad sets, and the promotion rules." : "Not saved yet: these are the defaults. Fill in the Meta ids and save."}>
      <Card className="grid gap-6 p-4">
        <Group title="Destination">
          <div className="flex flex-wrap gap-2 @xl:col-span-2">
            {(["app_promotion", "website_traffic"] as Objective[]).map((o) => (
              <button key={o} type="button" onClick={() => set({ objective: o })} aria-pressed={form.objective === o}
                className={cx("rounded-control border px-3 py-2 text-left text-sm transition-colors", form.objective === o ? "border-accent bg-accent-soft" : "border-hairline hover:bg-hover")}>
                <span className="block font-medium">{o === "app_promotion" ? "App promotion (iOS)" : "Website traffic"}</span>
                <span className="block text-xs text-muted">{o === "app_promotion" ? "App installs; needs the app live on the App Store" : "Until the app is live: clicks to the site"}</span>
              </button>
            ))}
          </div>
          <Field label="App Store link"><input value={form.meta.appStoreUrl ?? ""} onChange={(e) => meta({ appStoreUrl: e.target.value })} placeholder="https://apps.apple.com/app/id…" className={inputClass} /></Field>
          <Field label="Website"><input value={form.meta.websiteUrl ?? ""} onChange={(e) => meta({ websiteUrl: e.target.value })} placeholder="https://" className={inputClass} /></Field>
          <Field label="Meta app id" hint="From developers.facebook.com, with the iOS App Store id added (app promotion only)."><input value={form.meta.appId ?? ""} onChange={(e) => meta({ appId: e.target.value })} inputMode="numeric" className={inputClass} /></Field>
          <Field label="Countries" hint="Two-letter codes, comma separated."><input value={form.countries} onChange={(e) => set({ countries: e.target.value })} className={inputClass} /></Field>
          <Field label="Short code for names" hint="Starts every name: ACME | TEST | format | hook | v01 | date"><input value={form.app_code ?? ""} onChange={(e) => set({ app_code: e.target.value.toUpperCase() })} maxLength={6} placeholder="ACME" className={inputClass} /></Field>
          <Field label="Page name in previews"><input value={form.meta.appName ?? ""} onChange={(e) => meta({ appName: e.target.value })} className={inputClass} /></Field>
        </Group>

        <Group title="Meta">
          <Field label="Ad account id"><input value={form.meta.adAccountId ?? ""} onChange={(e) => meta({ adAccountId: e.target.value.replace(/^act_/, "") })} inputMode="numeric" className={inputClass} /></Field>
          <Field label="Facebook Page id"><input value={form.meta.pageId ?? ""} onChange={(e) => meta({ pageId: e.target.value })} inputMode="numeric" className={inputClass} /></Field>
          <Field label="Instagram account id" hint="Optional: without it, Instagram placements show the Page."><input value={form.meta.instagramId ?? ""} onChange={(e) => meta({ instagramId: e.target.value })} inputMode="numeric" className={inputClass} /></Field>
          <Field label="Pixel / dataset id" hint="Optional: website traffic then optimises for landing page views."><input value={form.meta.pixelId ?? ""} onChange={(e) => meta({ pixelId: e.target.value })} inputMode="numeric" className={inputClass} /></Field>
        </Group>

        <Group title="How campaigns are set up" hint="Used when Launch creates the campaigns below. Both follow the Meta ads playbook by default; change them if your account needs it.">
          <div className="grid gap-2">
            <span className="text-sm font-medium">Scaling budget</span>
            <Choice value={form.scaling_budget ?? "campaign"} onChange={(v) => set({ scaling_budget: v })} options={[
              { value: "campaign", label: "Campaign budget (CBO)", hint: "Meta moves money to the best ads. Recommended for scaling." },
              { value: "adset", label: "Ad set budget (ABO)", hint: "You control each ad set's spend. Testing always uses this." },
            ]} />
          </div>
          <div className="grid gap-2">
            <span className="text-sm font-medium">App ad sets optimise for</span>
            <Choice value={form.optimize_for ?? "install"} onChange={(v) => set({ optimize_for: v })} disabled={form.objective !== "app_promotion"} options={[
              { value: "install", label: "Installs", hint: "Works from day one; finds people who install." },
              { value: "trial", label: "Trial starts", hint: "Finds people who start a trial. Needs the StartTrial event from the SDK or MMP." },
              { value: "purchase", label: "Purchases", hint: "Finds people who pay. Needs the Purchase event; use once it fires often." },
            ]} />
            {form.objective !== "app_promotion" && <span className="text-xs text-muted">Website traffic optimises for clicks or landing page views.</span>}
          </div>
          <PlaybookTip id="abo-cbo" />
          <PlaybookTip id="deepest-event" />
        </Group>

        <Group title="Testing and scaling">
          <Field label="Testing campaign id"><input value={form.testing_campaign_id ?? ""} onChange={(e) => set({ testing_campaign_id: e.target.value || null })} inputMode="numeric" className={inputClass} /></Field>
          <Field label="Testing ad set id" hint="New drafts go here."><input value={form.testing_adset_id ?? ""} onChange={(e) => set({ testing_adset_id: e.target.value || null })} inputMode="numeric" className={inputClass} /></Field>
          <Field label="Scaling campaign id"><input value={form.scaling_campaign_id ?? ""} onChange={(e) => set({ scaling_campaign_id: e.target.value || null })} inputMode="numeric" className={inputClass} /></Field>
          <Field label="Scaling ad set id" hint="Promoted ads are copied here."><input value={form.scaling_adset_id ?? ""} onChange={(e) => set({ scaling_adset_id: e.target.value || null })} inputMode="numeric" className={inputClass} /></Field>
          <Field label="Testing daily budget" hint="Ad account currency; used when Launch creates the ad set."><input type="number" min={0} value={blank(form.testing_daily_budget)} onChange={(e) => set({ testing_daily_budget: numberOrNull(e.target.value) })} className={inputClass} /></Field>
          <Field label="Scaling daily budget"><input type="number" min={0} value={blank(form.scaling_daily_budget)} onChange={(e) => set({ scaling_daily_budget: numberOrNull(e.target.value) })} className={inputClass} /></Field>
          <Field label="Guardrail: max daily budget per ad set" hint="Setup refuses budgets above it; daily uploads stop if the testing ad set goes over it."><input type="number" min={0} value={blank(form.max_daily_budget)} onChange={(e) => set({ max_daily_budget: numberOrNull(e.target.value) })} className={inputClass} /></Field>
          <div className="flex items-end">
            <Button variant="secondary" size="sm" disabled={building || !saved} onClick={createStructure}>{building && <Spinner />}Create missing campaigns (paused)…</Button>
          </div>
        </Group>

        <Group title="Promotion rules" hint="A testing ad is suggested for scaling only when every rule passes, so one lucky day isn't a result.">
          <Field label="Target CAC" hint="Cost per conversion you're happy to pay (ad account currency)."><input type="number" min={0} value={t.targetCac || ""} onChange={(e) => rule({ targetCac: Number(e.target.value) || 0 })} className={inputClass} /></Field>
          <Field label="Judge by"><select value={t.conversionEvent} onChange={(e) => rule({ conversionEvent: e.target.value as Thresholds["conversionEvent"] })} className={inputClass}>
            <option value="trial">Trial starts</option><option value="purchase">Purchases</option><option value="install">Installs</option><option value="link_click">Link clicks</option>
          </select></Field>
          <Field label="Target ROAS" hint="Empty: don't judge ROAS (e.g. before revenue)."><input type="number" min={0} step="0.1" value={blank(t.targetRoas)} onChange={(e) => rule({ targetRoas: numberOrNull(e.target.value) })} className={inputClass} /></Field>
          <Field label="Minimum spend, × target CAC"><input type="number" min={0.5} step="0.5" value={t.minSpendMultiple} onChange={(e) => rule({ minSpendMultiple: Number(e.target.value) })} className={inputClass} /></Field>
          <Field label="Minimum conversions"><input type="number" min={1} value={t.minConversions} onChange={(e) => rule({ minConversions: Number(e.target.value) })} className={inputClass} /></Field>
          <Field label="Minimum days with spend"><input type="number" min={1} value={t.minDays} onChange={(e) => rule({ minDays: Number(e.target.value) })} className={inputClass} /></Field>
          <Field label="Confidence CAC is below target (%)"><input type="number" min={50} max={99} value={Math.round(t.confidence * 100)} onChange={(e) => rule({ confidence: Number(e.target.value) / 100 })} className={inputClass} /></Field>
          <Field label="Most conversions on one day (%)"><input type="number" min={20} max={100} value={Math.round(t.maxDayShare * 100)} onChange={(e) => rule({ maxDayShare: Number(e.target.value) / 100 })} className={inputClass} /></Field>
          <Field label="Pause after spend, × target CAC"><input type="number" min={0.5} step="0.5" value={t.pauseSpendMultiple} onChange={(e) => rule({ pauseSpendMultiple: Number(e.target.value) })} className={inputClass} /></Field>
          <Field label="…when this sure CAC is above target (%)"><input type="number" min={50} max={99} value={Math.round(t.pauseConfidence * 100)} onChange={(e) => rule({ pauseConfidence: Number(e.target.value) / 100 })} className={inputClass} /></Field>
        </Group>

        <div className="flex items-center justify-end gap-2 border-t border-line pt-4">
          {justSaved && <span className="mr-auto text-sm text-win">Saved.</span>}
          <Button variant="ghost" onClick={onCancel}>{justSaved ? "Close" : "Cancel"}</Button>
          <Button disabled={saving} onClick={save}>{saving && <Spinner />}Save settings</Button>
        </div>
      </Card>
    </Section>
  );
}

function Choice<T extends string>({ value, onChange, options, disabled }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; hint: string }[]; disabled?: boolean }) {
  return (
    <div className="grid gap-1.5">
      {options.map((o) => (
        <button key={o.value} type="button" disabled={disabled} onClick={() => onChange(o.value)} aria-pressed={value === o.value}
          className={cx("rounded-control border px-3 py-2 text-left text-sm transition-colors disabled:opacity-50", value === o.value ? "border-accent bg-accent-soft" : "border-hairline hover:bg-hover")}>
          <span className="block font-medium">{o.label}</span>
          <span className="block text-xs text-muted">{o.hint}</span>
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
