"use client";
import { ask, Facts, notice } from "./dialog";
import { PartnersSwitch } from "./direct-forms";
import { useMemo, useState } from "react";
import { KIND_LABEL, PLATFORM_LABEL, PLATFORMS, TYPE_COPY, type Candidate, type Estimate, type Platform, type Project } from "@/lib/types";
import { LockedNote, useFirstLocked } from "./research/gates";
import { Badge, Button, Card, cx, fmt, inputClass, PlatformBadge, Segmented, Spinner } from "./ui";

const TIMEFRAMES = [30, 60, 90, 180];
type Filter = "brands" | "creators" | "all";

/** Picking which competitors to study, their handles on each channel, and the analysis settings. */
export function Review({ project, estimate, onChange, onStarted }: {
  project: Project & { includeNiche?: boolean; readComments?: boolean; partners?: boolean; brandInstagram?: string }; estimate: Estimate; onChange: (p: Project, e: Estimate) => void; onStarted: () => void;
}) {
  const type = project.type ?? "competitors";
  const copy = TYPE_COPY[type];
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
    if (!response?.ok || !data?.project) return notice(data?.error ?? "Couldn't reach the server. Check your connection and try again.", "Couldn't save the change");
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
    const what = estimate.competitors ? `${estimate.competitors} ${estimate.competitors === 1 ? copy.noun : copy.nouns}${estimate.niche ? " and the best content in your niche" : ""}` : "the best content in your niche";
    const go = await ask({
      title: `Analyze ${what}?`,
      body: <Facts rows={[
        ["Channels", project.platforms.map((p) => PLATFORM_LABEL[p]).join(", ")],
        ["Time frame", `Last ${project.sinceDays} days`],
        ["Posts", `About ${estimate.posts}`],
        ...(estimate.commentsUsd ? [["Reading comments", `~$${estimate.commentsUsd.toFixed(2)}`] as [string, string]] : []),
        ["Estimated Apify cost", <span key="usd" className="font-medium text-ink">~${estimate.usd.toFixed(2)}</span>],
      ]} note="Reading the posts adds well under a cent. You can stop the run at any time." />,
      confirm: "Start the analysis",
    });
    if (!go) return;
    setStarting(true);
    const response = await fetch(`/api/projects/${project.id}/analyze`, { method: "POST" }).catch(() => null);
    const data = await response?.json().catch(() => null);
    setStarting(false);
    if (!response?.ok) return notice(data?.error ?? "Couldn't reach the server. Check your connection and try again.", "Couldn't start the analysis");
    onStarted();
  }

  async function searchAgain() {
    if (project.candidates.length && !(await ask({ title: "Search for competitors again?", body: "The list below is replaced by a fresh search. Competitors you added yourself are kept only if they're on your product profile.", confirm: "Search again" }))) return;
    setSearching(true);
    const response = await fetch(`/api/projects/${project.id}/discover`, { method: "POST" }).catch(() => null);
    const data = await response?.json().catch(() => null);
    setSearching(false);
    if (!response?.ok) return notice(data?.error ?? "Couldn't reach the server. Check your connection and try again.", "Couldn't start the search");
    onStarted();
  }

  const counts = { brands: project.candidates.filter((c) => c.selected || c.kind === "direct_competitor" || c.kind === "adjacent_brand").length, creators: project.candidates.filter((c) => c.kind === "creator").length, all: project.candidates.length };

  return (
    <div className="grid gap-4 @4xl:grid-cols-[1fr_320px]">
      <div>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="eyebrow">{type === "competitors" ? "Step 2 of 3" : copy.label}</p>
            <h2 className="mt-0.5 text-title font-medium">{type === "competitors" ? "Pick the competitors to study" : `Check the ${copy.nouns} and their channels`}</h2>
            <p className="mt-1 text-sm text-muted">{type === "competitors" ? (project.message ?? "Each account was checked against your product. The closest brands are pre-selected.") : "Fix any handle with “Edit channels”, untick anything to leave out, then start the analysis."}</p>
            {type === "competitors" && !locked && <Button size="sm" variant="secondary" className="mt-3" disabled={searching} onClick={searchAgain}>{searching ? <><Spinner className="size-3" /> Starting…</> : "Search for competitors again"}</Button>}
          </div>
          {type === "competitors" && <Segmented label="Which accounts" value={filter} onChange={setFilter}
            options={(["brands", "creators", "all"] as Filter[]).map((f) => ({ value: f, label: <>{f === "brands" ? "Brands" : f === "creators" ? "Creators" : "All"} <span className="text-faint tabular-nums">{counts[f]}</span></> }))} />}
        </div>

        <div className="grid gap-3">
          {shown.length === 0 && <Card className="p-4 text-sm text-muted">Nothing under this filter. Try another one, or add a competitor you know below.</Card>}
          {shown.map((c) => (
            <Card key={c.id} className={cx("p-4 transition", c.selected && "border-ink/25 bg-raised")}>
              <div className="flex items-start gap-3">
                <button type="button" onClick={() => toggle(c)} aria-pressed={c.selected} aria-label={c.selected ? `Deselect ${c.name}` : `Select ${c.name}`}
                  className={cx("mt-0.5 grid size-5 shrink-0 place-items-center rounded-sm border text-xs", c.selected ? "border-primary bg-primary text-on-ink" : "border-line hover:border-ink/40")}>{c.selected && "✓"}</button>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{c.name}</span>
                    {c.verified && <span className="text-accent" title="Verified">●</span>}
                    {type === "competitors" && <Badge tone={c.kind === "direct_competitor" ? "win" : c.kind === "adjacent_brand" ? "accent" : "neutral"}>{KIND_LABEL[c.kind] ?? c.kind}</Badge>}
                    {type === "competitors" && c.source === "you" && <Badge tone="highlight">Added by you</Badge>}
                    {type === "competitors" && c.source === "ai" && <Badge tone="accent">Named by AI</Badge>}
                    {c.followers != null && <span className="text-xs text-muted">{fmt(c.followers)} followers</span>}
                  </div>
                  {c.bio && <p className="mt-1 line-clamp-2 text-sm text-muted">{c.bio}</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    {PLATFORMS.filter((p) => c.handles[p]).map((p) => <span key={p} className="flex items-center gap-1 text-xs text-muted"><PlatformBadge platform={p} /> <span className="font-mono">{c.handles[p]}</span></span>)}
                    <button type="button" onClick={() => setOpen(open === c.id ? null : c.id)} className="rounded-xs text-xs text-accent hover:underline">{open === c.id ? "Done" : "Edit channels"}</button>
                  </div>
                  {open === c.id && (
                    <div className="mt-3 grid gap-2 rounded-inner bg-card p-3 @xl:grid-cols-2">
                      {PLATFORMS.map((p) => (
                        <label key={p} className="flex items-center gap-2 text-xs">
                          <span className="w-28 shrink-0"><PlatformBadge platform={p} /></span>
                          <input className={cx(inputClass, "py-1 text-xs")} defaultValue={c.handles[p] ?? ""} placeholder={p === "linkedin" ? "company slug or URL" : "handle"}
                            onBlur={(e) => { if (e.target.value.trim() !== (c.handles[p] ?? "")) setHandle(c, p, e.target.value); }} />
                        </label>
                      ))}
                    </div>
                  )}
                </div>
                {type === "competitors" && <div className="hidden shrink-0 text-right @xl:block" title="How close each account is to your product, as checked">
                  <div className="flex justify-end gap-0.5">{[0, 1, 2, 3].map((i) => <span key={i} className={cx("h-4 w-1.5 rounded-sm", c.similarity > i + 0.5 ? "bg-win" : "bg-ink/10")} />)}</div>
                  <span className="text-xs text-muted">closeness</span>
                </div>}
              </div>
            </Card>
          ))}
          <Card className="border-dashed p-4">
            {adding ? (
              <div className="grid gap-3">
                <input className={inputClass} aria-label={`${copy.noun[0].toUpperCase()}${copy.noun.slice(1)} name`} placeholder={`${copy.noun[0].toUpperCase()}${copy.noun.slice(1)} name`} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                <div className="grid gap-2 @xl:grid-cols-2">
                  {PLATFORMS.map((p) => (
                    <label key={p} className="flex items-center gap-2 text-xs">
                      <span className="w-28 shrink-0"><PlatformBadge platform={p} /></span>
                      <input className={cx(inputClass, "py-1 text-xs")} placeholder={p === "linkedin" ? "company slug" : "handle"} value={draft.handles[p] ?? ""} onChange={(e) => setDraft({ ...draft, handles: { ...draft.handles, [p]: e.target.value } })} />
                    </label>
                  ))}
                </div>
                <div className="flex gap-2"><Button size="sm" onClick={addCompetitor} disabled={!draft.name.trim()}>Add</Button><Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button></div>
              </div>
            ) : (
              <button type="button" onClick={() => setAdding(true)} className="w-full rounded-xs text-left text-sm text-muted hover:text-ink">+ Add {type === "competitors" ? "a competitor you know" : `a${copy.noun === "account" ? "n" : ""} ${copy.noun}`}</button>
            )}
          </Card>
        </div>
      </div>

      <aside className="@4xl:sticky @4xl:top-4 @4xl:self-start">
        <Card className="p-4">
          <p className="eyebrow">Analysis</p>
          <div className="mt-4">
            <p className="mb-2 text-sm font-medium">Channels</p>
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
            <p className="mb-2 text-sm font-medium">Time frame</p>
            <Segmented label="Time frame" value={String(project.sinceDays)} onChange={(v) => patch({ sinceDays: Number(v) })} options={TIMEFRAMES.map((d) => ({ value: String(d), label: `${d} days` }))} />
          </div>
          <div className="mt-5">
            <p className="mb-2 text-sm font-medium">Posts per {copy.noun} per channel</p>
            <Segmented label={`Posts per ${copy.noun} per channel`} value={String(project.limitPerAccount)} onChange={(v) => patch({ limitPerAccount: Number(v) })} options={(type === "competitors" ? [10, 20, 40] : [15, 30, 60]).map((n) => ({ value: String(n), label: String(n) }))} />
          </div>
          {type === "competitors" && project.keywords.length > 0 && (
            <label className="mt-5 flex items-start gap-2 text-sm">
              <input type="checkbox" checked={Boolean(project.includeNiche) || !estimate.competitors} disabled={!estimate.competitors} onChange={(e) => patch({ includeNiche: e.target.checked })} className="mt-0.5 size-4 accent-accent" />
              <span>Include the best content in your niche{!estimate.competitors && <span className="block text-xs text-muted">No competitors picked, so the analysis covers your niche.</span>}</span>
            </label>
          )}
          {type !== "account" || project.platforms.some((p) => p === "instagram" || p === "tiktok" || p === "youtube") ? (
            <label className="mt-5 flex items-start gap-2 text-sm">
              <input type="checkbox" checked={project.readComments !== false} onChange={(e) => patch({ readComments: e.target.checked })} className="mt-0.5 size-4 accent-accent" />
              <span>Read more comments<span className="block text-xs text-muted">Up to 25 comments on each channel&apos;s 20 most-viewed posts, to spot buyers and what the audience asks for.{estimate.commentsUsd ? ` Adds ~$${estimate.commentsUsd.toFixed(2)}.` : ""}</span></span>
            </label>
          ) : null}
          {(type === "competitors" || type === "campaign") && (
            <div className="mt-5 grid gap-2">
              {type === "campaign" && (
                <input className={inputClass} aria-label="Brand's Instagram" placeholder="Brand's Instagram, e.g. @acme"
                  defaultValue={project.brandInstagram ? `@${project.brandInstagram}` : ""} onBlur={(e) => e.target.value.trim().replace(/^@/, "") !== (project.brandInstagram ?? "") && patch({ brandInstagram: e.target.value })} />
              )}
              <PartnersSwitch checked={Boolean(project.partners)} onChange={(on) => patch({ partners: on })} disabled={type === "campaign" && !project.brandInstagram}
                title={type === "campaign" ? "Find the brand's creators" : "Map each competitor's creator program"}
                detail={`Collab posts, the paid label, posts tagging the brand, and bios that declare a tie.${estimate.partnersUsd ? ` Adds ~$${estimate.partnersUsd.toFixed(2)}.` : ""}`} />
            </div>
          )}
          <div className="mt-5 grid grid-cols-2 gap-3 rounded-inner border border-line bg-raised p-3 text-sm">
            <div><p className="text-xs text-muted">{copy.nouns[0].toUpperCase() + copy.nouns.slice(1)}</p><p className="text-title font-medium tabular-nums">{estimate.competitors}</p></div>
            <div><p className="text-xs text-muted">Posts (max)</p><p className="text-title font-medium tabular-nums">{estimate.posts}</p></div>
            <div className="col-span-2"><p className="text-xs text-muted">Estimated Apify cost</p><p className="text-title font-medium tabular-nums">~${estimate.usd.toFixed(2)}</p></div>
          </div>
          {locked ? <LockedNote state={locked} className="mt-4" /> : <Button className="mt-4 w-full" onClick={analyse} disabled={starting || saving || (!estimate.posts && !(type === "campaign" && project.partners && project.brandInstagram)) || project.demo}>
            {starting ? <><Spinner /> Starting…</> : estimate.competitors ? `Analyze ${estimate.competitors} ${estimate.competitors === 1 ? copy.noun : copy.nouns}` : type === "campaign" ? "Find the brand's creators" : "Analyze my niche"}
          </Button>}
          {!estimate.posts && estimate.competitors > 0 && <p className="mt-2 text-xs text-warn">None of the chosen {copy.nouns} has a handle on the selected channels. Add handles with “Edit channels”.</p>}
          {saving && <p className="mt-2 flex items-center gap-1.5 text-xs text-muted"><Spinner className="size-3" /> Saving…</p>}
        </Card>
      </aside>
    </div>
  );
}
