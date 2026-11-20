"use client";
// Step 1 of "Send to Meta": where the ads go. The account's campaigns and their ad sets, live from
// Meta, with status, objective, budget and goal; each can be edited (rename, budget, bid, schedule,
// pause) without leaving the sheet.
import { useCallback, useEffect, useState } from "react";
import { useT } from "@/lib/i18n/client";
import type { Translator } from "@/lib/i18n/translate";
import type { Stage } from "@/lib/launch/naming";
import { BID_INFO, type BidStrategy, GOAL_INFO, type MetaObjective, OBJECTIVE_INFO } from "@/lib/launch/rules";
import { type AdSetRow, type CampaignRow, metaCall, money, type Paged } from "@/lib/launch/send";
import { IconPencil } from "../icons";
import { Badge, Button, cx, Segmented, Spinner } from "../ui";
import { MetaEdit } from "./meta-edit";
import { callErrorText } from "./launch-words";
import { Choice, Group, statusWord } from "./send-parts";

export type Mode = "existing" | "new-adset" | "new-campaign";

const STATUS_TONE = (s: string) => (s === "ACTIVE" ? "win" : s.includes("PAUSED") ? "neutral" : ["DISAPPROVED", "WITH_ISSUES"].includes(s) ? "warn" : "highlight") as "win" | "neutral" | "warn" | "highlight";

const objectiveLabel = ({ t }: Translator, o: string) => (OBJECTIVE_INFO[o as MetaObjective] ? t(OBJECTIVE_INFO[o as MetaObjective].label) : o);
const budgetText = ({ t, intl }: Translator, r: { budgetMode?: string; dailyBudget: number | null; lifetimeBudget: number | null }, currency: string, inherited = false) =>
  r.dailyBudget != null ? t("{amount}/day", { amount: money(r.dailyBudget, currency, intl) }) : r.lifetimeBudget != null ? t("{amount} total", { amount: money(r.lifetimeBudget, currency, intl) }) : inherited ? t("campaign budget") : t("budget on ad sets");

