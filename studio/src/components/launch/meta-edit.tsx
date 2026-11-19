"use client";
// Editing an existing campaign or ad set: rename, change the budget or bid, the dates, or pause it.
// It never turns anything on. Budgets change only where they live (the campaign under CBO, the ad set
// under ABO); a rise of more than 20% shows the playbook's note but isn't blocked. The launch function
// plans the change first ("Check"), then applies it.
import { useEffect, useState } from "react";
import { BID_INFO, BID_STRATEGIES, type BidStrategy, budgetRaiseHint, validateEdit } from "@/lib/launch/rules";
import { type AdSetRow, type CampaignRow, type EditPlan, fromLocalInput, metaCall, MetaCallError, money, toLocalInput } from "@/lib/launch/send";
import { IconX } from "../icons";
import { MODAL, MODAL_OVERLAY, PanelPortal } from "../panel-portal";
import { Button, inputClass, Spinner } from "../ui";
import { Hint, Labeled, MoneyInput, Problems } from "./send-parts";

export function MetaEdit({ productId, level, row, currency, ownsBudget, onClose, onSaved }: {
  productId: string; level: "campaign" | "adset"; row: CampaignRow | AdSetRow; currency: string;
  /** Whether this object holds the budget (a CBO campaign, or an ad set under ABO). */
  ownsBudget: boolean;
  onClose: () => void; onSaved: () => void;
}) {
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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
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
    <PanelPortal>
      <div className={`${MODAL_OVERLAY} z-[46]`} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div role="dialog" aria-modal="true" aria-labelledby="meta-edit-title" className={`${MODAL} max-w-lg`}>
          <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-line bg-card px-5 py-3">
            <div className="min-w-0">
              <h2 id="meta-edit-title" className="text-title font-medium">Edit {level === "campaign" ? "campaign" : "ad set"}</h2>
              <p className="truncate text-xs text-muted">{row.name} · <a href={row.url} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">Ads Manager ↗</a></p>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="grid size-8 shrink-0 place-items-center rounded-control text-muted hover:bg-hover hover:text-ink"><IconX className="size-4" /></button>
          </header>
          <div className="grid gap-4 p-5">
            <Labeled label="Name"><input className={inputClass} value={name} maxLength={400} onChange={(e) => { setName(e.target.value); setPlan(null); }} /></Labeled>
            {ownsBudget ? (
              <>
                <Labeled label={lifetime ? "Lifetime budget" : "Daily budget"} hint={`Now ${money(currentBudget, currency)}${lifetime ? " in total" : " a day"}. Meta can't switch between daily and lifetime.`}>
                  <MoneyInput value={budget} onChange={(v) => { setBudget(v); setPlan(null); }} currency={currency} label="Budget" />
                </Labeled>
                {raise && <Hint>{raise}</Hint>}
                <Labeled label="Bid strategy" hint={BID_INFO[bidStrategy as BidStrategy]?.hint}>
                  <select className={inputClass} value={bidStrategy} onChange={(e) => { setBidStrategy(e.target.value); setPlan(null); }}>
                    {BID_STRATEGIES.map((b) => <option key={b} value={b}>{BID_INFO[b].label}</option>)}
                  </select>
                </Labeled>
                {level === "adset" && (bidStrategy === "COST_CAP" || bidStrategy === "LOWEST_COST_WITH_BID_CAP") && (
                  <Labeled label={bidStrategy === "COST_CAP" ? "Cost per result goal" : "Bid cap"}><MoneyInput value={bidAmount} onChange={(v) => { setBidAmount(v); setPlan(null); }} currency={currency} label="Bid amount" /></Labeled>
                )}
              </>
            ) : (
              <p className="text-xs text-muted">{level === "campaign" ? "This campaign has no budget of its own (ABO): change budgets on its ad sets." : "This ad set's campaign holds the budget (CBO): change the budget on the campaign."}</p>
            )}
            <Labeled label="End date" hint="Leave empty to keep it as it is."><input type="datetime-local" className={inputClass} value={endTime} onChange={(e) => { setEndTime(e.target.value); setPlan(null); }} /></Labeled>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={pause} onChange={(e) => { setPause(e.target.checked); setPlan(null); }} className="accent-[var(--color-accent)]" />
              Pause it {row.effectiveStatus === "ACTIVE" ? <span className="text-xs text-warn">(it’s running now)</span> : <span className="text-xs text-muted">(it’s {row.effectiveStatus.toLowerCase().replace(/_/g, " ")})</span>}
            </label>
            <p className="text-xs text-muted">Nothing is turned on from here: publish in Ads Manager.</p>
            {plan && (
              <div className="rounded-inner bg-raised p-3 text-sm shadow-raised">
                <p className="font-medium">Meta will receive</p>
                <dl className="mt-1">{plan.lines.map((l) => <div key={l.label} className="flex justify-between gap-3 border-t border-line py-1.5 first:border-t-0"><dt className="text-muted">{l.label}</dt><dd className="text-right">{l.value}</dd></div>)}</dl>
                {plan.hints.map((h) => <p key={h} className="mt-2 text-xs text-caution-ink">{h}</p>)}
              </div>
            )}
            <Problems list={problems.length ? problems : local.errors} />
          </div>
          <footer className="sticky bottom-0 flex justify-end gap-2 border-t border-line bg-card px-5 py-3">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            {plan
              ? <Button disabled={busy} onClick={() => run(true)}>{busy && <Spinner className="size-3.5" />}Apply</Button>
              : <Button variant="secondary" disabled={busy || !Object.keys(changes).length || local.errors.length > 0} onClick={() => run(false)}>{busy && <Spinner className="size-3.5" />}Check the change</Button>}
          </footer>
        </div>
      </div>
    </PanelPortal>
  );
}
