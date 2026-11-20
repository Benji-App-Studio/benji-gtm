"use client";
// "Send to Meta": approved creatives → ads in any campaign and ad set of the workspace's ad account,
// with the same choices Meta's own Ads MCP offers. Steps: where the ads go (an existing ad set, a new
// ad set in an existing campaign, or a new campaign and ad set) → the new campaign → the new ad set →
// the ads → a plain-language review → "Create paused in Meta" → links and previews.
// Defaults come from the playbook and the Launch settings; advanced fields sit behind "More options".
// The sheet checks with rules.ts and the launch function checks again; everything it creates is
// PAUSED and nothing spends until someone publishes it in Ads Manager.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useCached } from "@/lib/client-cache";
import { useT } from "@/lib/i18n/client";
import { m } from "@/lib/i18n/translate";
import type { ApprovedCreative } from "@/lib/creatives";
import { adSetName, appCode, campaignName, day, slug, type Stage } from "@/lib/launch/naming";
import {
  type AdSetSpec, type AdSpec, type CampaignSpec, ctaFor, ctasFor, defaultAdSet, defaultCampaign, type DefaultsInput, defaultGoal, defaultPromoted,
  destinationsFor, goalsFor, type MetaObjective, OBJECTIVE_INFO, objectiveFromSettings, type ParentCampaign, type TargetingSpec,
  UNSUPPORTED_AD_DESTINATIONS, validateAd, validateAdSet, validateCampaign,
} from "@/lib/launch/rules";
import { type AdSetRow, type CampaignRow, type Connections, metaCall, MetaCallError, sendBody, type SendPlan, type SendResult } from "@/lib/launch/send";
import type { LaunchDraft, LaunchOverview } from "@/lib/launch/types";
import { IconRocket, IconX } from "../icons";
import { MODAL, MODAL_OVERLAY, PanelPortal } from "../panel-portal";
import { useFeatures } from "../studio/features";
import { Button, ConnectState, cx, IconButton, segmentClass, segmentTrackClass, Spinner } from "../ui";
import { type AdDraft, AdStep, toAdSpec } from "./send-ad";
import { AdSetStep } from "./send-adset";
import { CampaignStep } from "./send-campaign";
import { DestinationStep, type Mode } from "./send-destination";
import { Problems } from "./send-parts";
import { Results, Review } from "./send-review";

type StepId = "destination" | "campaign" | "adset" | "ads" | "review";
const STEP_LABEL: Record<StepId, string> = { destination: m("Destination"), campaign: m("Campaign"), adset: m("Ad set"), ads: m("Ads"), review: m("Review") };

/** The sheet, opened from the Launch page, the Studio's approved creatives and its job list. */
export function SendToMeta({ productId, open, onClose, initialIds = [] }: { productId: string; open: boolean; onClose: () => void; initialIds?: string[] }) {
  const [overview] = useCached<LaunchOverview & { error?: string }>(`/api/launch/${productId}`);
  // Opened from Studio too: without the Meta keys and this app's ad account and Page, it says what to connect.
  const lock = useFeatures(productId).locked("launch");
  const { t } = useT();
  if (!open) return null;
  return (
    <PanelPortal onClose={onClose}>
      <div className={`${MODAL_OVERLAY} z-[45]`} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div role="dialog" aria-modal="true" aria-labelledby="send-to-meta-title" className={`${MODAL} @container max-w-4xl`}>
          {lock && !overview?.status?.mock
            ? (
              <div className="relative">
                <h2 id="send-to-meta-title" className="sr-only">{t("Send to Meta")}</h2>
                <IconButton label={t("Close")} onClick={onClose} className="absolute top-3 right-3"><IconX /></IconButton>
                <ConnectState icon={<IconRocket />} title={lock.title} body={`${lock.body} ${t("Everything Launch creates is paused: nothing spends until you publish it in Ads Manager.")}`} href={lock.href} action={lock.action} className="py-12" />
              </div>
            )
            : !overview
            ? <div className="grid place-items-center p-12"><Spinner /></div>
            : overview.error
              ? <div className="p-4"><Problems title={t("Couldn't open Launch")} list={[overview.error]} /><Button className="mt-4" variant="secondary" onClick={onClose}>{t("Close")}</Button></div>
              : <SendSheet productId={productId} overview={overview} initialIds={initialIds} onClose={onClose} />}
        </div>
      </div>
    </PanelPortal>
  );
}

