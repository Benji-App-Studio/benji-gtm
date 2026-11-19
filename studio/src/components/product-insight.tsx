"use client";
// The AI product profile on the Product page: read the product's links (in the background, with
// progress), show what came back in sections, "Replace with AI insight" on the product profile (with a
// preview of every field it changes, and Undo), and its brand ideas as suggestions with "Use this"
// (the brand itself is only edited on the Brand page; lib/brand.ts).
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import type { BrandOverview, BrandSuggestion } from "@/lib/brand";
import { KIND_LABEL, STAGE_LABEL, type ProductRow } from "@/lib/db";
import { insightLinks, insightState, SALES_LABEL, type InsightChange, type ProductInsight } from "@/lib/product-insight";
import { ask, notice } from "./dialog";
import { IconSparkles } from "./icons";
import { Chips, FactGrid, profileFacts, priceLabel, SocialChips, socialEntries, type Fact } from "./product/fields";
import { LockedNote, useLocked } from "./research/gates";
import { Badge, Button, cx, Spinner, TintIcon } from "./ui";
import { BrandSuggestions } from "./brand/brand-suggestions";
import { UI_LOCALE } from "@/lib/ui-locale";

const POLL_MS = 4_000;

async function call<T>(productId: string, action: string): Promise<T & { error?: string }> {
  const response = await fetch(`/api/products/${productId}/insight`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) }).catch(() => null);
  const data = await response?.json().catch(() => null);
  return (response?.ok ? data : { error: data?.error ?? "Couldn't reach the server. Try again." }) as T & { error?: string };
}

const ago = (iso: string | null | undefined) => {
  if (!iso) return "";
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 60 ? "just now" : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86_400 ? `${Math.round(s / 3600)} h ago` : new Date(iso).toLocaleDateString(UI_LOCALE);
};

