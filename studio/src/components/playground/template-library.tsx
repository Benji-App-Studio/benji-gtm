"use client";
// The Playground's Library tab: this product's own templates (lib/playground-templates.ts), never another
// product's. A new product's Library is empty. Two ways in:
// - Upload an ad: it's read (layout, text slots, brands to keep out); then, once the person confirms the
//   credits, a clean brand-neutral template image is made from it. Live while that runs.
// - Browse starter templates: the 15 built-in formats (lib/ad-styles.ts), added for free.
// - Import from another product: a ready template of another of the person's products, copied here for
//   free (it reuses that template's brand-neutral image) and marked with where it came from.
// Each card says what the template is for (angle · the product kinds it fits), and an open one starts with
// whether it fits this product (lib/playground-templates-plan.ts templateFit), as advice, never a block.
// A ready template opens its form (a starter's own, or the one built from the analysis) and "Use this
// template" hands a PlaygroundRequest to the Playground form. Credits are only spent on "Make template",
// after the same cost dialog the Playground uses. The remake is GPT Image 2.5 via Higgsfield (default) or
// via OpenAI, picked on the card (the product's remembered choice to start); a failed one offers the other.
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { AD_STYLES, adStyleById, STYLE_GROUPS, type AdStyle, type StyleContext } from "@/lib/ad-styles";
import { peek, prime, useCached } from "@/lib/client-cache";
import { PRICES_CHECKED } from "@/lib/creative-plan";
import { costLabel, fmtUsd, gptImageLabel, OPENAI_IMAGE_PRICING, otherProvider, tryOtherLabel, type ImageProvider, type OpenAiImagePlan } from "@/lib/image-provider";
import { MAX_CUSTOM_TEMPLATES, type ImportableTemplate, type ImportGroup, type ProductTemplate, type TemplateGuidance, type TemplateStatus } from "@/lib/playground-templates";
import { guidanceCaption, planTemplateRemake, productKindOf, TEMPLATE_REMAKE_OPTIONS, templateRemakeSettings } from "@/lib/playground-templates-plan";
import { createClient } from "@/lib/supabase/client";
import { thumbUrl } from "@/lib/thumb";
import { ask, Facts, notice } from "../dialog";
import { ImageProviderPicker, providerCostRow } from "../image-provider-picker";
import { IconCheck, IconDownload, IconImage, IconPencil, IconPlus, IconTrash, IconUpload, IconX } from "../icons";
import { MODAL, MODAL_OVERLAY, PANEL, PANEL_OVERLAY, PanelPortal } from "../panel-portal";
import { Bone } from "../skeleton";
import { FeatureLock, useFeatures } from "../studio/features";
import type { FeatureState } from "@/lib/capabilities";
import { Badge, Button, cx, Gear, IconButton, inputClass, Segmented, Spinner } from "../ui";
import { CustomTemplateDetail } from "./custom-template";
import { fmtCredits } from "./playground-form";
import { StyleDetail, StyleThumb, useStyleContext, type OnUse, type ProductImage } from "./style-library";

export interface TemplateLibraryProps {
  productId: string;
  /** The workspace's product images (public URLs) the person can attach to a template. */
  productImages: ProductImage[];
  onUse: OnUse;
  /** A template to open first (the Studio's "Start from" links here with ?template=<id>); it opens once it's ready. */
  initialOpenId?: string | null;
  /** Optional: the product context, instead of fetching it. */
  context?: StyleContext;
  /** Who makes remakes to start with: the product's remembered choice (Higgsfield unless changed). */
  imageProvider?: ImageProvider;
  /** False when OpenAI isn't connected on the backend; null when unknown. */
  openaiReady?: boolean | null;
  /** What the Supabase plan does with each OpenAI image quality (the creatives backend's health answer). */
  openaiPlan?: OpenAiImagePlan | null;
}

type Filter = "all" | "starter" | "custom";
type StyleGroup = (typeof STYLE_GROUPS)[number]["id"];
const GROUP_LABEL: Record<string, string> = Object.fromEntries(STYLE_GROUPS.map((g) => [g.id, g.label]));
/** A template's format group: the read's for yours, the style's for a starter. */
const groupOf = (t: ProductTemplate): StyleGroup | null => (t.kind === "starter" ? (t.starterId ? adStyleById(t.starterId)?.group ?? null : null) : t.analysis?.group ?? null);
/** What a template is for: the read's for yours, the style's for a starter (templates read before guidance existed have none). */
const guidanceOf = (t: ProductTemplate): TemplateGuidance | null => (t.kind === "starter" ? (t.starterId ? adStyleById(t.starterId) ?? null : null) : t.analysis);
type Listing = { templates?: ProductTemplate[]; error?: string };
type OthersListing = { groups?: ImportGroup[]; error?: string };
/** An upload on its way to the API (shown at once, from the local file). */
type Pending = { key: string; name: string; preview: string };