/** "us-gb-broad", "us-interests", "gb-custom". */
function audienceSlug(t: TargetingSpec) {
  const places = t.locations.slice(0, 3).map((l) => (l.type === "country" ? l.key : l.name)).join("-") || "nowhere";
  const kind = t.audiences?.length ? "custom" : t.interests?.length ? "interests" : "broad";
  return `${places}-${kind}`;
}

function SendSheet({ productId, overview, initialIds, onClose }: { productId: string; overview: LaunchOverview; initialIds: string[]; onClose: () => void }) {
  const { t, tn } = useT();
  const settings = overview.settings ?? overview.defaults;
  const currency = overview.status.account?.currency ?? "USD";
  const app = appCode(settings.meta.appName ?? overview.workspace.appName ?? "App", settings.app_code);
  const date = day();
  const baseObjective = objectiveFromSettings(settings.objective);
  const approved = overview.creatives;

  const defaultsFor = useCallback((objective: MetaObjective, stage: Stage): DefaultsInput => ({
    objective, stage, countries: settings.countries ?? ["US"], appId: settings.meta.appId, appStoreUrl: settings.meta.appStoreUrl,
    pixelId: settings.meta.pixelId, pageId: settings.meta.pageId, optimizeFor: settings.optimize_for,
    testingBudget: settings.testing_daily_budget, scalingBudget: settings.scaling_daily_budget, appName: settings.meta.appName ?? overview.workspace.appName,
  }), [settings, overview.workspace.appName]);
  const nameCampaign = (objective: MetaObjective, stage: Stage) => campaignName({ app, stage, objective: slug(OBJECTIVE_INFO[objective].label), date });
  const nameAdSet = (tg: TargetingSpec, stage: Stage) => adSetName({ app, stage, audience: audienceSlug(tg), date });
  const linkFor = (objective: MetaObjective) => (objective === "OUTCOME_APP_PROMOTION" ? settings.meta.appStoreUrl : settings.meta.websiteUrl) ?? "";

  const [stage, setStage] = useState<Stage>("TEST");
  const [mode, setMode] = useState<Mode>(settings.testing_adset_id ? "existing" : "new-campaign");
  const [campaignRow, setCampaignRow] = useState<CampaignRow | null>(null);
  const [adSetRow, setAdSetRow] = useState<AdSetRow | null>(null);
  const [campaign, setCampaign] = useState<CampaignSpec>(() => defaultCampaign(nameCampaign(baseObjective, "TEST"), defaultsFor(baseObjective, "TEST")));
  const [adSet, setAdSet] = useState<AdSetSpec>(() => {
    const d = defaultsFor(baseObjective, "TEST");
    const a = defaultAdSet("", d, { objective: baseObjective, budgetMode: "ABO" });
    return { ...a, name: nameAdSet(a.targeting, "TEST") };
  });
  const firstPicked = approved.find((c) => initialIds.includes(c.id));
  const [picked, setPicked] = useState<string[]>(() => initialIds.filter((id) => approved.some((c) => c.id === id)));
  const [ad, setAd] = useState<AdDraft>(() => ({
    format: "single", pageId: settings.meta.pageId ?? "", instagramId: settings.meta.instagramId ?? "",
    primaryText: firstPicked?.primaryText ?? "", headline: firstPicked?.headline ?? "", description: firstPicked?.description ?? "",
    cta: ctaFor(firstPicked?.cta ?? settings.default_cta, baseObjective), link: linkFor(baseObjective), displayLink: "", urlTags: "",
    // Model-made creatives start as "made with AI"; the person can still change it.
    advantageCreative: false, aiDisclosure: approved.some((c) => initialIds.includes(c.id) && c.aiGenerated) ? "OPT_IN" : null, ownCopy: true, cards: {}, placements: {},
  }));
  const [connections, setConnections] = useState<Connections | null>(null);
  const [connectionsError, setConnectionsError] = useState<string | null>(null);
  const [step, setStep] = useState<StepId>("destination");
  const [problems, setProblems] = useState<string[]>([]);
  const [plan, setPlan] = useState<SendPlan | null>(null);
  const [result, setResult] = useState<SendResult | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    metaCall<Connections>(productId, "connections").then((c) => {
      setConnections(c);
      // No Page in Launch settings: start on the account's first Page (and its Instagram account).
      setAd((x) => (x.pageId || !c.pages[0] ? x : { ...x, pageId: c.pages[0].id, instagramId: x.instagramId || c.pages[0].instagram?.id || "" }));
    }).catch((e) => setConnectionsError(e instanceof Error ? e.message : String(e)));
  }, [productId]);

  // The campaign the ads go under, new or existing, and its objective.
  const parent: ParentCampaign | null = mode === "new-campaign"
    ? { objective: campaign.objective, budgetMode: campaign.budgetMode, lifetime: campaign.lifetimeBudget != null, bidStrategy: campaign.bidStrategy, specialAdCategories: campaign.specialAdCategories }
    : campaignRow?.supported
      ? { objective: campaignRow.objective as MetaObjective, budgetMode: campaignRow.budgetMode, lifetime: campaignRow.lifetimeBudget != null, bidStrategy: campaignRow.bidStrategy, specialAdCategories: campaignRow.specialAdCategories }
      : null;
  const objective = parent?.objective ?? baseObjective;
  const destination = mode === "existing" ? adSetRow?.destinationType ?? null : adSet.destinationType ?? null;

  /** Keeps the ad set and the ads valid for a new parent: the goal, its event, where the budget lives, the button and link. */
  const reconcile = useCallback((p: ParentCampaign, nextStage: Stage) => {
    const d = defaultsFor(p.objective, nextStage);
    setAdSet((a) => {
      let next = { ...a };
      if (!goalsFor(p.objective).includes(a.optimizationGoal)) {
        const { goal, event } = defaultGoal({ objective: p.objective, optimizeFor: d.optimizeFor, pixelId: d.pixelId });
        const dest = destinationsFor(p.objective, goal).options[0] ?? null;
        next = { ...next, optimizationGoal: goal, billingEvent: "IMPRESSIONS", destinationType: dest, promotedObject: defaultPromoted(p.objective, goal, dest, d, event) };
      }
      if (p.budgetMode === "CBO") next = { ...next, dailyBudget: null, lifetimeBudget: null, bidStrategy: null, bidAmount: null, roasFloor: null };
      else if (next.dailyBudget == null && next.lifetimeBudget == null) next = { ...next, dailyBudget: d.testingBudget ?? 20, bidStrategy: "LOWEST_COST_WITHOUT_CAP" };
      return next;
    });
    setAd((x) => ({
      ...x,
      cta: ctasFor(p.objective).includes(x.cta) ? x.cta : ctaFor(x.cta, p.objective),
      link: !x.link || x.link === linkFor("OUTCOME_APP_PROMOTION") || x.link === linkFor("OUTCOME_TRAFFIC") ? linkFor(p.objective) || x.link : x.link,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultsFor]);

  const pickCampaign = (row: CampaignRow | null) => {
    setCampaignRow(row);
    setAdSetRow(null);
    // A campaign named by the convention says its stage ("ACME | SCALE | campaign | …"): the ads' names follow it.
    const named = row?.name.match(/^[A-Z0-9]{2,6} \| (TEST|SCALE) \| campaign \|/)?.[1] as Stage | undefined;
    const nextStage = named ?? stage;
    if (named && named !== stage) setStage(named);
    if (row?.supported) reconcile({ objective: row.objective as MetaObjective, budgetMode: row.budgetMode, lifetime: row.lifetimeBudget != null }, nextStage);
  };
  const changeMode = (m: Mode) => {
    setMode(m);
    setProblems([]);
    if (m === "new-campaign") reconcile({ objective: campaign.objective, budgetMode: campaign.budgetMode }, stage);
    else if (campaignRow?.supported) reconcile({ objective: campaignRow.objective as MetaObjective, budgetMode: campaignRow.budgetMode }, stage);
  };
  const changeStage = (s: Stage) => {
    setStage(s);
    // The playbook: testing is ABO (budgets per ad set), scaling is CBO (budget on the campaign).
    const next = defaultCampaign(nameCampaign(campaign.objective, s), defaultsFor(campaign.objective, s));
    setCampaign((c) => ({ ...c, name: c.name === nameCampaign(c.objective, stage) ? next.name : c.name, budgetMode: next.budgetMode, dailyBudget: next.dailyBudget, lifetimeBudget: null, bidStrategy: next.bidStrategy }));
    setAdSet((a) => ({ ...a, name: a.name === nameAdSet(a.targeting, stage) ? nameAdSet(a.targeting, s) : a.name }));
    if (mode === "new-campaign") reconcile({ objective: campaign.objective, budgetMode: next.budgetMode }, s);
  };
  const changeCampaign = (next: CampaignSpec) => {
    const objectiveChanged = next.objective !== campaign.objective;
    const named = campaign.name === nameCampaign(campaign.objective, stage);
    const c = objectiveChanged ? { ...next, name: named ? nameCampaign(next.objective, stage) : next.name, skadnetwork: next.objective === "OUTCOME_APP_PROMOTION" } : next;
    setCampaign(c);
    if (objectiveChanged || next.budgetMode !== campaign.budgetMode) reconcile({ objective: c.objective, budgetMode: c.budgetMode, lifetime: c.lifetimeBudget != null }, stage);
  };
  const changeAdSet = (next: AdSetSpec) => {
    // Keep the convention name in step with the places picked, unless it was renamed by hand.
    const named = adSet.name === nameAdSet(adSet.targeting, stage);
    setAdSet(named ? { ...next, name: nameAdSet(next.targeting, stage) } : next);
  };

  const steps: StepId[] = ["destination", ...(mode === "new-campaign" ? ["campaign" as const] : []), ...(mode !== "existing" ? ["adset" as const] : []), "ads", "review"];
  const index = steps.indexOf(step);
  const adSpec: AdSpec = useMemo(() => toAdSpec(ad, picked, approved), [ad, picked, approved]);

  function check(id: StepId): string[] {
    const cap = settings.max_daily_budget;
    switch (id) {
      case "destination": {
        if (mode === "new-campaign") return [];
        if (!campaignRow) return [t("Pick a campaign.")];
        if (!campaignRow.supported) return [t("That campaign uses an older objective ({objective}) the API can't add to. Pick another or make a new one.", { objective: campaignRow.objective })];
        if (mode === "existing" && !adSetRow) return [t("Pick an ad set.")];
        if (mode === "existing" && adSetRow?.destinationType && UNSUPPORTED_AD_DESTINATIONS[adSetRow.destinationType]) return [UNSUPPORTED_AD_DESTINATIONS[adSetRow.destinationType]];
        if (mode === "existing" && adSetRow && adSetRow.ads >= 50) return [t("That ad set already holds 50 ads, Meta's limit.")];
        return [];
      }
      case "campaign": {
        const out = validateCampaign(campaign);
        if (cap != null && campaign.budgetMode === "CBO" && campaign.dailyBudget != null && campaign.dailyBudget > cap) out.push(t("The daily budget is over the {cap} {currency} guardrail in Launch settings.", { cap, currency }));
        return out;
      }
      case "adset": {
        if (!parent) return [t("Pick the campaign first.")];
        const out = validateAdSet(adSet, parent);
        if (cap != null && parent.budgetMode === "ABO" && adSet.dailyBudget != null && adSet.dailyBudget > cap) out.push(t("The daily budget is over the {cap} {currency} guardrail in Launch settings.", { cap, currency }));
        return out;
      }
      case "ads":
        return validateAd(adSpec, objective, destination);
      default:
        return [];
    }
  }

  const body = (confirm: boolean) => sendBody({ stage, mode, campaign, campaignId: campaignRow?.id, adSet, adSetId: adSetRow?.id, ad: adSpec, creativeIds: picked, confirm });

  async function next() {
    const list = check(step);
    setProblems(list);
    if (list.length) return;
    const following = steps[index + 1];
    if (following === "review") {
      setBusy(true);
      try {
        const r = await metaCall<{ plan: SendPlan }>(productId, "send", body(false));
        setPlan(r.plan);
        setStep("review");
      } catch (e) {
        setProblems(e instanceof MetaCallError && e.errors.length ? e.errors : [e instanceof Error ? e.message : String(e)]);
      } finally {
        setBusy(false);
      }
      return;
    }
    setStep(following);
  }

  async function create() {
    setBusy(true);
    setProblems([]);
    try {
      setResult(await metaCall<SendResult>(productId, "send", body(true)));
    } catch (e) {
      const list = e instanceof MetaCallError && e.errors.length ? e.errors : [e instanceof Error ? e.message : String(e)];
      setProblems(list);
      // A campaign that was made before something failed is kept (Launch never deletes): use it next time.
      const kept = e instanceof MetaCallError ? (e.extra.created as SendResult["created"] | undefined) : undefined;
      if (kept?.campaign) setProblems([...list, t("The campaign “{name}” was created (paused). Pick it under “A new ad set in an existing campaign” to try again.", { name: kept.campaign.name })]);
    } finally {
      setBusy(false);
    }
  }

  const [drafts] = useCached<LaunchDraft[]>(`/api/launch/${productId}/drafts`);

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-10 border-b border-line bg-card">
      <header className="flex items-start justify-between gap-4 px-4 pt-3 pb-2">
        <div className="min-w-0">
          <h2 id="send-to-meta-title" className="text-sm font-medium">{t("Send to Meta")}</h2>
          <p className="text-xs text-muted">{overview.status.account ? `${overview.status.account.name} · ${currency}` : settings.meta.adAccountId ? t("Ad account {id}", { id: settings.meta.adAccountId }) : t("No ad account yet")} · {t("everything is created paused")}</p>
        </div>
        <IconButton label={t("Close")} onClick={onClose}><IconX /></IconButton>
      </header>
      {!result && (
        <nav aria-label={t("Steps")} className={cx("no-scrollbar overflow-x-auto px-4 pb-2.5", segmentTrackClass)}>
          {steps.map((s, i) => (
            <button key={s} type="button" disabled={i > index} onClick={() => { setProblems([]); setStep(s); }}
              className={cx(segmentClass(s === step), s !== step && i < index && "text-ink", i > index && "text-faint hover:bg-transparent hover:text-faint")}>
              {i + 1}. {t(STEP_LABEL[s])}
            </button>
          ))}
        </nav>
      )}
      </div>

      <div className="px-4 py-4">
        <div className="grid gap-4">
          {!overview.status.connected && <Problems title={t("Meta isn't connected")} list={[t("Add the Meta system user token and app secret in Settings › Your keys, then this app's ad account and Page in its connections.")]} />}
          {connectionsError && <Problems title={t("Couldn't read the ad account")} list={[connectionsError]} />}
          {result ? (
            <Results productId={productId} result={result} drafts={drafts ?? []} adAccountId={settings.meta.adAccountId} />
          ) : step === "destination" ? (
            <DestinationStep productId={productId} mode={mode} onMode={changeMode} stage={stage} onStage={changeStage}
              campaign={campaignRow} onCampaign={pickCampaign} adSet={adSetRow} onAdSet={setAdSetRow}
              preselect={{ campaignId: stage === "SCALE" ? settings.scaling_campaign_id : settings.testing_campaign_id, adSetId: stage === "SCALE" ? settings.scaling_adset_id : settings.testing_adset_id }} />
          ) : step === "campaign" ? (
            <CampaignStep value={campaign} onChange={changeCampaign} currency={currency} stage={stage} />
          ) : step === "adset" && parent ? (
            <AdSetStep productId={productId} value={adSet} onChange={changeAdSet} parent={parent} currency={currency} connections={connections} stage={stage} />
          ) : step === "ads" ? (
            <AdStep value={ad} onChange={setAd} objective={objective} approved={approved} picked={picked} onPicked={setPicked} connections={connections} />
          ) : step === "review" && plan ? (
            <Review plan={plan} creatives={picked.map((id) => approved.find((c) => c.id === id)).filter(Boolean) as ApprovedCreative[]} />
          ) : null}
          <Problems list={problems} />
        </div>
      </div>

      <footer className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 border-t border-line bg-card px-4 py-2.5">
        {result ? (
          <>
            <span className="text-xs text-muted">{t(result.note)}</span>
            <Button onClick={onClose}>{t("Done")}</Button>
          </>
        ) : (
          <>
            <Button variant="ghost" disabled={index === 0 || busy} onClick={() => { setProblems([]); setStep(steps[index - 1]); }}>{t("Back")}</Button>
            <span className="hidden text-xs text-muted @md:block">{step === "review" ? t("Everything is created paused. Nothing spends until you publish it in Ads Manager.") : tn(picked.length, "{n} creative picked", "{n} creatives picked")}</span>
            {step === "review"
              ? <Button disabled={busy || !overview.status.connected} onClick={create}>{busy && <Spinner className="size-3.5" />}{t("Create paused in Meta")}</Button>
              : <Button disabled={busy} onClick={next}>{busy && <Spinner className="size-3.5" />}{steps[index + 1] === "review" ? t("Review") : t("Next")}</Button>}
          </>
        )}
      </footer>
    </div>
  );
}
