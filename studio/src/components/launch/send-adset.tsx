"use client";
// Step 3 of "Send to Meta" (new ad sets): what Meta optimises for and what it promotes, the budget
// (only under an ABO campaign), who sees the ads and where. Broad targeting with Advantage+ audience
// and Advantage+ placements is the default; bidding, dates, day-parting, frequency caps, attribution,
// custom audiences, excluded places and languages sit behind "More options".
import { useEffect, useState } from "react";
import type { Stage } from "@/lib/launch/naming";
import {
  type AdSetSpec, APP_EVENTS, BID_INFO, BID_STRATEGIES, type BidStrategy, billingFor, DESTINATION_INFO, destinationsFor, GOAL_INFO, goalsFor,
  type GeoPick, type ParentCampaign, PIXEL_EVENTS, promotedNeed, targetsEu, type TargetingSpec,
} from "@/lib/launch/rules";
import { type Connections, fromLocalInput, metaCall, type SearchHit, toLocalInput } from "@/lib/launch/send";
import { cx, inputClass, Segmented, Toggle } from "../ui";
import { Chips, Group, Hint, Labeled, MoneyInput, MoreOptions, PlacementPicker, SearchPicker } from "./send-parts";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const label = (s: string) => s.toLowerCase().replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
const geoFromHit = (h: SearchHit): GeoPick => ({ key: h.id, name: h.name, type: h.type ?? "country", countryCode: h.countryCode ?? (h.type === "country" ? h.id : undefined) });