export function DestinationStep({ productId, mode, onMode, stage, onStage, campaign, onCampaign, adSet, onAdSet, preselect }: {
  productId: string;
  mode: Mode; onMode: (m: Mode) => void;
  stage: Stage; onStage: (s: Stage) => void;
  campaign: CampaignRow | null; onCampaign: (c: CampaignRow | null) => void;
  adSet: AdSetRow | null; onAdSet: (a: AdSetRow | null) => void;
  preselect: { campaignId: string | null; adSetId: string | null };
}) {
  const [campaigns, setCampaigns] = useState<CampaignRow[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [currency, setCurrency] = useState("USD");
  /** The ad sets read for one campaign (shown only while that campaign is picked). */
  const [adSetData, setAdSetData] = useState<{ campaignId: string; items: AdSetRow[] } | null>(null);
  const adSets = adSetData && adSetData.campaignId === campaign?.id ? adSetData.items : null;
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<{ level: "campaign" | "adset"; row: CampaignRow | AdSetRow } | null>(null);
  const [reloads, setReloads] = useState(0);
  const tr = useT();
  const { t } = tr;

  const fetchCampaigns = useCallback((after?: string | null) => metaCall<Paged<CampaignRow>>(productId, "campaigns", { after }), [productId]);
  const fetchAdSets = useCallback((campaignId: string) => metaCall<Paged<AdSetRow>>(productId, "adsets", { campaignId }), [productId]);

  // The first page of campaigns (again after an edit); starts on the workspace's testing (or scaling)
  // campaign when Launch settings name one.
  useEffect(() => {
    let live = true;
    fetchCampaigns().then((r) => {
      if (!live) return;
      setCurrency(r.currency);
      setCampaigns(r.items);
      setNext(r.next);
      setError(null);
      if (!campaign && !reloads && preselect.campaignId) {
        const found = r.items.find((c) => c.id === preselect.campaignId);
        if (found) onCampaign(found);
      }
    }).catch((e) => { if (live) setError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchCampaigns, reloads]);

  useEffect(() => {
    if (!campaign || mode === "new-campaign") return;
    let live = true;
    fetchAdSets(campaign.id).then((r) => {
      if (!live) return;
      setAdSetData({ campaignId: campaign.id, items: r.items });
      if (!adSet && preselect.adSetId && mode === "existing") {
        const found = r.items.find((a) => a.id === preselect.adSetId);
        if (found) onAdSet(found);
      }
    }).catch((e) => {
      if (!live) return;
      setError(e instanceof Error ? e.message : String(e));
      setAdSetData({ campaignId: campaign.id, items: [] });
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaign?.id, mode, fetchAdSets, reloads]);

  const more = async () => {
    if (!next) return;
    setLoading(true);
    try {
      const r = await fetchCampaigns(next);
      setCampaigns((list) => [...(list ?? []), ...r.items]);
      setNext(r.next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid gap-4">
      <Group title={t("Where should the ads go?")} hint={t("Everything is created paused. Nothing spends until you publish it in Ads Manager.")}>
        <Choice name="mode" value={mode} onChange={onMode} options={[
          { value: "existing", label: t("An existing ad set"), hint: t("Add the ads next to the ones already there.") },
          { value: "new-adset", label: t("A new ad set in an existing campaign"), hint: t("New targeting or budget inside a campaign you already have.") },
          { value: "new-campaign", label: t("A new campaign and ad set"), hint: t("Testing: one ABO campaign, about $20–50 a day per ad set. Scaling: one CBO campaign for proven winners.") },
        ]} />
        <div className="flex flex-wrap items-center gap-3">
          <Segmented label={t("Stage")} value={stage} onChange={onStage} options={[{ value: "TEST", label: t("Testing") }, { value: "SCALE", label: t("Scaling") }]} />
          <span className="text-xs text-muted">{stage === "TEST" ? t("Names say TEST so Measure can group results (new concepts at a small budget).") : t("Names say SCALE so Measure can group results (winners moved up).")}</span>
        </div>
      </Group>

      {mode !== "new-campaign" && (
        <Group title={t("Campaign")} hint={campaigns ? (next ? t("{n}+ in this ad account", { n: campaigns.length }) : t("{n} in this ad account", { n: campaigns.length })) : undefined}>
          {error && <p className="text-sm text-warn">{callErrorText(tr, error)}</p>}
          {!campaigns ? <div className="flex items-center gap-2 text-sm text-muted"><Spinner className="size-3.5" />{t("Reading campaigns from Meta…")}</div>
            : !campaigns.length ? <p className="text-sm text-muted">{t("No campaigns yet. Pick “A new campaign and ad set”.")}</p>
            : (
              <ul className="grid max-h-72 gap-1.5 overflow-y-auto pr-1">
                {campaigns.map((c) => (
                  <li key={c.id}>
                    <Row selected={campaign?.id === c.id} disabled={!c.supported} onSelect={() => onCampaign(campaign?.id === c.id ? null : c)} onEdit={() => setEditing({ level: "campaign", row: c })}
                      title={c.name} badges={<>
                        <Badge tone={STATUS_TONE(c.effectiveStatus)}>{statusWord(tr, c.effectiveStatus)}</Badge>
                        <Badge>{objectiveLabel(tr, c.objective)}</Badge>
                        <Badge tone={c.budgetMode === "CBO" ? "accent" : "neutral"}>{c.budgetMode}</Badge>
                      </>}
                      detail={`${budgetText(tr, c, currency)}${c.bidStrategy ? ` · ${BID_INFO[c.bidStrategy as BidStrategy] ? t(BID_INFO[c.bidStrategy as BidStrategy].label) : c.bidStrategy.toLowerCase().replace(/_/g, " ")}` : ""}${!c.supported ? ` · ${t("older objective: the API can't add ads to it")}` : ""}`} />
                  </li>
                ))}
              </ul>
            )}
          {next && <Button variant="ghost" size="sm" disabled={loading} onClick={more}>{loading && <Spinner className="size-3" />}{t("Load more")}</Button>}
        </Group>
      )}

      {mode === "existing" && campaign && (
        <Group title={t("Ad set")} hint={campaign.budgetMode === "CBO" ? t("This campaign holds the budget (CBO); its ad sets share it.") : t("Each ad set here has its own budget (ABO).")}>
          {!adSets ? <div className="flex items-center gap-2 text-sm text-muted"><Spinner className="size-3.5" />{t("Reading ad sets…")}</div>
            : !adSets.length ? <p className="text-sm text-muted">{t("This campaign has no ad sets. Pick “A new ad set in an existing campaign”.")}</p>
            : (
              <ul className="grid max-h-72 gap-1.5 overflow-y-auto pr-1">
                {adSets.map((a) => (
                  <li key={a.id}>
                    <Row selected={adSet?.id === a.id} onSelect={() => onAdSet(adSet?.id === a.id ? null : a)} onEdit={() => setEditing({ level: "adset", row: a })}
                      title={a.name} badges={<>
                        <Badge tone={STATUS_TONE(a.effectiveStatus)}>{statusWord(tr, a.effectiveStatus)}</Badge>
                        <Badge>{GOAL_INFO[a.optimizationGoal] ? t(GOAL_INFO[a.optimizationGoal].label) : a.optimizationGoal}</Badge>
                        <Badge>{tr.tn(a.ads, "{n} ad", "{n} ads")}</Badge>
                      </>}
                      detail={`${budgetText(tr, a, currency, campaign.budgetMode === "CBO")} · ${a.targeting}`} />
                  </li>
                ))}
              </ul>
            )}
        </Group>
      )}

      {editing && (
        <MetaEdit productId={productId} level={editing.level} row={editing.row} currency={currency}
          ownsBudget={editing.level === "campaign" ? (editing.row as CampaignRow).budgetMode === "CBO" : (campaigns?.find((c) => c.id === (editing.row as AdSetRow).campaignId)?.budgetMode ?? campaign?.budgetMode) === "ABO"}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setReloads((n) => n + 1); }} />
      )}
    </div>
  );
}

function Row({ selected, disabled, onSelect, onEdit, title, badges, detail }: { selected: boolean; disabled?: boolean; onSelect: () => void; onEdit: () => void; title: string; badges: React.ReactNode; detail: string }) {
  const { t } = useT();
  return (
    <div className={cx("flex items-start gap-2 rounded-inner border p-2.5 transition", selected ? "border-accent/60 bg-raised ring-1 ring-accent/30" : "border-line hover:border-hairline hover:bg-hover", disabled && "opacity-60")}>
      <button type="button" disabled={disabled} onClick={onSelect} aria-pressed={selected} className="min-w-0 flex-1 text-left disabled:cursor-not-allowed">
        <span className="flex items-start gap-2">
          <span className={cx("mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border text-[10px]", selected ? "border-transparent bg-accent-fill text-on-accent" : "border-hairline")}>{selected ? "✓" : ""}</span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{title}</span>
            <span className="mt-1 flex flex-wrap gap-1">{badges}</span>
            <span className="mt-1 block text-xs text-muted">{detail}</span>
          </span>
        </span>
      </button>
      <button type="button" onClick={onEdit} aria-label={t("Edit {name}", { name: title })} title={t("Rename, change the budget or bid, or pause")} className="grid size-7 shrink-0 place-items-center rounded-control text-muted hover:bg-hover hover:text-ink"><IconPencil className="size-3.5" /></button>
    </div>
  );
}