const ACCEPT = ["image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 10 * 1024 * 1024;
const POLL_MS = 4_000;

const STATUS: Record<TemplateStatus, { label: string; dot: string }> = {
  analyzing: { label: "Reading", dot: "bg-accent" },
  analyzed: { label: "To make", dot: "bg-caution" },
  generating: { label: "Making", dot: "bg-accent" },
  ready: { label: "Ready", dot: "bg-win" },
  failed: { label: "Failed", dot: "bg-warn" },
};

const newestFirst = (a: ProductTemplate, b: ProductTemplate) => b.createdAt.localeCompare(a.createdAt);
const aspectOf = (t: ProductTemplate) => t.analysis?.aspect ?? (t.starterId ? adStyleById(t.starterId)?.aspect : undefined);
/** A card's picture, whole: a starter's own thumbnail; for yours the full template (a creative's saved thumbnail is a crop), resized by thumbUrl. */
const imageOf = (t: ProductTemplate) => (t.kind === "custom"
  ? t.templateUrl ?? t.thumbUrl
  : t.thumbUrl ?? t.templateUrl ?? (t.starterId ? adStyleById(t.starterId)?.thumbImage : null)) ?? null;

/** What the remake should cost via `provider`: its one GPT Image 2.5 job as planned (the dialog shows the server's figure). */
const remakeEstimate = (t: ProductTemplate, provider: ImageProvider) => {
  const plan = planTemplateRemake(templateRemakeSettings(t, provider));
  return { credits: plan.credits, usd: plan.usd ?? 0 };
};

async function send(url: string, method: string, body: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  try {
    const response = await fetch(url, body instanceof FormData ? { method, body } : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { ok: response.ok, data: await response.json().catch(() => ({ error: "The server didn't answer. Try again." })) };
  } catch {
    return { ok: false, data: { error: "The request didn't go through. Check your connection and try again." } };
  }
}
const errorOf = (data: Record<string, unknown>, fallback: string) => (typeof data.error === "string" && data.error) || fallback;

export function TemplateLibrary({ productId, productImages, onUse, initialOpenId = null, context, imageProvider = "higgsfield", openaiReady = null, openaiPlan = null }: TemplateLibraryProps) {
  const [provider, setProvider] = useState<ImageProvider>(imageProvider);
  // Reading an uploaded ad needs the AI; making the template from it needs a way to make images.
  const features = useFeatures(productId);
  const aiLock = features.locked("ai");
  const imagesLock = features.runner ? null : features.locked("studio.images");
  const url = `/api/playground/${productId}/templates`;
  const [listing, reload] = useCached<Listing>(url);
  const [loadFailed, setLoadFailed] = useState(false);
  const { ctx, loading, signals } = useStyleContext(productId, context);
  const productKind = useMemo(() => productKindOf({ ...signals, imageKinds: productImages.map((p) => p.kind) }), [signals, productImages]);
  const [filter, setFilter] = useState<Filter>("all");
  const [openId, setOpenId] = useState<string | null>(initialOpenId);
  const [browsing, setBrowsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [pending, setPending] = useState<Pending[]>([]);
  const [acting, setActing] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploads = useRef(0);
  const supabase = useMemo(() => createClient(), []);

  const templates = useMemo(() => [...(listing?.templates ?? [])].sort(newestFirst), [listing]);
  const starters = templates.filter((t) => t.kind === "starter");
  const custom = templates.filter((t) => t.kind === "custom");
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<"all" | StyleGroup>("all");
  const q = query.trim().toLowerCase();
  const shown = templates.filter((t) => (filter === "all" || t.kind === filter) && (group === "all" || groupOf(t) === group)
    && (!q || `${t.name} ${t.analysis?.tagline ?? ""} ${guidanceOf(t)?.angle ?? ""} ${guidanceOf(t)?.bestFor ?? ""} ${t.importedFrom ?? ""}`.toLowerCase().includes(q)));
  const added = useMemo(() => new Set(starters.map((t) => t.starterId).filter(Boolean) as string[]), [starters]);
  const busy = pending.length > 0 || templates.some((t) => t.status === "analyzing" || t.status === "generating");
  const generating = templates.some((t) => t.status === "generating");
  const open = templates.find((t) => t.id === openId && t.status === "ready");

  // Know when the first load failed (useCached keeps quiet about it); the request is shared, not repeated.
  const retryLoad = useCallback(() => { reload().then(() => setLoadFailed(false), () => setLoadFailed(true)); }, [reload]);
  useEffect(() => { reload().then(() => setLoadFailed(false), () => setLoadFailed(true)); }, [reload]);

  // Live while anything is being read or made: a short poll (the analysis isn't on Realtime)…
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => { reload().catch(() => {}); }, POLL_MS);
    return () => clearInterval(timer);
  }, [busy, reload]);
  // …and the remake's job on Realtime, as the Playground's results are, so "ready" shows the moment it lands.
  useEffect(() => {
    if (!generating) return;
    const channel = supabase.channel(`playground-templates-${productId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "creative_jobs", filter: `product_id=eq.${productId}` }, () => { reload().catch(() => {}); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [generating, productId, supabase, reload]);

  /** Puts a template the API returned into the list at once (and the cache), then refreshes. */
  const upsert = useCallback((t: ProductTemplate) => {
    const current = peek<Listing>(url)?.templates ?? [];
    prime<Listing>(url, { templates: [t, ...current.filter((x) => x.id !== t.id)] });
  }, [url]);
  const drop = useCallback((id: string) => {
    const current = peek<Listing>(url)?.templates ?? [];
    prime<Listing>(url, { templates: current.filter((x) => x.id !== id) });
  }, [url]);

  async function upload(files: File[]) {
    const room = MAX_CUSTOM_TEMPLATES - custom.length;
    if (room <= 0) return notice(`A product's library holds up to ${MAX_CUSTOM_TEMPLATES} of your own templates. Remove one first.`, "The library is full");
    const bad = files.find((f) => !ACCEPT.includes(f.type)) ?? files.find((f) => f.size > MAX_BYTES);
    if (bad) return notice(!ACCEPT.includes(bad.type) ? `${bad.name} isn't a PNG, JPEG or WebP image.` : `${bad.name} is over 10 MB.`, "Can't use that file");
    setFilter((f) => (f === "starter" ? "all" : f));
    for (const file of files.slice(0, room)) {
      const item: Pending = { key: `upload-${++uploads.current}`, name: file.name.replace(/\.\w+$/, ""), preview: URL.createObjectURL(file) };
      setPending((list) => [item, ...list]);
      const form = new FormData();
      form.append("action", "upload");
      form.append("file", file);
      const { ok, data } = await send(url, "POST", form);
      setPending((list) => list.filter((p) => p.key !== item.key));
      URL.revokeObjectURL(item.preview);
      if (!ok || !data.template) { await notice(errorOf(data, "Couldn't upload the ad. Try again.")); continue; }
      upsert(data.template as ProductTemplate);
    }
    reload().catch(() => {});
  }

  async function addStarter(style: AdStyle) {
    setActing(style.id);
    const { ok, data } = await send(url, "POST", { action: "add-starter", starterId: style.id });
    setActing(null);
    if (!ok || !data.template) return notice(errorOf(data, "Couldn't add it. Try again."));
    upsert(data.template as ProductTemplate);
  }

  /** A ready template of another product, copied into this Library (free; the same one twice returns the copy). */
  async function importOne(t: ImportableTemplate): Promise<boolean> {
    setActing(t.id);
    const { ok, data } = await send(url, "POST", { action: "import", templateId: t.id });
    setActing(null);
    if (!ok || !data.template) { await notice(errorOf(data, "Couldn't import it. Try again.")); return false; }
    upsert(data.template as ProductTemplate);
    setFilter((f) => (f === "all" || f === t.kind ? f : "all"));
    return true;
  }

  /**
   * Price check, the cost dialog, then the remake at the confirmed price, via `via` (the card's pick, or
   * the other provider from a failed card's "Try with … instead"). Nothing is spent without the click.
   */
  async function makeTemplate(t: ProductTemplate, via: ImageProvider = provider) {
    setActing(t.id);
    const planned = await send(url, "POST", { action: "plan-remake", templateId: t.id, provider: via });
    setActing(null);
    if (!planned.ok) return notice(errorOf(planned.data, "Couldn't check the price. Try again."));
    const credits = Number(planned.data.credits);
    const usd = Number(planned.data.usd) || 0;
    const warnings = Array.isArray(planned.data.warnings) ? (planned.data.warnings as string[]) : [];
    if (!Number.isFinite(credits)) return notice("Couldn't check the price. Try again.");
    const ok = await ask({
      title: "Make this template?",
      body: (
        <Facts rows={[
          ["From", t.name],
          ["Model", `${gptImageLabel(via)} · 1 image`],
          ["Aspect", t.analysis?.aspect ?? "4:5"],
          providerCostRow(via, { credits, usd }),
        ]} note={<>
          {warnings.map((w) => <span key={w} className="block">{w}</span>)}
          <span className="block">A clean copy of the ad&apos;s layout with its brand, product, people and words taken out, saved to this product&apos;s Library. {via === "openai"
            ? <>Billed by OpenAI in dollars, estimated from OpenAI&apos;s published prices (checked {OPENAI_IMAGE_PRICING.checked}).</>
            : <>Prices from Higgsfield&apos;s cost check on {PRICES_CHECKED}; the live price is checked again before it runs.</>}</span>
        </>} />
      ),
      confirm: via === "openai" ? `Spend ≈${fmtUsd(usd)} at OpenAI` : `Spend ~${fmtCredits(credits)} credits`,
    });
    if (!ok) return;
    if (via !== provider) setProvider(via);
    setActing(t.id);
    const { ok: started, data } = await send(url, "POST", { action: "remake", templateId: t.id, confirmedCredits: credits, provider: via, confirmedUsd: usd });
    setActing(null);
    if (!started) return notice(errorOf(data, "Couldn't start. Try again."));
    if (data.template) upsert(data.template as ProductTemplate);
    reload().catch(() => {});
  }

  async function rename(t: ProductTemplate, name: string) {
    const next = name.trim().slice(0, 80);
    if (!next || next === t.name) return;
    upsert({ ...t, name: next });
    const { ok, data } = await send(url, "PATCH", { templateId: t.id, name: next });
    if (!ok) { upsert(t); return notice(errorOf(data, "Couldn't rename it. Try again.")); }
    if (data.template) upsert(data.template as ProductTemplate);
  }

  async function remove(t: ProductTemplate) {
    const ok = await ask({
      title: `Remove ${t.name}?`,
      body: t.kind === "starter"
        ? "It leaves this product's Library. You can add it again from the starters any time."
        : t.importedFrom
        ? `It leaves this product's Library. The original stays in ${t.importedFrom}.`
        : "The uploaded ad and its template are deleted from this product's storage (unless another product imported it). This can't be undone.",
      confirm: "Remove", danger: true,
    });
    if (!ok) return;
    setActing(t.id);
    const { ok: done, data } = await send(url, "DELETE", { templateId: t.id });
    setActing(null);
    if (!done) return notice(errorOf(data, "Couldn't remove it. Try again."));
    drop(t.id);
    if (openId === t.id) setOpenId(null);
  }

  /** A failed remake goes back through the price check; a failed read is read again (free). */
  async function retry(t: ProductTemplate) {
    if (t.analysis) return makeTemplate(t);
    setActing(t.id);
    const { ok, data } = await send(url, "POST", { action: "analyze", templateId: t.id });
    setActing(null);
    if (!ok) return notice(errorOf(data, "Couldn't read it again. Try again."));
    if (data.template) upsert(data.template as ProductTemplate);
    reload().catch(() => {});
  }

  const pickFiles = () => fileInput.current?.click();
  const dropHandlers = {
    onDragOver: (e: DragEvent) => { if (!open && e.dataTransfer.types.includes("Files")) { e.preventDefault(); setOver(true); } },
    onDragLeave: (e: DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false); },
    onDrop: (e: DragEvent) => { if (open) return; e.preventDefault(); setOver(false); const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/")); if (files.length) upload(files); },
  };

  const fileField = (
    <input ref={fileInput} type="file" accept={ACCEPT.join(",")} multiple hidden onChange={(e) => { const files = Array.from(e.target.files ?? []); e.target.value = ""; if (files.length) upload(files); }} />
  );
  const sheet = <>
    {browsing && <StarterSheet added={added} acting={acting} onAdd={addStarter} onClose={() => setBrowsing(false)} />}
    {importing && <ImportSheet url={`${url}?scope=others`} acting={acting} onImport={importOne} onClose={() => setImporting(false)} />}
  </>;

  // One template's form.
  if (open) {
    const style = open.kind === "starter" && open.starterId ? adStyleById(open.starterId) : undefined;
    return (
      <div className="@container mx-auto w-full max-w-[700px]">
        {style
          ? <StyleDetail key={open.id} style={style} title={open.name} ctx={ctx} loading={loading} productKind={productKind} productImages={productImages} onUse={onUse} onBack={() => setOpenId(null)} productId={productId} />
          : open.analysis
          ? <CustomTemplateDetail key={open.id} template={open} analysis={open.analysis} ctx={ctx} loading={loading} productKind={productKind} productImages={productImages} onUse={onUse} onBack={() => setOpenId(null)} productId={productId} />
          : <p className="text-xs text-muted">This template can&apos;t be opened. <button type="button" className="font-medium text-ink underline-offset-2 hover:underline" onClick={() => setOpenId(null)}>Back to the Library</button></p>}
      </div>
    );
  }

  if (!listing && !loadFailed) return <LibrarySkeleton />;
  if (loadFailed || listing?.error) {
    return (
      <div className="grid justify-items-center gap-2 rounded-inner border border-line bg-raised px-4 py-8 text-center">
        <p className="text-xs text-muted">{listing?.error ?? "Couldn't load this product's Library."}</p>
        <Button size="sm" variant="secondary" onClick={retryLoad}>Try again</Button>
      </div>
    );
  }

  // The sheet and the file input sit after the body in one fragment, so they stay mounted (no replayed
  // animation, no lost picker) when the first template turns the empty state into the grid.
  const tail = <>{fileField}{sheet}</>;

  // A new product: nothing yet.
  if (!templates.length && !pending.length) {
    return (
      <>
      <div {...dropHandlers} className={cx("grid justify-items-center rounded-inner border border-dashed px-5 py-9 text-center transition", over ? "border-accent bg-accent-soft ring-2 ring-accent/30" : "border-ink/20")}>
        <span className="text-faint"><IconImage className="size-6" /></span>
        <p className="mt-3 text-sm font-medium text-ink">This product&apos;s Library is empty</p>
        <p className="mt-1 max-w-[300px] text-caption text-muted">Upload an ad you like: it&apos;s read and turned into a clean, reusable template for this product. Or start from {AD_STYLES.length} proven formats. Templates stay with this product.</p>
        <div className="mt-4 flex flex-wrap justify-center gap-1.5">
          <Button size="sm" onClick={pickFiles}><IconUpload />Upload an ad</Button>
          <Button size="sm" variant="secondary" onClick={() => setBrowsing(true)}>Browse starter templates</Button>
          <Button size="sm" variant="secondary" onClick={() => setImporting(true)}><IconDownload />Import from another product</Button>
        </div>
        <p className="mt-2.5 text-xs text-faint">or drop an image here · PNG, JPG or WebP up to 10 MB</p>
        {aiLock && <FeatureLock state={aiLock} className="mt-3">An uploaded ad is read by the AI before it becomes a template</FeatureLock>}
      </div>
      {tail}
      </>
    );
  }

  const canUpload = filter !== "starter";
  return (
    <>
    <div {...dropHandlers} className={cx("@container relative rounded-inner transition", over && "ring-2 ring-accent/40 ring-offset-4 ring-offset-card")}>
      <div className="mb-3 grid gap-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-medium text-ink">Template library</h2>
            <p className="text-xs text-muted">{templates.length} template{templates.length === 1 ? "" : "s"} for this product. Open one, fill in your words and images, and the Playground makes it.</p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button size="sm" variant="secondary" onClick={() => setImporting(true)}><IconDownload />Import from another product</Button>
            <Button size="sm" variant="secondary" onClick={() => setBrowsing(true)}><IconPlus />Starters</Button>
            <Button size="sm" onClick={pickFiles} disabled={custom.length >= MAX_CUSTOM_TEMPLATES}><IconUpload />Upload an ad</Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search templates" aria-label="Search templates"
            className={cx(inputClass, "w-full max-w-[240px]")} />
          {aiLock && <FeatureLock state={aiLock}>An uploaded ad is read by the AI before it becomes a template</FeatureLock>}
          <Segmented label="Show" value={filter} onChange={setFilter} options={[
            { value: "all" as const, label: <>All <span className="text-faint tabular-nums">{templates.length}</span></> },
            { value: "starter" as const, label: <>Starters <span className="text-faint tabular-nums">{starters.length}</span></> },
            { value: "custom" as const, label: <>Yours <span className="text-faint tabular-nums">{custom.length}</span></> },
          ]} />
          <Segmented label="Format" value={group} onChange={setGroup} options={[
            { value: "all" as const, label: "Any format" },
            ...STYLE_GROUPS.map((g) => ({ value: g.id, label: g.label })),
          ]} />
        </div>
      </div>

      <ul className="grid grid-flow-row-dense grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2 @4xl:grid-cols-[repeat(auto-fill,minmax(176px,1fr))]">
        {canUpload && pending.map((p) => (
          <li key={p.key} className="min-w-0">
            <TileFrame name={p.name} aspect={null} status={null} image={p.preview} dim overlay={<Working label="Uploading…" shimmer />} />
          </li>
        ))}
        {shown.map((t) => (
          <li key={t.id} className={cx("min-w-0", t.status === "analyzed" && "col-span-2")}>
            {t.status === "analyzed"
              ? <AnalyzedCard template={t} acting={acting === t.id} onMake={() => makeTemplate(t)} onRename={(n) => rename(t, n)} onRemove={() => remove(t)}
                provider={provider} onProvider={setProvider} productId={productId} openaiReady={openaiReady} openaiPlan={openaiPlan} lock={imagesLock} />
              : <TemplateCard template={t} acting={acting === t.id} onOpen={() => setOpenId(t.id)} onRetry={() => retry(t)} onRename={(n) => rename(t, n)} onRemove={() => remove(t)}
                provider={provider} onTryOther={t.analysis ? () => makeTemplate(t, otherProvider(provider)) : undefined} />}
          </li>
        ))}
      </ul>
      {!shown.length && (q || group !== "all") && (
        <p className="py-6 text-center text-xs text-muted">No templates match. <button type="button" onClick={() => { setQuery(""); setGroup("all"); }} className="font-medium text-ink underline-offset-2 hover:underline">Clear the search</button></p>
      )}
      {filter === "starter" && !starters.length && (
        <p className="py-6 text-center text-xs text-muted">No starters in this Library yet. <button type="button" onClick={() => setBrowsing(true)} className="font-medium text-ink underline-offset-2 hover:underline">Browse the {AD_STYLES.length} starters</button></p>
      )}
    </div>
    {tail}
    </>
  );
}

// MARK: Cards

/** A status pill on a card's image: a coloured dot and a word, like the Results' aspect pill. */
function Pill({ children, dot, className }: { children: ReactNode; dot?: string; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-full bg-card/90 px-1.5 text-[10.5px] leading-[18px] font-medium text-label tabular-nums", className)}>
      {dot && <span className={cx("size-1.5 rounded-full", dot)} />}{children}
    </span>
  );
}

/** "Reading the ad…" / "Making the template…" over a dimmed image. */
function Working({ label, shimmer }: { label: string; shimmer?: boolean }) {
  return (
    <>
      {shimmer && <span aria-hidden className="skeleton absolute inset-0 !rounded-none" />}
      <span className="relative grid justify-items-center gap-1.5 px-3 text-center">
        {shimmer ? <Spinner className="size-4 text-muted" /> : <Gear className="size-5 text-accent" />}
        <span className="text-xs font-medium text-ink">{label}</span>
      </span>
    </>
  );
}

/** The frame every card shares: a 4:5 image with its pills and overlay, and a name row with the menu. */
function TileFrame({ name, aspect, status, image, dim, overlay, onOpen, menu, editing, onRenamed, note, caption }: {
  name: string; aspect: string | null | undefined; status: { label: string; dot: string } | null; image: string | null;
  dim?: boolean; overlay?: ReactNode; onOpen?: () => void; menu?: ReactNode; editing?: boolean; onRenamed?: (name: string | null) => void;
  /** A line at the bottom of the image ("From <product>" on an imported template). */
  note?: string | null;
  /** What it's for, under the name ("Price comparison · Physical, Offer"). */
  caption?: string | null;
}) {
  const picture = (
    <>
      {image
        ? <StyleThumb src={thumbUrl(image, 640)} alt={name} fallback="No image" className={cx("size-full !object-contain p-2 transition duration-300", dim && "opacity-35 blur-[1px]", onOpen && "group-hover:scale-[1.03]")} />
          : <span className="block size-full bg-control" />}
      {overlay && <span className="absolute inset-0 grid place-items-center">{overlay}</span>}
      {aspect && <Pill className="absolute top-2 left-2">{aspect}</Pill>}
      {status && <Pill dot={status.dot} className="absolute top-2 right-2">{status.label}</Pill>}
      {note && <Pill className="absolute bottom-2 left-2 max-w-[calc(100%-1rem)]"><span className="truncate" title={note}>{note}</span></Pill>}
      {onOpen && !overlay && (
        <span className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center pb-3 opacity-0 transition group-hover:opacity-100">
          <span className="rounded-full border border-hairline bg-raised px-2.5 py-1 text-xs font-medium text-ink shadow-raised">Use template</span>
        </span>
      )}
    </>
  );
  const box = "relative block aspect-[4/5] w-full overflow-hidden border-b border-line bg-control";
  return (
    <div className="group flex h-full min-w-0 flex-col overflow-hidden rounded-small border border-line bg-card transition hover:border-ink/20">
      {onOpen
        ? <button type="button" onClick={onOpen} aria-label={`Open ${name}`} className={cx(box, "focus-visible:outline-2 focus-visible:-outline-offset-2")}>{picture}</button>
        : <div className={box}>{picture}</div>}
      <div className="flex min-h-11 items-center gap-1 py-1 pr-1 pl-2.5">
        {editing && onRenamed
          ? <RenameInput name={name} onDone={onRenamed} />
          : (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-ink" title={name}>{name}</span>
              {caption && <span className="block truncate text-xs text-muted" title={caption}>{caption}</span>}
            </span>
          )}
        {menu}
      </div>
    </div>
  );
}

function TemplateCard({ template: t, acting, onOpen, onRetry, onRename, onRemove, provider, onTryOther }: {
  template: ProductTemplate; acting: boolean; onOpen: () => void; onRetry: () => void; onRename: (name: string) => void; onRemove: () => void;
  /** The Library's provider: Retry uses it; "Try with … instead" the other one (a failed remake only). */
  provider: ImageProvider; onTryOther?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const starter = t.kind === "starter";
  const status = starter ? { label: "Starter", dot: "bg-faint" } : STATUS[t.status];
  const image = t.status === "ready" ? imageOf(t) : t.sourceUrl ?? imageOf(t);
  const overlay = t.status === "analyzing" ? <Working label="Reading the ad…" shimmer />
    : t.status === "generating" ? <Working label="Making the template…" />
    : t.status === "failed" ? (
      <span className="grid justify-items-center gap-1.5 px-3 text-center">
        <IconX className="size-5 text-warn" />
        <span className="line-clamp-3 text-xs leading-4 text-label" title={t.error ?? undefined}>{t.error || (t.analysis ? "Making the template failed." : "Reading the ad failed.")}</span>
        <Button size="sm" variant="secondary" disabled={acting} onClick={onRetry}>{acting ? <Spinner className="size-3.5" /> : null}Retry</Button>
        {onTryOther && <Button size="sm" variant="ghost" disabled={acting} onClick={onTryOther} title="Same model (GPT Image 2.5), the other provider; you confirm the price first">{tryOtherLabel(provider)}</Button>}
      </span>
    ) : null;
  return (
    <TileFrame
      name={t.name} aspect={aspectOf(t)} status={status} image={image} dim={t.status !== "ready"} overlay={overlay}
      onOpen={t.status === "ready" ? onOpen : undefined}
      editing={editing} onRenamed={(name) => { setEditing(false); if (name) onRename(name); }}
      menu={<CardMenu disabled={acting} onRename={() => setEditing(true)} onRemove={onRemove} />}
      note={t.importedFrom ? `From ${t.importedFrom}` : null}
      caption={guidanceCaption(guidanceOf(t)) ?? [GROUP_LABEL[groupOf(t) ?? ""] ?? null, starter ? "Starter" : t.importedFrom ? "Imported" : "Yours"].filter(Boolean).join(" · ")}
    />
  );
}

/** Read and waiting for the person: what was found, and "Make template" (which confirms the credits first). */
function AnalyzedCard({ template: t, acting, onMake, onRename, onRemove, provider, onProvider, productId, openaiReady, openaiPlan, lock }: {
  template: ProductTemplate; acting: boolean; onMake: () => void; onRename: (name: string) => void; onRemove: () => void;
  provider: ImageProvider; onProvider: (provider: ImageProvider) => void; productId: string; openaiReady: boolean | null; openaiPlan: OpenAiImagePlan | null;
  /** Set when this install can't make images yet: shown in place of "Make template". */
  lock: FeatureState | null;
}) {
  const [editing, setEditing] = useState(false);
  const a = t.analysis;
  const fields = a?.fields ?? [];
  const shownFields = fields.slice(0, 4);
  const estimate = remakeEstimate(t, provider);
  return (
    <div className="flex h-full min-w-0 gap-3 rounded-small border border-line bg-card p-2.5">
      <div className="relative w-[92px] shrink-0 self-start overflow-hidden rounded-inner border border-line bg-control">
        {t.sourceUrl
          ? <StyleThumb src={thumbUrl(t.sourceUrl, 200)} alt={`${t.name}, the uploaded ad`} fallback="No image" className="aspect-[4/5] w-full object-top" />
            : <span className="block aspect-[4/5] w-full bg-control" />}
        <Pill dot={STATUS.analyzed.dot} className="absolute bottom-1.5 left-1.5">{STATUS.analyzed.label}</Pill>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex h-7 items-center gap-1.5">
          {editing
            ? <RenameInput name={t.name} onDone={(name) => { setEditing(false); if (name) onRename(name); }} />
            : <span className="min-w-0 truncate text-sm font-medium text-ink" title={t.name}>{t.name}</span>}
          {a && !editing && <Badge className="shrink-0 tabular-nums">{a.aspect}</Badge>}
          <span className="ml-auto" />
          <CardMenu disabled={acting} onRename={() => setEditing(true)} onRemove={onRemove} />
        </div>
        {guidanceCaption(a) && <p className="-mt-1.5 truncate text-xs text-muted" title={a?.bestFor}>{guidanceCaption(a)}</p>}
        <div className="grid gap-0.5">
          <span className="text-xs font-medium text-muted">{fields.length ? `${fields.length} text slot${fields.length === 1 ? "" : "s"}` : "No text on the image"}</span>
          {shownFields.map((f) => (
            <span key={f.key} className="flex min-w-0 gap-1.5 text-xs leading-4">
              <span className="shrink-0 text-label">{f.label}</span>
              <span className="min-w-0 truncate text-muted" title={f.example}>{f.sensitive ? "your own, sourced" : f.example}</span>
            </span>
          ))}
          {fields.length > shownFields.length && <span className="text-xs leading-4 text-faint">+{fields.length - shownFields.length} more</span>}
        </div>
        {a?.brands.length ? <p className="line-clamp-2 text-xs leading-4 text-muted"><span className="font-medium text-label">Kept out</span> {a.brands.join(", ")}</p> : null}
        {lock ? <FeatureLock state={lock} className="mt-auto" /> : <>
          <ImageProviderPicker value={provider} onChange={onProvider} productId={productId} openaiReady={openaiReady} plan={openaiPlan} quality={TEMPLATE_REMAKE_OPTIONS.quality} resolution={TEMPLATE_REMAKE_OPTIONS.resolution} compact className="mt-auto" />
          <Button size="sm" onClick={onMake} disabled={acting || !a} className="self-start">
            {acting ? <><Spinner className="size-3.5" />Checking the price…</> : <>Make template<span className="font-normal opacity-60">· {costLabel(provider, estimate)}</span></>}
          </Button>
        </>}
      </div>
    </div>
  );
}

function RenameInput({ name, onDone }: { name: string; onDone: (name: string | null) => void }) {
  const done = useRef(false);
  const finish = (value: string | null) => { if (done.current) return; done.current = true; onDone(value); };
  return (
    <input autoFocus defaultValue={name} maxLength={80} aria-label="Template name"
      onFocus={(e) => e.currentTarget.select()}
      onBlur={(e) => finish(e.currentTarget.value)}
      onKeyDown={(e) => { if (e.key === "Enter") finish(e.currentTarget.value); if (e.key === "Escape") finish(null); }}
      className={cx(inputClass, "h-7 min-w-0 flex-1 px-2 py-0 text-sm")} />
  );
}

/** "…" with Rename and Remove. */
function CardMenu({ disabled, onRename, onRemove }: { disabled?: boolean; onRename: () => void; onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", key); };
  }, [open]);
  const item = "flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left text-sm transition hover:bg-active focus-visible:bg-active focus-visible:outline-none [&_svg]:size-3.5";
  return (
    <div ref={box} className="relative shrink-0">
      <IconButton size="sm" label="More" disabled={disabled} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} />
      {open && (
        <div role="menu" className="page-in absolute right-0 bottom-full z-20 mb-1 w-36 rounded-card border border-hairline bg-raised p-1 shadow-pop">
          <button type="button" role="menuitem" onClick={() => { setOpen(false); onRename(); }} className={cx(item, "text-ink")}><IconPencil />Rename</button>
          <button type="button" role="menuitem" onClick={() => { setOpen(false); onRemove(); }} className={cx(item, "text-warn")}><IconTrash />Remove</button>
        </div>
      )}
    </div>
  );
}

function LibrarySkeleton() {
  return (
    <div aria-busy="true">
      <span className="sr-only">Loading the Library</span>
      <div className="mb-3 flex items-center justify-between"><Bone className="h-7 w-52 rounded-control" /><Bone className="h-7 w-20 rounded-control" /></div>
      <div className="grid grid-cols-2 gap-2 @3xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="overflow-hidden rounded-small border border-line bg-card">
            <Bone className="aspect-[4/5] w-full !rounded-none" />
            <div className="flex h-10 items-center px-2.5"><Bone className="h-3 w-24" /></div>
          </div>
        ))}
      </div>
    </div>
  );
}

