"use client";
import { ask, Facts, notice } from "./dialog";
import { PartnersSwitch } from "./direct-forms";
import { useMemo, useState } from "react";
import { useT } from "@/lib/i18n/client";
import { formatMoney } from "@/lib/i18n/format";
import { joinSentences } from "@/lib/i18n/join";
import { KIND_LABEL, PLATFORM_LABEL, PLATFORMS, TYPE_COPY, type Candidate, type Estimate, type Platform, type Project, type ProjectType } from "@/lib/types";
import { LockedNote, useFirstLocked } from "./research/gates";
import { Badge, Button, Card, cx, fmt, inputClass, PlatformBadge, Segmented, Spinner } from "./ui";

const TIMEFRAMES = [30, 60, 90, 180];
type Filter = "brands" | "creators" | "all";

/** Picking which competitors to study, their handles on each channel, and the analysis settings. */
export function Review({ project, estimate, onChange, onStarted }: {
  project: Project & { includeNiche?: boolean; readComments?: boolean; partners?: boolean; brandInstagram?: string }; estimate: Estimate; onChange: (p: Project, e: Estimate) => void; onStarted: () => void;
}) {
  const { t, tn, locale, intl } = useT();
  const type = project.type ?? "competitors";
  const copy = TYPE_COPY[type];
  // Each kind of analysis has its own whole sentence (word order differs by language).
  const pick = <T,>(by: Record<ProjectType, T>) => by[type];
  const n = estimate.competitors;
  const [filter, setFilter] = useState<Filter>(type === "competitors" ? "brands" : "all");
  const [open, setOpen] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [searching, setSearching] = useState(false);
  const [draft, setDraft] = useState<{ name: string; handles: Partial<Record<Platform, string>> }>({ name: "", handles: {} });
  // Searching and analyzing collect posts and read them: with either key missing, say what to connect.
  const locked = useFirstLocked(["research.collect", "ai"]);

  const shown = useMemo(() => project.candidates.filter((c) => {
    if (filter === "all") return true;
    if (filter === "creators") return c.kind === "creator";
    return c.selected || c.kind === "direct_competitor" || c.kind === "adjacent_brand";
  }), [project.candidates, filter]);

  async function patch(body: object) {
    setSaving(true);
    const response = await fetch(`/api/projects/${project.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const data = await response?.json().catch(() => null);
    setSaving(false);
    if (!response?.ok || !data?.project) return notice(data?.error ?? t("Couldn't reach the server. Check your connection and try again."), t("Couldn't save the change"));
    onChange(data.project, data.estimate);
  }

  const toggle = (c: Candidate) => patch({ candidates: [{ id: c.id, selected: !c.selected }] });
  const setHandle = (c: Candidate, platform: Platform, value: string) => patch({ candidates: [{ id: c.id, handles: { [platform]: value } }] });

  async function addCompetitor() {
    if (!draft.name.trim()) return;
    await patch({ add: draft });
    setDraft({ name: "", handles: {} });
    setAdding(false);
  }

  async function analyse() {
    const title = !n ? t("Analyze the best content in your niche?") : pick({
      competitors: estimate.niche ? tn(n, "Analyze {n} competitor and the best content in your niche?", "Analyze {n} competitors and the best content in your niche?") : tn(n, "Analyze {n} competitor?", "Analyze {n} competitors?"),
      account: tn(n, "Analyze {n} account?", "Analyze {n} accounts?"),
      campaign: tn(n, "Analyze {n} creator?", "Analyze {n} creators?"),
    });
    const go = await ask({
      title,
      body: <Facts rows={[
        [t("Channels"), project.platforms.map((p) => PLATFORM_LABEL[p]).join(", ")],
        [t("Time frame"), tn(project.sinceDays, "Last {n} day", "Last {n} days")],
        [t("Posts"), t("About {n}", { n: estimate.posts })],
        ...(estimate.commentsUsd ? [[t("Reading comments"), `~${formatMoney(intl, estimate.commentsUsd, "USD", { decimals: 2 })}`] as [string, string]] : []),
        [t("Estimated Apify cost"), <span key="usd" className="font-medium text-ink">~${estimate.usd.toFixed(2)}</span>],
      ]} note={t("Reading the posts adds well under a cent. You can stop the run at any time.")} />,
      confirm: t("Start the analysis"),
    });
    if (!go) return;
    setStarting(true);
    const response = await fetch(`/api/projects/${project.id}/analyze`, { method: "POST" }).catch(() => null);
    const data = await response?.json().catch(() => null);
    setStarting(false);
    if (!response?.ok) return notice(data?.error ?? t("Couldn't reach the server. Check your connection and try again."), t("Couldn't start the analysis"));
    onStarted();
  }

  async function searchAgain() {
    if (project.candidates.length && !(await ask({ title: t("Search for competitors again?"), body: t("The list below is replaced by a fresh search. Competitors you added yourself are kept only if they're on your product profile."), confirm: t("Search again") }))) return;
    setSearching(true);
    const response = await fetch(`/api/projects/${project.id}/discover`, { method: "POST" }).catch(() => null);
    const data = await response?.json().catch(() => null);
    setSearching(false);
    if (!response?.ok) return notice(data?.error ?? t("Couldn't reach the server. Check your connection and try again."), t("Couldn't start the search"));
    onStarted();
  }

  const perAccount = pick({ competitors: t("Posts per competitor per channel"), account: t("Posts per account per channel"), campaign: t("Posts per creator per channel") });
  const counts = { brands: project.candidates.filter((c) => c.selected || c.kind === "direct_competitor" || c.kind === "adjacent_brand").length, creators: project.candidates.filter((c) => c.kind === "creator").length, all: project.candidates.length };

  return (
    <div className="grid gap-4 @4xl:grid-cols-[1fr_320px]">
      <div>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="eyebrow">{type === "competitors" ? t("Step 2 of 3") : t(copy.label)}</p>
            <h2 className="mt-0.5 text-title font-medium">{pick({ competitors: t("Pick the competitors to study"), account: t("Check the accounts and their channels"), campaign: t("Check the creators and their channels") })}</h2>
            <p className="mt-1 text-sm text-muted">{type === "competitors" ? (project.message ?? t("Each account was checked against your product. The closest brands are pre-selected.")) : t("Fix any handle with “Edit channels”, untick anything to leave out, then start the analysis.")}</p>
            {type === "competitors" && !locked && <Button size="sm" variant="secondary" className="mt-3" disabled={searching} onClick={searchAgain}>{searching ? <><Spinner className="size-3" /> {t("Starting…")}</> : t("Search for competitors again")}</Button>}
          </div>
          {type === "competitors" && <Segmented label={t("Which accounts")} value={filter} onChange={setFilter}
            options={(["brands", "creators", "all"] as Filter[]).map((f) => ({ value: f, label: <>{f === "brands" ? t("Brands") : f === "creators" ? t("Creators") : t("All")} <span className="text-faint tabular-nums">{counts[f]}</span></> }))} />}
        </div>

        <div className="grid gap-3">
          {shown.length === 0 && <Card className="p-4 text-sm text-muted">{t("Nothing under this filter. Try another one, or add a competitor you know below.")}</Card>}
          {shown.map((c) => (
            <Card key={c.id} className={cx("p-4 transition", c.selected && "border-ink/25 bg-raised")}>
              <div className="flex items-start gap-3">
                <button type="button" onClick={() => toggle(c)} aria-pressed={c.selected} aria-label={c.selected ? t("Deselect {name}", { name: c.name }) : t("Select {name}", { name: c.name })}
                  className={cx("mt-0.5 grid size-5 shrink-0 place-items-center rounded-sm border text-xs", c.selected ? "border-primary bg-primary text-on-ink" : "border-line hover:border-ink/40")}>{c.selected && "✓"}</button>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{c.name}</span>
                    {c.verified && <span className="text-accent" title={t("Verified")}>●</span>}
                    {type === "competitors" && <Badge tone={c.kind === "direct_competitor" ? "win" : c.kind === "adjacent_brand" ? "accent" : "neutral"}>{KIND_LABEL[c.kind] ? t(KIND_LABEL[c.kind]) : c.kind}</Badge>}
                    {type === "competitors" && c.source === "you" && <Badge tone="highlight">{t("Added by you")}</Badge>}
                    {type === "competitors" && c.source === "ai" && <Badge tone="accent">{t("Named by AI")}</Badge>}
                    {c.followers != null && <span className="text-xs text-muted">{t("{n} followers", { n: fmt(c.followers) })}</span>}
                  </div>
                  {c.bio && <p className="mt-1 line-clamp-2 text-sm text-muted">{c.bio}</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    {PLATFORMS.filter((p) => c.handles[p]).map((p) => <span key={p} className="flex items-center gap-1 text-xs text-muted"><PlatformBadge platform={p} /> <span className="font-mono">{c.handles[p]}</span></span>)}
                    <button type="button" onClick={() => setOpen(open === c.id ? null : c.id)} className="rounded-xs text-xs text-accent hover:underline">{open === c.id ? t("Done") : t("Edit channels")}</button>
                  </div>
                  {open === c.id && (
                    <div className="mt-3 grid gap-2 rounded-inner bg-card p-3 @xl:grid-cols-2">
                      {PLATFORMS.map((p) => (
                        <label key={p} className="flex items-center gap-2 text-xs">
                          <span className="w-28 shrink-0"><PlatformBadge platform={p} /></span>
                          <input className={cx(inputClass, "py-1 text-xs")} defaultValue={c.handles[p] ?? ""} placeholder={p === "linkedin" ? t("company slug or URL") : t("handle")}
                            onBlur={(e) => { if (e.target.value.trim() !== (c.handles[p] ?? "")) setHandle(c, p, e.target.value); }} />
                        </label>
                      ))}
                    </div>
                  )}
                </div>
                {type === "competitors" && <div className="hidden shrink-0 text-right @xl:block" title={t("How close each account is to your product, as checked")}>
                  <div className="flex justify-end gap-0.5">{[0, 1, 2, 3].map((i) => <span key={i} className={cx("h-4 w-1.5 rounded-sm", c.similarity > i + 0.5 ? "bg-win" : "bg-ink/10")} />)}</div>
                  <span className="text-xs text-muted">{t("closeness")}</span>
                </div>}
              </div>
            </Card>
          ))}
          <Card className="border-dashed p-4">
            {adding ? (
              <div className="grid gap-3">
                <input className={inputClass} aria-label={pick({ competitors: t("Competitor name"), account: t("Account name"), campaign: t("Creator name") })} placeholder={pick({ competitors: t("Competitor name"), account: t("Account name"), campaign: t("Creator name") })} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                <div className="grid gap-2 @xl:grid-cols-2">
                  {PLATFORMS.map((p) => (
                    <label key={p} className="flex items-center gap-2 text-xs">
                      <span className="w-28 shrink-0"><PlatformBadge platform={p} /></span>
                      <input className={cx(inputClass, "py-1 text-xs")} placeholder={p === "linkedin" ? t("company slug") : t("handle")} value={draft.handles[p] ?? ""} onChange={(e) => setDraft({ ...draft, handles: { ...draft.handles, [p]: e.target.value } })} />
                    </label>
                  ))}
                </div>
                <div className="flex gap-2"><Button size="sm" onClick={addCompetitor} disabled={!draft.name.trim()}>{t("Add")}</Button><Button size="sm" variant="ghost" onClick={() => setAdding(false)}>{t("Cancel")}</Button></div>
              </div>
            ) : (
              <button type="button" onClick={() => setAdding(true)} className="w-full rounded-xs text-left text-sm text-muted hover:text-ink">+ {pick({ competitors: t("Add a competitor you know"), account: t("Add an account"), campaign: t("Add a creator") })}</button>
            )}
          </Card>
        </div>
      </div>

      <aside className="@4xl:sticky @4xl:top-4 @4xl:self-start">
        <Card className="p-4">
          <p className="eyebrow">{t("Analysis")}</p>
          <div className="mt-4">
            <p className="mb-2 text-sm font-medium">{t("Channels")}</p>
            <div className="flex flex-wrap gap-1.5">
              {PLATFORMS.map((p) => {
                const on = project.platforms.includes(p);
                return (
                  <button key={p} type="button" aria-pressed={on} onClick={() => patch({ platforms: on ? project.platforms.filter((x) => x !== p) : [...project.platforms, p] })}
                    className={cx("rounded-control border px-2.5 py-1.5 transition", on ? "border-hairline bg-raised shadow-raised" : "border-line opacity-55 hover:opacity-100")}>
                    <PlatformBadge platform={p} showBeta />
                  </button>
                );
              })}
            </div>
          </div>
          <div className="mt-5">
            <p className="mb-2 text-sm font-medium">{t("Time frame")}</p>
            <Segmented label={t("Time frame")} value={String(project.sinceDays)} onChange={(v) => patch({ sinceDays: Number(v) })} options={TIMEFRAMES.map((d) => ({ value: String(d), label: tn(d, "{n} day", "{n} days") }))} />
          </div>
          <div className="mt-5">
            <p className="mb-2 text-sm font-medium">{perAccount}</p>
            <Segmented label={perAccount} value={String(project.limitPerAccount)} onChange={(v) => patch({ limitPerAccount: Number(v) })} options={(type === "competitors" ? [10, 20, 40] : [15, 30, 60]).map((n) => ({ value: String(n), label: String(n) }))} />
          </div>
          {type === "competitors" && project.keywords.length > 0 && (
            <label className="mt-5 flex items-start gap-2 text-sm">
              <input type="checkbox" checked={Boolean(project.includeNiche) || !estimate.competitors} disabled={!estimate.competitors} onChange={(e) => patch({ includeNiche: e.target.checked })} className="mt-0.5 size-4 accent-accent" />
              <span>{t("Include the best content in your niche")}{!estimate.competitors && <span className="block text-xs text-muted">{t("No competitors picked, so the analysis covers your niche.")}</span>}</span>
            </label>
          )}
          {type !== "account" || project.platforms.some((p) => p === "instagram" || p === "tiktok" || p === "youtube") ? (
            <label className="mt-5 flex items-start gap-2 text-sm">
              <input type="checkbox" checked={project.readComments !== false} onChange={(e) => patch({ readComments: e.target.checked })} className="mt-0.5 size-4 accent-accent" />
              <span>{t("Read more comments")}<span className="block text-xs text-muted">{t("Up to 25 comments on each channel's 20 most-viewed posts, to spot buyers and what the audience asks for.")}{estimate.commentsUsd ? ` ${t("Adds ~{usd}.", { usd: formatMoney(intl, estimate.commentsUsd, "USD", { decimals: 2 }) })}` : ""}</span></span>
            </label>
          ) : null}
          {(type === "competitors" || type === "campaign") && (
            <div className="mt-5 grid gap-2">
              {type === "campaign" && (
                <input className={inputClass} aria-label={t("Brand's Instagram")} placeholder={t("Brand's Instagram, e.g. @acme")}
                  defaultValue={project.brandInstagram ? `@${project.brandInstagram}` : ""} onBlur={(e) => e.target.value.trim().replace(/^@/, "") !== (project.brandInstagram ?? "") && patch({ brandInstagram: e.target.value })} />
              )}
              <PartnersSwitch checked={Boolean(project.partners)} onChange={(on) => patch({ partners: on })} disabled={type === "campaign" && !project.brandInstagram}
                title={type === "campaign" ? t("Find the brand's creators") : t("Map each competitor's creator program")}
                detail={joinSentences(locale, t("Collab posts, the paid label, posts tagging the brand, and bios that declare a tie."), estimate.partnersUsd ? t("Adds ~{usd}.", { usd: formatMoney(intl, estimate.partnersUsd, "USD", { decimals: 2 }) }) : null)} />
            </div>
          )}
          <div className="mt-5 grid grid-cols-2 gap-3 rounded-inner border border-line bg-raised p-3 text-sm">
            <div><p className="text-xs text-muted">{t(copy.many)}</p><p className="text-title font-medium tabular-nums">{estimate.competitors}</p></div>
            <div><p className="text-xs text-muted">{t("Posts (max)")}</p><p className="text-title font-medium tabular-nums">{estimate.posts}</p></div>
            <div className="col-span-2"><p className="text-xs text-muted">{t("Estimated Apify cost")}</p><p className="text-title font-medium tabular-nums">~${estimate.usd.toFixed(2)}</p></div>
          </div>
          {locked ? <LockedNote state={locked} className="mt-4" /> : <Button className="mt-4 w-full" onClick={analyse} disabled={starting || saving || (!estimate.posts && !(type === "campaign" && project.partners && project.brandInstagram)) || project.demo}>
            {starting ? <><Spinner /> {t("Starting…")}</> : n ? pick({ competitors: tn(n, "Analyze {n} competitor", "Analyze {n} competitors"), account: tn(n, "Analyze {n} account", "Analyze {n} accounts"), campaign: tn(n, "Analyze {n} creator", "Analyze {n} creators") }) : type === "campaign" ? t("Find the brand's creators") : t("Analyze my niche")}
          </Button>}
          {!estimate.posts && estimate.competitors > 0 && <p className="mt-2 text-xs text-warn">{pick({ competitors: t("None of the chosen competitors has a handle on the selected channels. Add handles with “Edit channels”."), account: t("None of the chosen accounts has a handle on the selected channels. Add handles with “Edit channels”."), campaign: t("None of the chosen creators has a handle on the selected channels. Add handles with “Edit channels”.") })}</p>}
          {saving && <p className="mt-2 flex items-center gap-1.5 text-xs text-muted"><Spinner className="size-3" /> {t("Saving…")}</p>}
        </Card>
      </aside>
    </div>
  );
}