export function ProductInsightCard({ product, onChanged, onEdit }: { product: ProductRow; onChanged: (row: ProductRow) => void; onEdit: () => void }) {
  const [row, setRow] = useState(product);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  // A fresh row from the page (after an edit) replaces the local one.
  const [given, setGiven] = useState(product);
  if (product !== given) { setGiven(product); setRow(product); }
  const state = insightState(row);
  const links = insightLinks(row);
  const insight = row.insight as ProductInsight | null | undefined;
  const [suggestions, setSuggestions] = useState<BrandSuggestion[]>([]);
  // Reading the links is the AI's work: without its key the button says what to connect.
  const aiLocked = useLocked("ai");

  // The brand suggestions (what the profile would add to the Brand page), once there's a profile.
  useEffect(() => {
    if (state !== "done") return;
    let live = true;
    fetch(`/api/products/${row.id}/brand`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
      .then((data: BrandOverview | null) => { if (live) setSuggestions(data?.suggestions ?? []); });
    return () => { live = false; };
  }, [state, row.id, row.insight_at]);

  async function takeSuggestion(s: BrandSuggestion) {
    setBusy(`use:${s.key}`);
    const response = await fetch(`/api/products/${row.id}/brand`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "use", key: s.key }) }).catch(() => null);
    const data = await response?.json().catch(() => null) as (BrandOverview & { error?: string }) | null;
    setBusy(null);
    if (!response?.ok || !data?.draft) return notice(data?.error ?? "Couldn't reach the server. Try again.", "Couldn't use it");
    setSuggestions(data.suggestions);
  }

  // While it runs: check the row every few seconds until it's done or failed.
  useEffect(() => {
    if (state !== "running") return;
    let stopped = false;
    const timer = setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      const fresh = await fetch(`/api/products/${row.id}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null) as ProductRow | null;
      if (!fresh || stopped) return;
      setRow(fresh);
      if (fresh.insight_status !== "running") { onChanged(fresh); if (fresh.insight_status === "done") setOpen(true); }
    }, POLL_MS);
    return () => { stopped = true; clearInterval(timer); };
  }, [state, row.id, onChanged]);

  async function start() {
    setBusy("start");
    const result = await call<{ status?: string }>(row.id, "start");
    setBusy(null);
    if (result.error) return notice(result.error, "Couldn't start");
    setRow((r) => ({ ...r, insight_status: "running", insight_message: "Opening your links…", insight_started_at: new Date().toISOString() }));
  }

  async function replace() {
    setBusy("apply");
    const preview = await call<{ changes: InsightChange[] }>(row.id, "preview");
    setBusy(null);
    if (preview.error) return notice(preview.error, "Nothing to replace");
    if (!preview.changes.length) return notice("Your profile already matches the AI profile.", "Nothing to replace");
    const ok = await ask({
      title: "Replace with AI insight?",
      body: (
        <div className="grid gap-2 text-sm">
          <p className="text-muted">These fields get the AI profile&apos;s version. You can undo it afterwards.</p>
          <ul className="grid max-h-[50vh] gap-2 overflow-y-auto">
            {preview.changes.map((c) => (
              <li key={c.label} className="rounded-inner border border-line p-2.5">
                <p className="text-xs font-medium">{c.label}</p>
                {c.before && <p className="mt-1 text-xs text-faint line-through [overflow-wrap:anywhere]">{c.before.slice(0, 220)}{c.before.length > 220 ? "…" : ""}</p>}
                <p className="mt-0.5 text-xs [overflow-wrap:anywhere]">{c.after.slice(0, 320)}{c.after.length > 320 ? "…" : ""}</p>
              </li>
            ))}
          </ul>
        </div>
      ),
      confirm: `Replace ${preview.changes.length} field${preview.changes.length === 1 ? "" : "s"}`,
    });
    if (!ok) return;
    setBusy("apply");
    const result = await call<{ product: ProductRow }>(row.id, "apply");
    setBusy(null);
    if (result.error) return notice(result.error, "Couldn't replace");
    setRow(result.product);
    onChanged(result.product);
  }

  async function undo() {
    if (!(await ask({ title: "Undo the replace?", body: "Puts back what the profile said before the AI insight replaced it.", confirm: "Undo" }))) return;
    setBusy("undo");
    const result = await call<{ product: ProductRow }>(row.id, "undo");
    setBusy(null);
    if (result.error) return notice(result.error, "Couldn't undo");
    setRow(result.product);
    onChanged(result.product);
  }


  const shortLink = (l: string) => l.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");
  const status = state === "running" ? <Badge tone="accent">Reading…</Badge>
    : state === "done" ? <Badge tone="win">Ready</Badge>
    : state === "failed" ? <Badge tone="warn">Didn&apos;t finish</Badge>
    : null;
  const line = state === "running" ? (row.insight_message || "Reading your links…")
    : state === "failed" ? (row.insight_message || "The last read stopped before it finished.")
    : state === "done" ? `${row.insight_message ? `${row.insight_message} ` : ""}${ago(row.insight_at)}. ${row.insight_applied_at ? "Your profile uses it." : "Replace your typed profile with it, or keep yours."} Its brand ideas are only suggestions.`
    : aiLocked ? "With the AI connected, your website and store listing are read into a fuller profile: the problem, the customer, value, pricing, proof, your brand colours and voice. The profile you typed works without it."
    : links.length ? `The AI reads ${links.length === 1 ? "your link" : `your ${links.length} links`} and your website's pages, then writes a fuller profile: the problem, the customer, value, pricing, proof, your brand colours and voice.`
    : "Add your website or App Store link and the AI reads them to write a fuller profile than the onboarding questions can.";

  return (
    <section className="border-t border-line bg-hover" aria-label="AI product profile">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3 px-4 py-4">
        <div className="flex min-w-0 flex-1 basis-[280px] items-start gap-3">
          <TintIcon tone="accent" size="sm"><IconSparkles /></TintIcon>
          <div className="min-w-0 flex-1">
            <div className="flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1">
              <h3 className="text-sm font-medium">AI product profile</h3>
              {status}
              {row.insight_applied_at && <Badge>Applied {ago(row.insight_applied_at)}</Badge>}
            </div>
            <p className="flex items-start gap-2 text-caption text-muted [overflow-wrap:anywhere]">
              {state === "running" && <Spinner className="mt-0.5 size-3.5 shrink-0" />}
              <span className="min-w-0">{line}</span>
            </p>
            {links.length > 0 && state !== "running" && (
              <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Links the AI reads">
                {links.map((l) => <li key={l} className="max-w-full min-w-0 truncate rounded-full border border-line bg-card px-2 py-0.5 font-mono text-xs leading-4 text-faint" title={l}>{shortLink(l)}</li>)}
              </ul>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 @xl:justify-end">
          {!links.length && <Button size="sm" variant="secondary" onClick={onEdit}>Add links</Button>}
          {aiLocked && state !== "running" && <LockedNote state={aiLocked}>Needs {aiLocked.missingKeys.join(" and ")}</LockedNote>}
          {!aiLocked && links.length > 0 && state !== "running" && (
            <Button size="sm" variant={state === "done" ? "ghost" : "secondary"} onClick={start} disabled={Boolean(busy)}>{busy === "start" && <Spinner />}{state === "none" ? "Read my links with AI" : "Read again"}</Button>
          )}
          {row.insight_applied_at && Boolean(row.insight_backup) && <Button size="sm" variant="ghost" onClick={undo} disabled={Boolean(busy)}>{busy === "undo" && <Spinner />}Undo replace</Button>}
          {state === "done" && insight && <Button size="sm" variant="secondary" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? "Hide" : "View profile"}</Button>}
          {state === "done" && insight && <Button size="sm" variant="secondary" onClick={replace} disabled={Boolean(busy)}>{busy === "apply" && <Spinner />}Replace with AI insight</Button>}
        </div>
      </div>
      {state === "running" && (
        <div className="relative h-1 w-full overflow-hidden bg-control" role="progressbar" aria-label="Reading your links">
          <span className="bg-task-indeterminate absolute inset-y-0 w-1/3 bg-accent" />
        </div>
      )}
      {state === "done" && suggestions.length > 0 && (
        <div className="border-t border-line px-4 py-3">
          <BrandSuggestions suggestions={suggestions} onUse={takeSuggestion} busy={busy?.startsWith("use:") ? busy.slice(4) : null}
            note={<>Use one to add it to your brand; edit everything on the <Link href={`/app/w/${row.id}/brand`} className="text-accent hover:underline">Brand page</Link>.</>} />
        </div>
      )}
      {open && insight && <InsightView insight={insight} />}
    </section>
  );
}

// MARK: The profile

type Tile = { key: string; title: string; aside?: ReactNode; wide?: boolean; body: ReactNode };

/** Pairs tiles two to a row; full-width tiles break the pairing, and an odd one out takes the whole row. */
function balance(tiles: (Tile | null | false | "" | undefined)[]): Tile[] {
  const list = tiles.filter((t): t is Tile => Boolean(t));
  let run: Tile[] = [];
  const close = () => { if (run.length % 2 === 1) run[run.length - 1].wide = true; run = []; };
  for (const t of list) { if (t.wide) close(); else run.push(t); }
  close();
  return list;
}

function TileView({ tile }: { tile: Tile }) {
  return (
    <section className={cx("flex min-w-0 flex-col gap-2 rounded-small border border-line bg-card p-3", tile.wide && "@2xl:col-span-2")}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h4 className="eyebrow">{tile.title}</h4>
        {tile.aside}
      </div>
      {tile.body}
    </section>
  );
}

const Bullets = ({ items }: { items: string[] }) => (
  <ul className="grid gap-1.5 text-sm">{items.map((x) => <li key={x} className="flex gap-2.5"><span className="mt-2 size-1 shrink-0 rounded-full bg-faint" /><span className="min-w-0 [overflow-wrap:anywhere]">{x}</span></li>)}</ul>
);

const Text = ({ children, className }: { children: ReactNode; className?: string }) => <p className={cx("text-sm [overflow-wrap:anywhere]", className)}>{children}</p>;

/** A small label over a group inside a tile ("Phrases", "Calls to action"). */
const Sub = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="grid gap-1.5"><p className="text-xs text-muted">{label}</p>{children}</div>
);

/** The profile, organized: what it is, what Replace fills in, who it's for, why it wins, the brand, and where it came from. */
export function InsightView({ insight }: { insight: ProductInsight }) {
  const read = insight.sources.filter((s) => s.ok);
  const missed = insight.sources.filter((s) => !s.ok);

  // What "Replace with AI insight" fills in on the product profile (profiles from before 2026-10-03 don't have it).
  const f = insight.product;
  const formFacts: Fact[] = f ? [
    { label: "Product type", value: f.kind ? KIND_LABEL[f.kind] ?? f.kind : "" },
    { label: "Stage", value: f.stage ? STAGE_LABEL[f.stage] ?? f.stage : "" },
    ...profileFacts({ kind: f.kind, audience: f.audience, price_tier: f.price_tier, sales_channel: f.sales_channel, region: f.region, answers: f.answers }),
  ].filter((x) => x.value) : [];
  const formSocials = f ? socialEntries(f.socials) : [];

  const segments = insight.audience.segments;
  const brand = insight.brand;
  const brandFacts: Fact[] = [
    { label: "Tone", value: brand.tone },
    { label: "Visual style", value: brand.visual_style },
    { label: "Type", value: brand.typography },
  ].filter((x) => x.value);
  const talk = insight.messaging;

  const tiles = balance([
    (formFacts.length > 0 || formSocials.length > 0) && {
      key: "form", title: "For your product profile", wide: true,
      aside: <span className="text-xs text-muted">What Replace with AI insight fills in</span>,
      body: (
        <>
          <FactGrid facts={formFacts} />
          {formSocials.length > 0 && <Sub label="Socials found"><SocialChips socials={f?.socials} /></Sub>}
        </>
      ),
    },
    insight.aim && { key: "aim", title: "Their aim", body: <Text>{insight.aim}</Text> },
    (insight.problem || insight.solution) && {
      key: "problem", title: "Problem → solution",
      body: (
        <div className="grid gap-1.5">
          {insight.problem && <Text><span className="text-muted">Problem: </span>{insight.problem}</Text>}
          {insight.solution && <Text><span className="text-muted">Solution: </span>{insight.solution}</Text>}
        </div>
      ),
    },
    (insight.audience.primary || segments.length > 0) && {
      key: "audience", title: "Who it's for", wide: true,
      body: (
        <>
          {insight.audience.primary && <Text className="font-medium">{insight.audience.primary}</Text>}
          {segments.length > 0 && (
            <div className="grid gap-2.5 @2xl:grid-cols-2">
              {segments.map((s, i) => (
                <div key={s.name} className={cx("min-w-0 rounded-inner bg-hover p-3 text-sm", i === segments.length - 1 && segments.length % 2 === 1 && "@2xl:col-span-2")}>
                  <p className="font-medium">{s.name}</p>
                  {s.description && <p className="mt-0.5 text-xs text-muted">{s.description}</p>}
                  {s.pains.length > 0 && <p className="mt-2 text-xs"><span className="text-muted">Pains: </span>{s.pains.join(" · ")}</p>}
                  {s.motivations.length > 0 && <p className="mt-1 text-xs"><span className="text-muted">Wants: </span>{s.motivations.join(" · ")}</p>}
                </div>
              ))}
            </div>
          )}
        </>
      ),
    },
    insight.value_props.length > 0 && { key: "value", title: "Value they promise", body: <Bullets items={insight.value_props} /> },
    insight.differentiators.length > 0 && { key: "different", title: "What makes it different", body: <Bullets items={insight.differentiators} /> },
    (insight.pricing.model || insight.pricing.details) && {
      key: "pricing", title: "Pricing",
      aside: insight.pricing.price_tier !== "unknown" ? <Badge>{priceLabel(insight.pricing.price_tier)}</Badge> : undefined,
      body: <Text>{[insight.pricing.model, insight.pricing.details].filter(Boolean).map((t) => t.replace(/\.+$/, "")).join(". ")}.</Text>,
    },
    insight.proof.length > 0 && { key: "proof", title: "Proof", body: <Bullets items={insight.proof} /> },
    insight.features.length > 0 && {
      key: "features", title: "Features", wide: true,
      body: (
        <ul className="grid gap-x-6 gap-y-2.5 text-sm @2xl:grid-cols-2">
          {insight.features.map((x) => <li key={x.name} className="min-w-0 [overflow-wrap:anywhere]"><p className="font-medium">{x.name}</p>{x.benefit && <p className="text-muted">{x.benefit}</p>}</li>)}
        </ul>
      ),
    },
    (brand.colors.length > 0 || brandFacts.length > 0 || brand.voice.length > 0) && {
      key: "brand", title: "Brand", wide: true,
      body: (
        <>
          {brand.colors.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {brand.colors.map((c) => (
                <div key={c.hex} className="flex min-w-0 items-center gap-2 rounded-small border border-line bg-raised py-1 pr-2.5 pl-1" title={c.evidence}>
                  <span className="size-6 shrink-0 rounded-md border border-ink/10" style={{ background: c.hex }} />
                  <span className="min-w-0 text-xs"><span className="block truncate font-medium">{c.name || c.hex}</span><span className="font-mono text-muted">{c.hex}{c.role ? ` · ${c.role}` : ""}</span></span>
                </div>
              ))}
            </div>
          )}
          <FactGrid facts={brandFacts} />
          {brand.voice.length > 0 && <Sub label="Voice"><Chips items={brand.voice} /></Sub>}
        </>
      ),
    },
    (talk.hooks.length > 0 || talk.phrases.length > 0 || talk.ctas.length > 0) && {
      key: "talk", title: "How they talk",
      body: (
        <>
          {talk.hooks.length > 0 && <Bullets items={talk.hooks.map((h) => `“${h}”`)} />}
          {talk.phrases.length > 0 && <Sub label="Phrases"><Chips items={talk.phrases} /></Sub>}
          {talk.ctas.length > 0 && <Sub label="Calls to action"><Chips items={talk.ctas} /></Sub>}
        </>
      ),
    },
    insight.claims_to_avoid.length > 0 && { key: "avoid", title: "Claims ads must avoid", body: <Bullets items={insight.claims_to_avoid} /> },
    insight.keywords.length > 0 && { key: "keywords", title: "Niche keywords", body: <Chips items={insight.keywords} /> },
    insight.competitors.length > 0 && { key: "competitors", title: "Competitors they mention", body: <Chips items={insight.competitors} /> },
    insight.gaps.length > 0 && { key: "gaps", title: "Not in the sources", body: <Bullets items={insight.gaps} /> },
  ]);

  return (
    <div className="grid gap-4 border-t border-line px-4 pt-4 pb-4">
      <div className="grid gap-2 px-1">
        <h4 className="eyebrow">What it is</h4>
        {insight.tagline && <p className="text-sm font-medium [overflow-wrap:anywhere]">{insight.tagline}</p>}
        {insight.summary && <Text className="leading-relaxed text-label">{insight.summary}</Text>}
        {(insight.category || insight.sales_channel !== "unknown" || insight.region) && (
          <div className="flex flex-wrap gap-1.5">
            {insight.category && <Badge tone="highlight">{insight.category}</Badge>}
            {insight.sales_channel && insight.sales_channel !== "unknown" && <Badge>{SALES_LABEL[insight.sales_channel] ?? insight.sales_channel}</Badge>}
            {insight.region && <Badge>{insight.region}</Badge>}
          </div>
        )}
      </div>

      {tiles.length > 0 && <div className="grid gap-3 @2xl:grid-cols-2">{tiles.map((t) => <TileView key={t.key} tile={t} />)}</div>}

      <footer className="grid gap-2 border-t border-line px-1 pt-3">
        <h4 className="eyebrow">Sources · {read.length} read</h4>
        {read.length > 0 && (
          <ul className="grid gap-x-6 gap-y-1 text-xs @2xl:grid-cols-2">
            {read.map((s) => (
              <li key={s.url} className="flex min-w-0 items-center gap-2">
                <Badge className="shrink-0">{s.kind === "subpage" ? "page" : s.kind.replace("_", " ")}</Badge>
                <a href={s.url} target="_blank" rel="noopener noreferrer" className="min-w-0 truncate text-accent hover:underline" title={s.url}>{s.title || s.url}</a>
              </li>
            ))}
          </ul>
        )}
        {missed.length > 0 && <p className="text-xs text-faint [overflow-wrap:anywhere]">Couldn&apos;t open: {missed.map((s) => s.url.replace(/^https?:\/\//, "")).join(", ")}</p>}
        <p className="text-xs text-faint">Written by {insight.model} on {new Date(insight.generatedAt).toLocaleString(UI_LOCALE)}. Check numbers and claims before they go in an ad.</p>
      </footer>
    </div>
  );
}
