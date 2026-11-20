"use client";
// Editing an existing campaign or ad set: rename, change the budget or bid, the dates, or pause it.
// It never turns anything on. Budgets change only where they live (the campaign under CBO, the ad set
// under ABO); a rise of more than 20% shows the playbook's note but isn't blocked. The launch function
// plans the change first ("Check"), then applies it.
import { useState } from "react";
import { useT } from "@/lib/i18n/client";
import { BID_INFO, BID_STRATEGIES, type BidStrategy, budgetRaiseHint, validateEdit } from "@/lib/launch/rules";
import { type AdSetRow, type CampaignRow, type EditPlan, fromLocalInput, metaCall, MetaCallError, money, toLocalInput } from "@/lib/launch/send";
import { IconX } from "../icons";
import { MODAL, MODAL_OVERLAY, PanelPortal } from "../panel-portal";
import { Button, inputClass, Spinner } from "../ui";
import { planValue } from "./launch-words";
import { ruleText } from "./rules-words";
import { Hint, Labeled, MoneyInput, Problems, statusWord } from "./send-parts";

export function MetaEdit({ productId, level, row, currency, ownsBudget, onClose, onSaved }: {
  productId: string; level: "campaign" | "adset"; row: CampaignRow | AdSetRow; currency: string;
  /** Whether this object holds the budget (a CBO campaign, or an ad set under ABO). */
  ownsBudget: boolean;
  onClose: () => void; onSaved: () => void;
}) {
  const tr = useT();
  const { t, intl } = tr;
  const end = level === "campaign" ? (row as CampaignRow).stopTime : (row as AdSetRow).endTime;
  const [name, setName] = useState(row.name);
  const [budget, setBudget] = useState<number | null>(row.dailyBudget ?? row.lifetimeBudget);
  const [bidStrategy, setBidStrategy] = useState<string>(row.bidStrategy ?? "LOWEST_COST_WITHOUT_CAP");
  const [bidAmount, setBidAmount] = useState<number | null>(level === "adset" ? (row as AdSetRow).bidAmount : null);
  const [endTime, setEndTime] = useState(toLocalInput(end));
  const [pause, setPause] = useState(false);
  const [plan, setPlan] = useState<EditPlan | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const lifetime = row.lifetimeBudget != null;
  const currentBudget = row.dailyBudget ?? row.lifetimeBudget;

  const changes = {
    ...(name.trim() !== row.name ? { name: name.trim() } : {}),
    ...(ownsBudget && budget != null && budget !== currentBudget ? (lifetime ? { lifetimeBudget: budget } : { dailyBudget: budget }) : {}),
    ...(ownsBudget && bidStrategy !== (row.bidStrategy ?? "LOWEST_COST_WITHOUT_CAP") ? { bidStrategy } : {}),
    ...(ownsBudget && level === "adset" && bidAmount != null && bidAmount !== (row as AdSetRow).bidAmount ? { bidAmount } : {}),
    ...(endTime && fromLocalInput(endTime) !== (end ? new Date(end).toISOString() : null) ? { endTime: fromLocalInput(endTime) } : {}),
    ...(pause ? { pause: true } : {}),
  };
  const local = validateEdit({ level, budgetMode: level === "campaign" ? (ownsBudget ? "CBO" : "ABO") : ownsBudget ? "ABO" : "CBO", dailyBudget: row.dailyBudget, lifetimeBudget: row.lifetimeBudget, bidStrategy: row.bidStrategy, bidAmount: level === "adset" ? (row as AdSetRow).bidAmount : null }, { ...changes, bidStrategy: changes.bidStrategy as BidStrategy | undefined, endTime: changes.endTime ?? undefined });
  const raise = budgetRaiseHint(currentBudget, budget);

  async function run(confirm: boolean) {
    if (local.errors.length) return setProblems(local.errors);
    setBusy(true);
    setProblems([]);
    try {
      const r = await metaCall<{ plan?: EditPlan; updated?: string }>(productId, "edit", { level, id: row.id, changes, confirm });
      if (confirm) onSaved();
      else setPlan(r.plan ?? null);
    } catch (e) {
      setProblems(e instanceof MetaCallError && e.errors.length ? e.errors : [e instanceof Error ? e.message : String(e)]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <PanelPortal onClose={onClose}>
      <div className={`${MODAL_OVERLAY} z-[46]`} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div role="dialog" aria-modal="true" aria-labelledby="meta-edit-title" className={`${MODAL} max-w-lg`}>
          <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-line bg-card px-4 py-2.5">
            <div className="min-w-0">
              <h2 id="meta-edit-title" className="text-sm font-medium">{level === "campaign" ? t("Edit campaign") : t("Edit ad set")}</h2>
              <p className="truncate text-xs text-muted">{row.name} · <a href={row.url} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">{t("Ads Manager")} ↗</a></p>
            </div>
            <button type="button" onClick={onClose} aria-label={t("Close")} className="grid size-7 shrink-0 place-items-center rounded-control text-muted hover:bg-hover hover:text-ink"><IconX className="size-3.5" /></button>
          </header>
          <div className="grid gap-4 p-4">
            <Labeled label={t("Name")}><input className={inputClass} value={name} maxLength={400} onChange={(e) => { setName(e.target.value); setPlan(null); }} /></Labeled>
            {ownsBudget ? (
              <>
                <Labeled label={lifetime ? t("Lifetime budget") : t("Daily budget")} hint={lifetime
                  ? t("Now {amount} in total. Meta can't switch between daily and lifetime.", { amount: money(currentBudget, currency, intl) })
                  : t("Now {amount} a day. Meta can't switch between daily and lifetime.", { amount: money(currentBudget, currency, intl) })}>
                  <MoneyInput value={budget} onChange={(v) => { setBudget(v); setPlan(null); }} currency={currency} label={t("Budget")} />
                </Labeled>
                {raise && <Hint>{ruleText(tr, raise)}</Hint>}
                <Labeled label={t("Bid strategy")} hint={BID_INFO[bidStrategy as BidStrategy] ? t(BID_INFO[bidStrategy as BidStrategy].hint) : undefined}>
                  <select className={inputClass} value={bidStrategy} onChange={(e) => { setBidStrategy(e.target.value); setPlan(null); }}>
                    {BID_STRATEGIES.map((b) => <option key={b} value={b}>{t(BID_INFO[b].label)}</option>)}
                  </select>
                </Labeled>
                {level === "adset" && (bidStrategy === "COST_CAP" || bidStrategy === "LOWEST_COST_WITH_BID_CAP") && (
                  <Labeled label={bidStrategy === "COST_CAP" ? t("Cost per result goal") : t("Bid cap")}><MoneyInput value={bidAmount} onChange={(v) => { setBidAmount(v); setPlan(null); }} currency={currency} label={t("Bid amount")} /></Labeled>
                )}
              </>
            ) : (
              <p className="text-xs text-muted">{level === "campaign" ? t("This campaign has no budget of its own (ABO): change budgets on its ad sets.") : t("This ad set's campaign holds the budget (CBO): change the budget on the campaign.")}</p>
            )}
            <Labeled label={t("End date")} hint={t("Leave empty to keep it as it is.")}><input type="datetime-local" className={inputClass} value={endTime} onChange={(e) => { setEndTime(e.target.value); setPlan(null); }} /></Labeled>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={pause} onChange={(e) => { setPause(e.target.checked); setPlan(null); }} className="accent-[var(--color-accent)]" />
              {t("Pause it")} {row.effectiveStatus === "ACTIVE" ? <span className="text-xs text-warn">{t("(it’s running now)")}</span> : <span className="text-xs text-muted">{t("(now: {status})", { status: statusWord(tr, row.effectiveStatus) })}</span>}
            </label>
            <p className="text-xs text-muted">{t("Nothing is turned on from here: publish in Ads Manager.")}</p>
            {plan && (
              <div className="rounded-inner border border-line bg-raised p-3 text-sm">
                <p className="font-medium">{t("Meta will receive")}</p>
                <dl className="mt-1">{plan.lines.map((l) => <div key={l.label} className="flex justify-between gap-3 border-t border-line py-1.5 first:border-t-0"><dt className="text-muted">{t(l.label)}</dt><dd className="text-right">{planValue(tr, l.label, l.value)}</dd></div>)}</dl>
                {plan.hints.map((h) => <p key={h} className="mt-2 text-xs text-caution-ink">{ruleText(tr, h)}</p>)}
              </div>
            )}
            <Problems list={problems.length ? problems : local.errors} />
          </div>
          <footer className="sticky bottom-0 flex justify-end gap-2 border-t border-line bg-card px-4 py-2.5">
            <Button variant="ghost" onClick={onClose}>{t("Cancel")}</Button>
            {plan
              ? <Button disabled={busy} onClick={() => run(true)}>{busy && <Spinner className="size-3.5" />}{t("Apply")}</Button>
              : <Button variant="secondary" disabled={busy || !Object.keys(changes).length || local.errors.length > 0} onClick={() => run(false)}>{busy && <Spinner className="size-3.5" />}{t("Check the change")}</Button>}
          </footer>
        </div>
      </div>
    </PanelPortal>
  );
}
