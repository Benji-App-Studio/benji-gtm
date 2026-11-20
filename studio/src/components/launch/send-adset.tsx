"use client";
// Step 3 of "Send to Meta" (new ad sets): what Meta optimises for and what it promotes, the budget
// (only under an ABO campaign), who sees the ads and where. Broad targeting with Advantage+ audience
// and Advantage+ placements is the default; bidding, dates, day-parting, frequency caps, attribution,
// custom audiences, excluded places and languages sit behind "More options".
import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n/client";
import { m } from "@/lib/i18n/translate";
import type { Stage } from "@/lib/launch/naming";
import {
  type AdSetSpec, APP_EVENTS, BID_INFO, BID_STRATEGIES, type BidStrategy, billingFor, DESTINATION_INFO, destinationsFor, GOAL_INFO, goalsFor,
  type GeoPick, type ParentCampaign, PIXEL_EVENTS, promotedNeed, targetsEu, type TargetingSpec,
} from "@/lib/launch/rules";
import { type Connections, fromLocalInput, metaCall, type SearchHit, toLocalInput } from "@/lib/launch/send";
import { cx, inputClass, Segmented, Toggle } from "../ui";
import { withParts } from "../nav/nav-labels";
import { Chips, Group, Hint, Labeled, MoneyInput, MoreOptions, PlacementPicker, SearchPicker } from "./send-parts";

/** Meta's app and pixel events and billing events, in plain words; anything else reads from its code. */
const CODE_LABEL: Record<string, string> = {
  PURCHASE: m("Purchase"), START_TRIAL: m("Start trial"), SUBSCRIBE: m("Subscribe"), COMPLETE_REGISTRATION: m("Complete registration"), LEAD: m("Lead"),
  ADD_TO_CART: m("Add to cart"), INITIATED_CHECKOUT: m("Initiated checkout"), ADD_PAYMENT_INFO: m("Add payment info"), CONTENT_VIEW: m("Content view"),
  SEARCH: m("Search"), CONTACT: m("Contact"), OTHER: m("Other"), LEVEL_ACHIEVED: m("Level achieved"), ACHIEVEMENT_UNLOCKED: m("Achievement unlocked"),
  IMPRESSIONS: m("Impressions"), LINK_CLICKS: m("Link clicks"), THRUPLAY: m("ThruPlays"), PAGE_LIKES: m("Page likes"), POST_ENGAGEMENT: m("Post engagement"), APP_INSTALLS: m("App installs"),
};
const humanize = (s: string) => s.toLowerCase().replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
const geoFromHit = (h: SearchHit): GeoPick => ({ key: h.id, name: h.name, type: h.type ?? "country", countryCode: h.countryCode ?? (h.type === "country" ? h.id : undefined) });