export function AdSetStep({ productId, value: a, onChange, parent, currency, connections, stage }: {
  productId: string; value: AdSetSpec; onChange: (a: AdSetSpec) => void; parent: ParentCampaign; currency: string; connections: Connections | null; stage: Stage;
}) {
  const set = (patch: Partial<AdSetSpec>) => onChange({ ...a, ...patch });
  const t = a.targeting;
  const setT = (patch: Partial<TargetingSpec>) => set({ targeting: { ...t, ...patch } });
  const po = a.promotedObject ?? {};
  const setPo = (patch: Partial<NonNullable<AdSetSpec["promotedObject"]>>) => set({ promotedObject: { ...po, ...patch } });
  const objective = parent.objective;
  const need = promotedNeed(objective, a.optimizationGoal, a.destinationType);
  const dest = destinationsFor(objective, a.optimizationGoal);
  const abo = parent.budgetMode === "ABO";
  const lifetime = a.lifetimeBudget != null;
  const strategy = (a.bidStrategy ?? "LOWEST_COST_WITHOUT_CAP") as BidStrategy;
  const eu = targetsEu(t);

  const changeGoal = (goal: string) => {
    const d = destinationsFor(objective, goal);
    const destination = d.options.includes(a.destinationType ?? "") ? a.destinationType : d.options[0] ?? null;
    const n = promotedNeed(objective, goal, destination);
    const promoted = n.need === "page" ? { pageId: po.pageId ?? connections?.pages[0]?.id }
      : n.need === "app" ? { applicationId: po.applicationId, objectStoreUrl: po.objectStoreUrl }
      : n.need === "app_event" ? { applicationId: po.applicationId, objectStoreUrl: po.objectStoreUrl, customEventType: po.customEventType ?? "START_TRIAL" }
      : n.need === "pixel_event" ? { pixelId: po.pixelId ?? connections?.pixels[0]?.id, customEventType: po.customEventType ?? "PURCHASE" }
      : goal === "LANDING_PAGE_VIEWS" && (po.pixelId ?? connections?.pixels[0]?.id) ? { pixelId: po.pixelId ?? connections?.pixels[0]?.id } : {};
    set({
      optimizationGoal: goal, destinationType: destination, promotedObject: { ...promoted, applicationId: promoted.applicationId ?? po.applicationId, objectStoreUrl: promoted.objectStoreUrl ?? po.objectStoreUrl },
      billingEvent: billingFor(goal).includes(a.billingEvent) ? a.billingEvent : "IMPRESSIONS", frequencyCap: goal === "REACH" ? a.frequencyCap : null,
    });
  };

  // Meta's audience estimate for the current targeting (a hint; refreshed a moment after changes).
  const [estimate, setEstimate] = useState<{ lower: number; upper: number } | null | "loading">(null);
  const key = JSON.stringify([a.optimizationGoal, t, po.objectStoreUrl]);
  useEffect(() => {
    if (!t.locations.length) return;
    let live = true;
    const timer = setTimeout(() => {
      setEstimate("loading");
      metaCall<{ estimate: { lower: number; upper: number } | null }>(productId, "estimate", { objective, adSet: a })
        .then((r) => { if (live) setEstimate(r.estimate); }).catch(() => { if (live) setEstimate(null); });
    }, 900);
    return () => { live = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, productId, objective]);
  const compact = (n: number) => Intl.NumberFormat("en", { notation: "compact" }).format(n);

  const pixels = connections?.pixels ?? (po.pixelId ? [{ id: po.pixelId, name: "Pixel from Launch settings", lastFired: null }] : []);
  const block = a.schedule?.[0] ?? null;

  return (
    <div className="grid gap-5">
      <Group title="Ad set">
        <Labeled label="Name" hint="Follows the naming convention; it updates with the places you pick unless you rename it.">
          <input className={inputClass} value={a.name} maxLength={400} onChange={(e) => set({ name: e.target.value })} />
        </Labeled>
        <Labeled label="Optimise for" hint={GOAL_INFO[a.optimizationGoal]?.hint}>
          <select className={inputClass} value={a.optimizationGoal} onChange={(e) => changeGoal(e.target.value)}>
            {goalsFor(objective).map((g, i) => <option key={g} value={g}>{GOAL_INFO[g]?.label ?? g}{i === 0 ? " (default)" : ""}</option>)}
          </select>
        </Labeled>
        <p className="text-xs text-muted">The playbook: optimise for the deepest event that still happens often (a trial or purchase over an install), so Meta learns who pays.</p>

        {(need.need === "app" || need.need === "app_event") && (
          <div className="grid gap-3 @lg:grid-cols-2">
            <Labeled label="App" hint={po.applicationId ? `Meta app ${po.applicationId}` : "Add the Meta app id in Launch settings."}>
              <input className={inputClass} value={po.objectStoreUrl ?? ""} placeholder="https://apps.apple.com/app/id…" onChange={(e) => setPo({ objectStoreUrl: e.target.value })} />
            </Labeled>
            {need.need === "app_event" && (
              <Labeled label="App event" hint="Sent by the Meta SDK (or your MMP) from the app.">
                <select className={inputClass} value={po.customEventType ?? ""} onChange={(e) => setPo({ customEventType: e.target.value })}>
                  {APP_EVENTS.map((e) => <option key={e} value={e}>{label(e)}</option>)}
                </select>
              </Labeled>
            )}
          </div>
        )}
        {need.need === "pixel_event" && (
          <div className="grid gap-3 @lg:grid-cols-2">
            <Labeled label="Pixel" hint={pixels.length ? "The website's Meta pixel (or dataset)." : "Connect a pixel in Launch settings: this goal needs one."}>
              <select className={inputClass} value={po.customConversionId ? `cc:${po.customConversionId}` : po.pixelId ?? ""} onChange={(e) => e.target.value.startsWith("cc:")
                ? setPo({ customConversionId: e.target.value.slice(3), pixelId: undefined, customEventType: undefined })
                : setPo({ pixelId: e.target.value || undefined, customConversionId: undefined, customEventType: po.customEventType ?? "PURCHASE" })}>
                <option value="">Pick…</option>
                {pixels.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                {connections?.customConversions.length ? <optgroup label="Custom conversions">{connections.customConversions.map((c) => <option key={c.id} value={`cc:${c.id}`}>{c.name}</option>)}</optgroup> : null}
              </select>
            </Labeled>
            {!po.customConversionId && (
              <Labeled label="Event">
                <select className={inputClass} value={po.customEventType ?? ""} onChange={(e) => setPo({ customEventType: e.target.value })}>
                  {PIXEL_EVENTS.map((e) => <option key={e} value={e}>{label(e)}</option>)}
                </select>
              </Labeled>
            )}
          </div>
        )}
        {need.need === "page" && (
          <Labeled label="Facebook Page">
            <select className={inputClass} value={po.pageId ?? ""} onChange={(e) => setPo({ pageId: e.target.value })}>
              <option value="">Pick…</option>
              {(connections?.pages ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Labeled>
        )}
        {dest.required && dest.options.length > 1 && (
          <Labeled label="Send people to">
            <select className={inputClass} value={a.destinationType ?? ""} onChange={(e) => set({ destinationType: e.target.value })}>
              {dest.options.map((d) => <option key={d} value={d}>{DESTINATION_INFO[d] ?? d}</option>)}
            </select>
          </Labeled>
        )}
      </Group>

      {abo ? (
        <Group title="Budget" hint="This campaign gives each ad set its own budget (ABO).">
          <div className="grid gap-3 @lg:grid-cols-2">
            <Labeled label={lifetime ? "Lifetime budget" : "Daily budget"} hint={stage === "TEST" ? "Testing: about $20–50 a day per ad set, with about 5 ads in it." : "Raise winners about 20% every 48 h."}>
              <div className="grid gap-2">
                <Segmented label="Budget type" value={lifetime ? "lifetime" : "daily"} onChange={(v) => set(v === "lifetime" ? { lifetimeBudget: a.dailyBudget ? a.dailyBudget * 7 : 140, dailyBudget: null } : { dailyBudget: a.lifetimeBudget ? Math.round(a.lifetimeBudget / 7) : 20, lifetimeBudget: null, schedule: [] })}
                  options={[{ value: "daily", label: "Daily" }, { value: "lifetime", label: "Lifetime" }]} />
                <MoneyInput value={lifetime ? a.lifetimeBudget : a.dailyBudget} onChange={(v) => set(lifetime ? { lifetimeBudget: v } : { dailyBudget: v })} currency={currency} label="Ad set budget" />
              </div>
            </Labeled>
            {lifetime && <Labeled label="Ends" hint="A lifetime budget needs an end date."><input type="datetime-local" className={inputClass} value={toLocalInput(a.endTime)} onChange={(e) => set({ endTime: fromLocalInput(e.target.value) })} /></Labeled>}
          </div>
        </Group>
      ) : (
        <p className="text-xs text-muted">The campaign holds the budget and the bid strategy (CBO), so this ad set has none of its own.</p>
      )}

      <Group title="Who sees the ads" hint="Broad targeting usually wins: the creative tells Meta who it's for.">
        <Labeled label="Places">
          <div className="grid gap-2">
            <Chips items={t.locations} label={(l) => `${l.name}${l.type !== "country" ? ` (${l.type})` : ""}`} onRemove={(i) => setT({ locations: t.locations.filter((_, j) => j !== i) })} />
            <SearchPicker productId={productId} kind="geo" placeholder="Add a country, region or city" exclude={t.locations.map((l) => l.key)} onPick={(h) => setT({ locations: [...t.locations, geoFromHit(h)] })} />
          </div>
        </Labeled>
        <label className="flex items-start gap-3 text-sm">
          <Toggle checked={t.advantageAudience} onChange={(v) => setT({ advantageAudience: v })} label="Advantage+ audience" />
          <span><span className="font-medium">Advantage+ audience</span><span className="block text-xs text-muted">{t.advantageAudience ? "On: the ages and interests below are suggestions. Meta may show the ads to people outside them when it expects better results." : "Off: the ages and interests below are hard limits."}</span></span>
        </label>
        <div className="grid gap-3 @lg:grid-cols-3">
          <Labeled label="Youngest"><select className={inputClass} value={t.ageMin} onChange={(e) => setT({ ageMin: Number(e.target.value) })}>{Array.from({ length: 53 }, (_, i) => i + 13).map((n) => <option key={n} value={n}>{n}</option>)}</select></Labeled>
          <Labeled label="Oldest"><select className={inputClass} value={t.ageMax} onChange={(e) => setT({ ageMax: Number(e.target.value) })}>{Array.from({ length: 53 }, (_, i) => i + 13).map((n) => <option key={n} value={n}>{n === 65 ? "65+" : n}</option>)}</select></Labeled>
          <Labeled label="Gender"><Segmented label="Gender" value={t.genders} onChange={(g) => setT({ genders: g })} options={[{ value: "all", label: "All" }, { value: "men", label: "Men" }, { value: "women", label: "Women" }]} /></Labeled>
        </div>
        <Labeled label="Interests" hint="Optional. Only from Meta's search, so every interest is real. Most tests run without any.">
          <div className="grid gap-2">
            <Chips items={t.interests ?? []} label={(i) => i.name} onRemove={(i) => setT({ interests: (t.interests ?? []).filter((_, j) => j !== i) })} />
            <SearchPicker productId={productId} kind="interest" placeholder="Search interests (fitness, cooking…)" exclude={(t.interests ?? []).map((i) => i.id)} onPick={(h) => setT({ interests: [...(t.interests ?? []), { id: h.id, name: h.name }] })} />
          </div>
        </Labeled>
        <p className="text-xs text-muted">
          {estimate === "loading" ? "Estimating the audience…" : estimate ? `About ${compact(estimate.lower)}–${compact(estimate.upper)} people a month (Meta's estimate).` : "Meta's audience estimate shows here."}
        </p>
      </Group>

      <Group title="Where the ads show">
        <Segmented label="Placements" value={t.placements === "advantage" ? "advantage" : "manual"} onChange={(v) => setT({ placements: v === "advantage" ? "advantage" : { publisher_platforms: ["facebook", "instagram"] } })}
          options={[{ value: "advantage", label: "Advantage+ placements" }, { value: "manual", label: "Pick placements" }]} />
        <p className="text-xs text-muted">{t.placements === "advantage" ? "Meta shows the ads wherever they'll do best: Feeds, Stories, Reels and more. Recommended." : "Only where you pick. Fewer places usually costs more per result."}</p>
        {t.placements !== "advantage" && <PlacementPicker value={t.placements} onChange={(rule) => setT({ placements: rule })} objective={objective} />}
      </Group>

      {eu && (
        <Group title="EU transparency (Digital Services Act)" hint="Ads shown in the EU name who benefits from them and who pays for them.">
          <div className="grid gap-3 @lg:grid-cols-2">
            <Labeled label="Who benefits"><input className={inputClass} value={a.dsaBeneficiary ?? ""} onChange={(e) => set({ dsaBeneficiary: e.target.value })} /></Labeled>
            <Labeled label="Who pays"><input className={inputClass} value={a.dsaPayor ?? ""} onChange={(e) => set({ dsaPayor: e.target.value })} /></Labeled>
          </div>
        </Group>
      )}

      <MoreOptions>
        {!dest.required && dest.options.length > 0 && (
          <Labeled label="Send people to" hint="Usually the website.">
            <select className={inputClass} value={a.destinationType ?? ""} onChange={(e) => set({ destinationType: e.target.value || null })}>
              <option value="">Not set</option>
              {dest.options.map((d) => <option key={d} value={d}>{DESTINATION_INFO[d] ?? d}</option>)}
            </select>
          </Labeled>
        )}
        <Labeled label="Pay for" hint="Per impression works for every goal; the other option only fits its goal.">
          <select className={inputClass} value={a.billingEvent} onChange={(e) => set({ billingEvent: e.target.value })}>
            {billingFor(a.optimizationGoal).map((b) => <option key={b} value={b}>{label(b)}</option>)}
          </select>
        </Labeled>
        {abo && (
          <div className="grid gap-3 @lg:grid-cols-2">
            <Labeled label="Bid strategy" hint={BID_INFO[strategy].hint}>
              <select className={inputClass} value={strategy} onChange={(e) => set({ bidStrategy: e.target.value as BidStrategy, bidAmount: null, roasFloor: null })}>
                {BID_STRATEGIES.map((b) => <option key={b} value={b}>{BID_INFO[b].label}</option>)}
              </select>
            </Labeled>
            {(strategy === "COST_CAP" || strategy === "LOWEST_COST_WITH_BID_CAP") && (
              <Labeled label={strategy === "COST_CAP" ? "Cost per result goal" : "Bid cap"}><MoneyInput value={a.bidAmount} onChange={(v) => set({ bidAmount: v })} currency={currency} label="Bid amount" /></Labeled>
            )}
            {strategy === "LOWEST_COST_WITH_MIN_ROAS" && (
              <Labeled label="Minimum ROAS" hint="Return per unit spent, e.g. 1.5 = 150%. Needs the Conversion value goal.">
                <input type="number" step="0.01" min={0} className={inputClass} value={a.roasFloor ?? ""} onChange={(e) => set({ roasFloor: e.target.value === "" ? null : Number(e.target.value) })} />
              </Labeled>
            )}
          </div>
        )}
        <div className="grid gap-3 @lg:grid-cols-2">
          <Labeled label="Starts" hint="Empty: when you publish it."><input type="datetime-local" className={inputClass} value={toLocalInput(a.startTime)} onChange={(e) => set({ startTime: fromLocalInput(e.target.value) })} /></Labeled>
          {!lifetime && <Labeled label="Ends" hint="Empty: runs until you stop it."><input type="datetime-local" className={inputClass} value={toLocalInput(a.endTime)} onChange={(e) => set({ endTime: fromLocalInput(e.target.value) })} /></Labeled>}
        </div>
        <Labeled label="Weekly schedule (day-parting)" hint={lifetime || parent.lifetime ? "Show the ads only on these days and hours (the account's time zone)." : "Only with a lifetime budget."}>
          <div className={cx("grid gap-2", !(lifetime || parent.lifetime) && "pointer-events-none opacity-50")}>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(block)} onChange={(e) => set({ schedule: e.target.checked ? [{ days: [1, 2, 3, 4, 5], startMinute: 480, endMinute: 1320 }] : [] })} className="accent-[var(--color-accent)]" />Run on a schedule</label>
            {block && (
              <div className="flex flex-wrap items-center gap-2">
                {DAYS.map((d, i) => (
                  <button key={d} type="button" aria-pressed={block.days.includes(i)} onClick={() => set({ schedule: [{ ...block, days: block.days.includes(i) ? block.days.filter((x) => x !== i) : [...block.days, i] }] })}
                    className={cx("rounded-full border px-2 py-0.5 text-xs", block.days.includes(i) ? "border-transparent bg-primary text-on-ink" : "border-line text-muted")}>{d}</button>
                ))}
                <select aria-label="From" className={cx(inputClass, "max-w-fit")} value={block.startMinute} onChange={(e) => set({ schedule: [{ ...block, startMinute: Number(e.target.value) }] })}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h * 60}>{String(h).padStart(2, "0")}:00</option>)}</select>
                <span className="text-xs text-muted">to</span>
                <select aria-label="To" className={cx(inputClass, "max-w-fit")} value={block.endMinute} onChange={(e) => set({ schedule: [{ ...block, endMinute: Number(e.target.value) }] })}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={(h + 1) * 60}>{String(h + 1).padStart(2, "0")}:00</option>)}</select>
              </div>
            )}
          </div>
        </Labeled>
        {a.optimizationGoal === "REACH" && (
          <Labeled label="Frequency cap" hint="At most this many showings per person in the period. Reach goal only.">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <input type="checkbox" checked={Boolean(a.frequencyCap)} onChange={(e) => set({ frequencyCap: e.target.checked ? { impressions: 2, days: 7 } : null })} className="accent-[var(--color-accent)]" />
              {a.frequencyCap && <>
                <input type="number" min={1} max={90} className={cx(inputClass, "max-w-20")} value={a.frequencyCap.impressions} onChange={(e) => set({ frequencyCap: { ...a.frequencyCap!, impressions: Number(e.target.value) } })} /> times every
                <input type="number" min={1} max={90} className={cx(inputClass, "max-w-20")} value={a.frequencyCap.days} onChange={(e) => set({ frequencyCap: { ...a.frequencyCap!, days: Number(e.target.value) } })} /> days
              </>}
            </div>
          </Labeled>
        )}
        <Labeled label="Attribution window" hint="How long after a click or view a result counts. Meta's default (7-day click, 1-day view) suits most accounts.">
          <select className={inputClass} value={a.attribution ? `${a.attribution.clickDays}-${a.attribution.viewDays}` : "default"} onChange={(e) => {
            if (e.target.value === "default") return set({ attribution: null });
            const [c, v] = e.target.value.split("-").map(Number);
            set({ attribution: { clickDays: c as 1 | 7, viewDays: v as 0 | 1 } });
          }}>
            <option value="default">Meta’s default (7-day click, 1-day view)</option>
            <option value="7-0">7-day click</option>
            <option value="1-0">1-day click</option>
            <option value="1-1">1-day click, 1-day view</option>
          </select>
        </Labeled>
        <Labeled label="Custom audiences" hint="People from your website, app or a lookalike. With Advantage+ audience on, these are suggestions too.">
          <div className="grid gap-2">
            <Chips items={t.audiences ?? []} label={(x) => x.name} onRemove={(i) => setT({ audiences: (t.audiences ?? []).filter((_, j) => j !== i) })} />
            <AudienceSelect connections={connections} exclude={[...(t.audiences ?? []), ...(t.excludedAudiences ?? [])].map((x) => x.id)} onPick={(x) => setT({ audiences: [...(t.audiences ?? []), x] })} placeholder="Include an audience…" />
          </div>
        </Labeled>
        <Labeled label="Exclude audiences" hint="For example people who already subscribed.">
          <div className="grid gap-2">
            <Chips items={t.excludedAudiences ?? []} label={(x) => x.name} onRemove={(i) => setT({ excludedAudiences: (t.excludedAudiences ?? []).filter((_, j) => j !== i) })} />
            <AudienceSelect connections={connections} exclude={[...(t.audiences ?? []), ...(t.excludedAudiences ?? [])].map((x) => x.id)} onPick={(x) => setT({ excludedAudiences: [...(t.excludedAudiences ?? []), x] })} placeholder="Exclude an audience…" />
          </div>
        </Labeled>
        <Labeled label="Exclude places">
          <div className="grid gap-2">
            <Chips items={t.excludedLocations ?? []} label={(l) => l.name} onRemove={(i) => setT({ excludedLocations: (t.excludedLocations ?? []).filter((_, j) => j !== i) })} />
            <SearchPicker productId={productId} kind="geo" placeholder="Exclude a country, region or city" onPick={(h) => setT({ excludedLocations: [...(t.excludedLocations ?? []), geoFromHit(h)] })} />
          </div>
        </Labeled>
        {t.locations.some((l) => l.type === "city") && (
          <Labeled label="Radius around cities" hint="Up to 50 miles (80 km). Empty: the city itself.">
            <div className="grid gap-2">
              {t.locations.map((l, i) => l.type !== "city" ? null : (
                <div key={l.key} className="flex items-center gap-2 text-sm">
                  <span className="w-32 truncate">{l.name}</span>
                  <input type="number" min={1} max={80} className={cx(inputClass, "max-w-24")} value={l.radius ?? ""} onChange={(e) => setT({ locations: t.locations.map((x, j) => j === i ? { ...x, radius: e.target.value === "" ? null : Number(e.target.value) } : x) })} />
                  <select className={cx(inputClass, "max-w-fit")} value={l.distanceUnit ?? "mile"} onChange={(e) => setT({ locations: t.locations.map((x, j) => j === i ? { ...x, distanceUnit: e.target.value as "mile" | "kilometer" } : x) })}><option value="mile">miles</option><option value="kilometer">km</option></select>
                </div>
              ))}
            </div>
          </Labeled>
        )}
        <Labeled label="Languages" hint="Only people who use Facebook or Instagram in these languages. Usually left empty.">
          <div className="grid gap-2">
            <Chips items={t.locales ?? []} label={(l) => l.name} onRemove={(i) => setT({ locales: (t.locales ?? []).filter((_, j) => j !== i) })} />
            <SearchPicker productId={productId} kind="locale" placeholder="Add a language" exclude={(t.locales ?? []).map((l) => String(l.key))} onPick={(h) => setT({ locales: [...(t.locales ?? []), { key: Number(h.id), name: h.name }] })} />
          </div>
        </Labeled>
        {!eu && <p className="text-xs text-muted">Targeting an EU country adds the Digital Services Act fields (who benefits, who pays).</p>}
      </MoreOptions>
      {parent.specialAdCategories?.length ? <Hint>This campaign has a special ad category: targeting must stay 18–65, all genders.</Hint> : null}
    </div>
  );
}

function AudienceSelect({ connections, exclude, onPick, placeholder }: { connections: Connections | null; exclude: string[]; onPick: (a: { id: string; name: string }) => void; placeholder: string }) {
  const options = (connections?.audiences ?? []).filter((a) => !exclude.includes(a.id));
  if (!connections) return <p className="text-xs text-muted">Reading the account’s audiences…</p>;
  if (connections.errors.audiences) return <p className="text-xs text-warn">{connections.errors.audiences}</p>;
  if (!connections.audiences.length) return <p className="text-xs text-muted">This ad account has no custom audiences yet.</p>;
  return (
    <select className={inputClass} value="" onChange={(e) => { const a = options.find((x) => x.id === e.target.value); if (a) onPick({ id: a.id, name: a.name }); }}>
      <option value="">{placeholder}</option>
      {options.map((a) => <option key={a.id} value={a.id}>{a.name}{a.lookalike ? " (lookalike)" : ""}{a.size ? ` · ${a.size}` : ""}</option>)}
    </select>
  );
}