// MARK: Starters

/** The 15 built-in formats, grouped as before, each added to this product's Library with one click. */
function StarterSheet({ added, acting, onAdd, onClose }: { added: Set<string>; acting: string | null; onAdd: (style: AdStyle) => void; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeRef.current?.focus(); }, []);
  return (
    <PanelPortal onClose={onClose}>
      <div className={cx(PANEL_OVERLAY, "z-[70]")} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div role="dialog" aria-modal="true" aria-label="Starter templates" className={cx(PANEL, "page-in @container max-w-[600px]")}>
          <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-line bg-card px-4 py-3">
            <div className="min-w-0">
              <h2 className="text-sm font-medium">Starter templates</h2>
              <p className="mt-0.5 text-xs text-muted">{AD_STYLES.length} proven Meta ad formats. Free to add; they stay in this product&apos;s Library. <span className="tabular-nums">{added.size} added</span></p>
            </div>
            <button ref={closeRef} type="button" onClick={onClose} aria-label="Close" className="grid size-7 shrink-0 place-items-center rounded-control text-muted transition hover:bg-hover hover:text-ink"><IconX className="size-4" /></button>
          </header>
          <div className="grid gap-4 p-4">
            {STYLE_GROUPS.map((g) => (
              <section key={g.id} aria-label={g.label}>
                <h3 className="mb-2 text-xs font-medium text-muted">{g.label}</h3>
                <ul className="grid grid-cols-2 gap-2.5 @lg:grid-cols-3">
                  {AD_STYLES.filter((s) => s.group === g.id).map((s) => {
                    const isAdded = added.has(s.id);
                    return (
                      <li key={s.id} className="flex min-w-0 flex-col overflow-hidden rounded-small border border-line bg-card">
                        <div className="relative aspect-[4/5] w-full overflow-hidden border-b border-line bg-control">
                          <StyleThumb src={s.thumbImage} alt={`${s.name} example`} className="size-full object-top" />
                          <Pill className="absolute top-2 left-2">{s.aspects.join(" · ")}</Pill>
                        </div>
                        <div className="flex flex-1 flex-col gap-1 p-2.5">
                          <span className="truncate text-xs font-medium text-ink" title={s.name}>{s.name}</span>
                          {guidanceCaption(s) && <span className="-mt-1 truncate text-xs text-faint">{guidanceCaption(s)}</span>}
                          <p className="line-clamp-2 min-h-8 text-xs leading-4 text-muted">{s.tagline}</p>
                          <Button size="sm" variant={isAdded ? "ghost" : "secondary"} disabled={isAdded || acting === s.id} onClick={() => onAdd(s)} className="mt-1.5 w-full">
                            {isAdded ? <><IconCheck />Added</> : acting === s.id ? <><Spinner className="size-3.5" />Adding…</> : <><IconPlus />Add to library</>}
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        </div>
      </div>
    </PanelPortal>
  );
}

// MARK: Import

/**
 * The person's other products and their ready templates, grouped by product. Importing one copies it into
 * this product's Library for free (a starter is added; a custom template reuses its brand-neutral image);
 * it's filled in for this product's brand like any other.
 */
function ImportSheet({ url, acting, onImport, onClose }: { url: string; acting: string | null; onImport: (t: ImportableTemplate) => Promise<boolean>; onClose: () => void }) {
  const [listing, reload] = useCached<OthersListing>(url);
  const [loadFailed, setLoadFailed] = useState(false);
  const [done, setDone] = useState<Set<string>>(() => new Set());
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeRef.current?.focus(); }, []);
  // Always fresh when it opens (another tab may have made templates meanwhile); a failure shows a retry.
  const load = useCallback(() => { reload().then(() => setLoadFailed(false), () => setLoadFailed(true)); }, [reload]);
  useEffect(() => { load(); }, [load]);

  const groups = listing?.groups ?? [];
  const take = async (t: ImportableTemplate) => { if (await onImport(t)) setDone((d) => new Set(d).add(t.id)); };

  return (
    <PanelPortal onClose={onClose}>
      <div className={cx(MODAL_OVERLAY, "z-[70]")} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div role="dialog" aria-modal="true" aria-label="Import from another product" className={cx(MODAL, "page-in @container max-w-[640px]")}>
          <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-line bg-card px-4 py-3">
            <div className="min-w-0">
              <h2 className="text-sm font-medium">Import from another product</h2>
              <p className="mt-0.5 text-xs text-muted">Ready templates from your other products. Free: the template image is reused, nothing new is made. You fill it in for this product as usual.</p>
            </div>
            <button ref={closeRef} type="button" onClick={onClose} aria-label="Close" className="grid size-7 shrink-0 place-items-center rounded-control text-muted transition hover:bg-hover hover:text-ink"><IconX className="size-4" /></button>
          </header>
          <div className="grid gap-4 p-4">
            {!listing && !loadFailed ? (
              <div aria-busy="true" className="grid grid-cols-2 gap-2.5 @lg:grid-cols-3">
                <span className="sr-only">Loading your other products</span>
                {[0, 1, 2].map((i) => <Bone key={i} className="aspect-[4/5] w-full rounded-small" />)}
              </div>
            ) : loadFailed || listing?.error ? (
              <div className="grid justify-items-center gap-2 py-6 text-center">
                <p className="text-xs text-muted">{listing?.error ?? "Couldn't load your other products."}</p>
                <Button size="sm" variant="secondary" onClick={load}>Try again</Button>
              </div>
            ) : !groups.length ? (
              <p className="py-8 text-center text-xs text-muted">No templates in your other products yet.</p>
            ) : groups.map((g) => (
              <section key={g.productId} aria-label={g.productName}>
                <h3 className="mb-2 flex items-baseline gap-1.5 text-xs font-medium text-muted">
                  <span className="truncate">{g.productName}</span><span className="text-faint tabular-nums">{g.templates.length}</span>
                </h3>
                <ul className="grid grid-cols-2 gap-2.5 @lg:grid-cols-3">
                  {g.templates.map((t) => {
                    const isAdded = t.added || done.has(t.id);
                    const image = imageOf(t);
                    return (
                      <li key={t.id} className="flex min-w-0 flex-col overflow-hidden rounded-small border border-line bg-card">
                        <div className="relative aspect-[4/5] w-full overflow-hidden border-b border-line bg-control">
                          {image
                            ? <StyleThumb src={thumbUrl(image, 480)} alt={t.name} fallback="No image" className="size-full object-top" />
                              : <span className="block size-full bg-control" />}
                          {aspectOf(t) && <Pill className="absolute top-2 left-2">{aspectOf(t)}</Pill>}
                        </div>
                        <div className="flex flex-1 flex-col gap-1 p-2.5">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink" title={t.name}>{t.name}</span>
                            <Badge className="shrink-0">{t.kind === "starter" ? "Starter" : "Custom"}</Badge>
                          </span>
                          <Button size="sm" variant={isAdded ? "ghost" : "secondary"} disabled={isAdded || acting === t.id} onClick={() => take(t)} className="mt-1.5 w-full">
                            {isAdded ? <><IconCheck />In this Library</> : acting === t.id ? <><Spinner className="size-3.5" />Importing…</> : <><IconDownload />Import</>}
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        </div>
      </div>
    </PanelPortal>
  );
}