export function AdSetStep({ productId, value: a, onChange, parent, currency, connections, stage }: {
  productId: string; value: AdSetSpec; onChange: (a: AdSetSpec) => void; parent: ParentCampaign; currency: string; connections: Connections | null; stage: Stage;
}) {
  const set = (patch: Partial<AdSetSpec>) => onChange({ ...a, ...patch });
  const tg = a.targeting;
  const setT = (patch: Partial<TargetingSpec>) => set({ targeting: { ...tg, ...patch } });
  const po = a.promotedObject ?? {};
  const setPo = (patch: Partial<NonNullable<AdSetSpec["promotedObject"]>>) => set({ promotedObject: { ...po, ...patch } });
  const objective = parent.objective;
  const need = promotedNeed(objective, a.optimizationGoal, a.destinationType);
  const dest = destinationsFor(objective, a.optimizationGoal);
  const abo = parent.budgetMode === "ABO";
  const lifetime = a.lifetimeBudget != null;
  const strategy = (a.bidStrategy ?? "LOWEST_COST_WITHOUT_CAP") as BidStrategy;
  const eu = targetsEu(tg);
  const { t, intl } = useT();
  const label = (s: string) => (CODE_LABEL[s] ? t(CODE_LABEL[s]) : humanize(s));
  // Sunday first, as Meta's schedule counts days, in the page's language.
  const days = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(intl, { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2023, 0, 1 + i))));

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
  const key = JSON.stringify([a.optimizationGoal, tg, po.objectStoreUrl]);
  useEffect(() => {
    if (!tg.locations.length) return;
    let live = true;
    const timer = setTimeout(() => {
      setEstimate("loading");
      metaCall<{ estimate: { lower: number; upper: number } | null }>(productId, "estimate", { objective, adSet: a })
        .then((r) => { if (live) setEstimate(r.estimate); }).catch(() => { if (live) setEstimate(null); });
    }, 900);
    return () => { live = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, productId, objective]);
  const compact = (n: number) => Intl.NumberFormat(intl, { notation: "compact" }).format(n);

  const pixels = connections?.pixels ?? (po.pixelId ? [{ id: po.pixelId, name: t("Pixel from Launch settings"), lastFired: null }] : []);
  const block = a.schedule?.[0] ?? null;

  return (
    <div className="grid gap-4">
      <Group title={t("Ad set")}>
        <Labeled label={t("Name")} hint={t("Follows the naming convention; it updates with the places you pick unless you rename it.")}>
          <input className={inputClass} value={a.name} maxLength={400} onChange={(e) => set({ name: e.target.value })} />
        </Labeled>
        <Labeled label={t("Optimise for")} hint={GOAL_INFO[a.optimizationGoal] ? t(GOAL_INFO[a.optimizationGoal].hint) : undefined}>
          <select className={inputClass} value={a.optimizationGoal} onChange={(e) => changeGoal(e.target.value)}>
            {goalsFor(objective).map((g, i) => { const name = GOAL_INFO[g] ? t(GOAL_INFO[g].label) : g; return <option key={g} value={g}>{i === 0 ? t("{name} (default)", { name }) : name}</option>; })}
          </select>
        </Labeled>
        <p className="text-xs text-muted">{t("The playbook: optimise for the deepest event that still happens often (a trial or purchase over an install), so Meta learns who pays.")}</p>

        {(need.need === "app" || need.need === "app_event") && (
          <div className="grid gap-3 @lg:grid-cols-2">
            <Labeled label={t("App")} hint={po.applicationId ? t("Meta app {id}", { id: po.applicationId }) : t("Add the Meta app id in Launch settings.")}>
              <input className={inputClass} value={po.objectStoreUrl ?? ""} placeholder="https://apps.apple.com/app/id…" onChange={(e) => setPo({ objectStoreUrl: e.target.value })} />
            </Labeled>
            {need.need === "app_event" && (
              <Labeled label={t("App event")} hint={t("Sent by the Meta SDK (or your MMP) from the app.")}>
                <select className={inputClass} value={po.customEventType ?? ""} onChange={(e) => setPo({ customEventType: e.target.value })}>
                  {APP_EVENTS.map((e) => <option key={e} value={e}>{label(e)}</option>)}
                </select>
              </Labeled>
            )}
          </div>
        )}
        {need.need === "pixel_event" && (
          <div className="grid gap-3 @lg:grid-cols-2">
            <Labeled label={t("Pixel")} hint={pixels.length ? t("The website's Meta pixel (or dataset).") : t("Connect a pixel in Launch settings: this goal needs one.")}>
              <select className={inputClass} value={po.customConversionId ? `cc:${po.customConversionId}` : po.pixelId ?? ""} onChange={(e) => e.target.value.startsWith("cc:")
                ? setPo({ customConversionId: e.target.value.slice(3), pixelId: undefined, customEventType: undefined })
                : setPo({ pixelId: e.target.value || undefined, customConversionId: undefined, customEventType: po.customEventType ?? "PURCHASE" })}>
                <option value="">{t("Pick…")}</option>
                {pixels.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                {connections?.customConversions.length ? <optgroup label={t("Custom conversions")}>{connections.customConversions.map((c) => <option key={c.id} value={`cc:${c.id}`}>{c.name}</option>)}</optgroup> : null}
              </select>
            </Labeled>
            {!po.customConversionId && (
              <Labeled label={t("Event")}>
                <select className={inputClass} value={po.customEventType ?? ""} onChange={(e) => setPo({ customEventType: e.target.value })}>
                  {PIXEL_EVENTS.map((e) => <option key={e} value={e}>{label(e)}</option>)}
                </select>
              </Labeled>
            )}
          </div>
        )}
        {need.need === "page" && (
          <Labeled label={t("Facebook Page")}>
            <select className={inputClass} value={po.pageId ?? ""} onChange={(e) => setPo({ pageId: e.target.value })}>
              <option value="">{t("Pick…")}</option>
              {(connections?.pages ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Labeled>
        )}
        {dest.required && dest.options.length > 1 && (
          <Labeled label={t("Send people to")}>
            <select className={inputClass} value={a.destinationType ?? ""} onChange={(e) => set({ destinationType: e.target.value })}>
              {dest.options.map((d) => <option key={d} value={d}>{DESTINATION_INFO[d] ? t(DESTINATION_INFO[d]) : d}</option>)}
            </select>
          </Labeled>
        )}
      </Group>

      {abo ? (
        <Group title={t("Budget")} hint={t("This campaign gives each ad set its own budget (ABO).")}>
          <div className="grid gap-3 @lg:grid-cols-2">
            <Labeled label={lifetime ? t("Lifetime budget") : t("Daily budget")} hint={stage === "TEST" ? t("Testing: about $20–50 a day per ad set, with about 5 ads in it.") : t("Raise winners about 20% every 48 h.")}>
              <div className="grid gap-2">
                <Segmented label={t("Budget type")} value={lifetime ? "lifetime" : "daily"} onChange={(v) => set(v === "lifetime" ? { lifetimeBudget: a.dailyBudget ? a.dailyBudget * 7 : 140, dailyBudget: null } : { dailyBudget: a.lifetimeBudget ? Math.round(a.lifetimeBudget / 7) : 20, lifetimeBudget: null, schedule: [] })}
                  options={[{ value: "daily", label: t("Daily") }, { value: "lifetime", label: t("Lifetime") }]} />
                <MoneyInput value={lifetime ? a.lifetimeBudget : a.dailyBudget} onChange={(v) => set(lifetime ? { lifetimeBudget: v } : { dailyBudget: v })} currency={currency} label={t("Ad set budget")} />
              </div>
            </Labeled>
            {lifetime && <Labeled label={t("Ends")} hint={t("A lifetime budget needs an end date.")}><input type="datetime-local" className={inputClass} value={toLocalInput(a.endTime)} onChange={(e) => set({ endTime: fromLocalInput(e.target.value) })} /></Labeled>}
          </div>
        </Group>
      ) : (
        <p className="text-xs text-muted">{t("The campaign holds the budget and the bid strategy (CBO), so this ad set has none of its own.")}</p>
      )}

      <Group title={t("Who sees the ads")} hint={t("Broad targeting usually wins: the creative tells Meta who it's for.")}>
        <Labeled label={t("Places")}>
          <div className="grid gap-2">
            <Chips items={tg.locations} label={(l) => (l.type !== "country" ? t("{name} ({kind})", { name: l.name, kind: l.type === "city" ? t("city") : t("region") }) : l.name)} onRemove={(i) => setT({ locations: tg.locations.filter((_, j) => j !== i) })} />
            <SearchPicker productId={productId} kind="geo" placeholder={t("Add a country, region or city")} exclude={tg.locations.map((l) => l.key)} onPick={(h) => setT({ locations: [...tg.locations, geoFromHit(h)] })} />
          </div>
        </Labeled>
        <label className="flex items-start gap-3 text-sm">
          <Toggle checked={tg.advantageAudience} onChange={(v) => setT({ advantageAudience: v })} label={t("Advantage+ audience")} />
          <span><span className="font-medium">{t("Advantage+ audience")}</span><span className="block text-xs text-muted">{tg.advantageAudience ? t("On: the ages and interests below are suggestions. Meta may show the ads to people outside them when it expects better results.") : t("Off: the ages and interests below are hard limits.")}</span></span>
        </label>
        <div className="grid gap-3 @lg:grid-cols-3">
          <Labeled label={t("Youngest")}><select className={inputClass} value={tg.ageMin} onChange={(e) => setT({ ageMin: Number(e.target.value) })}>{Array.from({ length: 53 }, (_, i) => i + 13).map((n) => <option key={n} value={n}>{n}</option>)}</select></Labeled>
          <Labeled label={t("Oldest")}><select className={inputClass} value={tg.ageMax} onChange={(e) => setT({ ageMax: Number(e.target.value) })}>{Array.from({ length: 53 }, (_, i) => i + 13).map((n) => <option key={n} value={n}>{n === 65 ? "65+" : n}</option>)}</select></Labeled>
          <Labeled label={t("Gender")}><Segmented label={t("Gender")} value={tg.genders} onChange={(g) => setT({ genders: g })} options={[{ value: "all", label: t("All") }, { value: "men", label: t("Men") }, { value: "women", label: t("Women") }]} /></Labeled>
        </div>
        <Labeled label={t("Interests")} hint={t("Optional. Only from Meta's search, so every interest is real. Most tests run without any.")}>
          <div className="grid gap-2">
            <Chips items={tg.interests ?? []} label={(i) => i.name} onRemove={(i) => setT({ interests: (tg.interests ?? []).filter((_, j) => j !== i) })} />
            <SearchPicker productId={productId} kind="interest" placeholder={t("Search interests (fitness, cooking…)")} exclude={(tg.interests ?? []).map((i) => i.id)} onPick={(h) => setT({ interests: [...(tg.interests ?? []), { id: h.id, name: h.name }] })} />
          </div>
        </Labeled>
        <p className="text-xs text-muted">
          {estimate === "loading" ? t("Estimating the audience…") : estimate ? t("About {low}–{high} people a month (Meta's estimate).", { low: compact(estimate.lower), high: compact(estimate.upper) }) : t("Meta's audience estimate shows here.")}
        </p>
      </Group>

      <Group title={t("Where the ads show")}>
        <Segmented label={t("Placements")} value={tg.placements === "advantage" ? "advantage" : "manual"} onChange={(v) => setT({ placements: v === "advantage" ? "advantage" : { publisher_platforms: ["facebook", "instagram"] } })}
          options={[{ value: "advantage", label: t("Advantage+ placements") }, { value: "manual", label: t("Pick placements") }]} />
        <p className="text-xs text-muted">{tg.placements === "advantage" ? t("Meta shows the ads wherever they'll do best: Feeds, Stories, Reels and more. Recommended.") : t("Only where you pick. Fewer places usually costs more per result.")}</p>
        {tg.placements !== "advantage" && <PlacementPicker value={tg.placements} onChange={(rule) => setT({ placements: rule })} objective={objective} />}
      </Group>

      {eu && (
        <Group title={t("EU transparency (Digital Services Act)")} hint={t("Ads shown in the EU name who benefits from them and who pays for them.")}>
          <div className="grid gap-3 @lg:grid-cols-2">
            <Labeled label={t("Who benefits")}><input className={inputClass} value={a.dsaBeneficiary ?? ""} onChange={(e) => set({ dsaBeneficiary: e.target.value })} /></Labeled>
            <Labeled label={t("Who pays")}><input className={inputClass} value={a.dsaPayor ?? ""} onChange={(e) => set({ dsaPayor: e.target.value })} /></Labeled>
          </div>
        </Group>
      )}

      <MoreOptions>
        {!dest.required && dest.options.length > 0 && (
          <Labeled label={t("Send people to")} hint={t("Usually the website.")}>
            <select className={inputClass} value={a.destinationType ?? ""} onChange={(e) => set({ destinationType: e.target.value || null })}>
              <option value="">{t("Not set")}</option>
              {dest.options.map((d) => <option key={d} value={d}>{DESTINATION_INFO[d] ? t(DESTINATION_INFO[d]) : d}</option>)}
            </select>
          </Labeled>
        )}
        <Labeled label={t("Pay for")} hint={t("Per impression works for every goal; the other option only fits its goal.")}>
          <select className={inputClass} value={a.billingEvent} onChange={(e) => set({ billingEvent: e.target.value })}>
            {billingFor(a.optimizationGoal).map((b) => <option key={b} value={b}>{label(b)}</option>)}
          </select>
        </Labeled>
        {abo && (
          <div className="grid gap-3 @lg:grid-cols-2">
            <Labeled label={t("Bid strategy")} hint={t(BID_INFO[strategy].hint)}>
              <select className={inputClass} value={strategy} onChange={(e) => set({ bidStrategy: e.target.value as BidStrategy, bidAmount: null, roasFloor: null })}>
                {BID_STRATEGIES.map((b) => <option key={b} value={b}>{t(BID_INFO[b].label)}</option>)}
              </select>
            </Labeled>
            {(strategy === "COST_CAP" || strategy === "LOWEST_COST_WITH_BID_CAP") && (
              <Labeled label={strategy === "COST_CAP" ? t("Cost per result goal") : t("Bid cap")}><MoneyInput value={a.bidAmount} onChange={(v) => set({ bidAmount: v })} currency={currency} label={t("Bid amount")} /></Labeled>
            )}
            {strategy === "LOWEST_COST_WITH_MIN_ROAS" && (
              <Labeled label={t("Minimum ROAS")} hint={t("Return per unit spent, e.g. 1.5 = 150%. Needs the Conversion value goal.")}>
                <input type="number" step="0.01" min={0} className={inputClass} value={a.roasFloor ?? ""} onChange={(e) => set({ roasFloor: e.target.value === "" ? null : Number(e.target.value) })} />
              </Labeled>
            )}
          </div>
        )}
        <div className="grid gap-3 @lg:grid-cols-2">
          <Labeled label={t("Starts")} hint={t("Empty: when you publish it.")}><input type="datetime-local" className={inputClass} value={toLocalInput(a.startTime)} onChange={(e) => set({ startTime: fromLocalInput(e.target.value) })} /></Labeled>
          {!lifetime && <Labeled label={t("Ends")} hint={t("Empty: runs until you stop it.")}><input type="datetime-local" className={inputClass} value={toLocalInput(a.endTime)} onChange={(e) => set({ endTime: fromLocalInput(e.target.value) })} /></Labeled>}
        </div>
        <Labeled label={t("Weekly schedule (day-parting)")} hint={lifetime || parent.lifetime ? t("Show the ads only on these days and hours (the account's time zone).") : t("Only with a lifetime budget.")}>
          <div className={cx("grid gap-2", !(lifetime || parent.lifetime) && "pointer-events-none opacity-50")}>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(block)} onChange={(e) => set({ schedule: e.target.checked ? [{ days: [1, 2, 3, 4, 5], startMinute: 480, endMinute: 1320 }] : [] })} className="accent-[var(--color-accent)]" />{t("Run on a schedule")}</label>
            {block && (
              <div className="flex flex-wrap items-center gap-2">
                {days.map((d, i) => (
                  <button key={d} type="button" aria-pressed={block.days.includes(i)} onClick={() => set({ schedule: [{ ...block, days: block.days.includes(i) ? block.days.filter((x) => x !== i) : [...block.days, i] }] })}
                    className={cx("h-6 rounded-full border px-2 text-xs transition-colors", block.days.includes(i) ? "border-hairline bg-control font-medium text-ink" : "border-transparent text-muted hover:bg-hover hover:text-ink")}>{d}</button>
                ))}
                <select aria-label={t("From")} className={cx(inputClass, "max-w-fit")} value={block.startMinute} onChange={(e) => set({ schedule: [{ ...block, startMinute: Number(e.target.value) }] })}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h * 60}>{String(h).padStart(2, "0")}:00</option>)}</select>
                <span className="text-xs text-muted">{t("to")}</span>
                <select aria-label={t("To")} className={cx(inputClass, "max-w-fit")} value={block.endMinute} onChange={(e) => set({ schedule: [{ ...block, endMinute: Number(e.target.value) }] })}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={(h + 1) * 60}>{String(h + 1).padStart(2, "0")}:00</option>)}</select>
              </div>
            )}
          </div>
        </Labeled>
        {a.optimizationGoal === "REACH" && (
          <Labeled label={t("Frequency cap")} hint={t("At most this many showings per person in the period. Reach goal only.")}>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <input type="checkbox" checked={Boolean(a.frequencyCap)} onChange={(e) => set({ frequencyCap: e.target.checked ? { impressions: 2, days: 7 } : null })} className="accent-[var(--color-accent)]" />
              {a.frequencyCap && withParts(t("{times} times every {days} days"), {
                times: <input type="number" min={1} max={90} aria-label={t("Showings")} className={cx(inputClass, "max-w-20")} value={a.frequencyCap.impressions} onChange={(e) => set({ frequencyCap: { ...a.frequencyCap!, impressions: Number(e.target.value) } })} />,
                days: <input type="number" min={1} max={90} aria-label={t("Days")} className={cx(inputClass, "max-w-20")} value={a.frequencyCap.days} onChange={(e) => set({ frequencyCap: { ...a.frequencyCap!, days: Number(e.target.value) } })} />,
              })}
            </div>
          </Labeled>
        )}
        <Labeled label={t("Attribution window")} hint={t("How long after a click or view a result counts. Meta's default (7-day click, 1-day view) suits most accounts.")}>
          <select className={inputClass} value={a.attribution ? `${a.attribution.clickDays}-${a.attribution.viewDays}` : "default"} onChange={(e) => {
            if (e.target.value === "default") return set({ attribution: null });
            const [c, v] = e.target.value.split("-").map(Number);
            set({ attribution: { clickDays: c as 1 | 7, viewDays: v as 0 | 1 } });
          }}>
            <option value="default">{t("Meta’s default (7-day click, 1-day view)")}</option>
            <option value="7-0">{t("7-day click")}</option>
            <option value="1-0">{t("1-day click")}</option>
            <option value="1-1">{t("1-day click, 1-day view")}</option>
          </select>
        </Labeled>
        <Labeled label={t("Custom audiences")} hint={t("People from your website, app or a lookalike. With Advantage+ audience on, these are suggestions too.")}>
          <div className="grid gap-2">
            <Chips items={tg.audiences ?? []} label={(x) => x.name} onRemove={(i) => setT({ audiences: (tg.audiences ?? []).filter((_, j) => j !== i) })} />
            <AudienceSelect connections={connections} exclude={[...(tg.audiences ?? []), ...(tg.excludedAudiences ?? [])].map((x) => x.id)} onPick={(x) => setT({ audiences: [...(tg.audiences ?? []), x] })} placeholder={t("Include an audience…")} />
          </div>
        </Labeled>
        <Labeled label={t("Exclude audiences")} hint={t("For example people who already subscribed.")}>
          <div className="grid gap-2">
            <Chips items={tg.excludedAudiences ?? []} label={(x) => x.name} onRemove={(i) => setT({ excludedAudiences: (tg.excludedAudiences ?? []).filter((_, j) => j !== i) })} />
            <AudienceSelect connections={connections} exclude={[...(tg.audiences ?? []), ...(tg.excludedAudiences ?? [])].map((x) => x.id)} onPick={(x) => setT({ excludedAudiences: [...(tg.excludedAudiences ?? []), x] })} placeholder={t("Exclude an audience…")} />
          </div>
        </Labeled>
        <Labeled label={t("Exclude places")}>
          <div className="grid gap-2">
            <Chips items={tg.excludedLocations ?? []} label={(l) => l.name} onRemove={(i) => setT({ excludedLocations: (tg.excludedLocations ?? []).filter((_, j) => j !== i) })} />
            <SearchPicker productId={productId} kind="geo" placeholder={t("Exclude a country, region or city")} onPick={(h) => setT({ excludedLocations: [...(tg.excludedLocations ?? []), geoFromHit(h)] })} />
          </div>
        </Labeled>
        {tg.locations.some((l) => l.type === "city") && (
          <Labeled label={t("Radius around cities")} hint={t("Up to 50 miles (80 km). Empty: the city itself.")}>
            <div className="grid gap-2">
              {tg.locations.map((l, i) => l.type !== "city" ? null : (
                <div key={l.key} className="flex items-center gap-2 text-sm">
                  <span className="w-32 truncate">{l.name}</span>
                  <input type="number" min={1} max={80} aria-label={t("Radius around {city}", { city: l.name })} className={cx(inputClass, "max-w-24")} value={l.radius ?? ""} onChange={(e) => setT({ locations: tg.locations.map((x, j) => j === i ? { ...x, radius: e.target.value === "" ? null : Number(e.target.value) } : x) })} />
                  <select className={cx(inputClass, "max-w-fit")} value={l.distanceUnit ?? "mile"} onChange={(e) => setT({ locations: tg.locations.map((x, j) => j === i ? { ...x, distanceUnit: e.target.value as "mile" | "kilometer" } : x) })}><option value="mile">{t("miles")}</option><option value="kilometer">{t("km")}</option></select>
                </div>
              ))}
            </div>
          </Labeled>
        )}
        <Labeled label={t("Languages")} hint={t("Only people who use Facebook or Instagram in these languages. Usually left empty.")}>
          <div className="grid gap-2">
            <Chips items={tg.locales ?? []} label={(l) => l.name} onRemove={(i) => setT({ locales: (tg.locales ?? []).filter((_, j) => j !== i) })} />
            <SearchPicker productId={productId} kind="locale" placeholder={t("Add a language")} exclude={(tg.locales ?? []).map((l) => String(l.key))} onPick={(h) => setT({ locales: [...(tg.locales ?? []), { key: Number(h.id), name: h.name }] })} />
          </div>
        </Labeled>
        {!eu && <p className="text-xs text-muted">{t("Targeting an EU country adds the Digital Services Act fields (who benefits, who pays).")}</p>}
      </MoreOptions>
      {parent.specialAdCategories?.length ? <Hint>{t("This campaign has a special ad category: targeting must stay 18–65, all genders.")}</Hint> : null}
    </div>
  );
}

function AudienceSelect({ connections, exclude, onPick, placeholder }: { connections: Connections | null; exclude: string[]; onPick: (a: { id: string; name: string }) => void; placeholder: string }) {
  const { t } = useT();
  const options = (connections?.audiences ?? []).filter((a) => !exclude.includes(a.id));
  if (!connections) return <p className="text-xs text-muted">{t("Reading the account’s audiences…")}</p>;
  if (connections.errors.audiences) return <p className="text-xs text-warn">{connections.errors.audiences}</p>;
  if (!connections.audiences.length) return <p className="text-xs text-muted">{t("This ad account has no custom audiences yet.")}</p>;
  return (
    <select className={inputClass} value="" onChange={(e) => { const a = options.find((x) => x.id === e.target.value); if (a) onPick({ id: a.id, name: a.name }); }}>
      <option value="">{placeholder}</option>
      {options.map((a) => <option key={a.id} value={a.id}>{a.lookalike ? t("{name} (lookalike)", { name: a.name }) : a.name}{a.size ? ` · ${a.size}` : ""}</option>)}
    </select>
  );
}
