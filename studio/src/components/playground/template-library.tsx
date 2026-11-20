"use client";
// The Playground's Library tab: this product's own templates (lib/playground-templates.ts), never another
// product's. A new product's Library is empty. Two ways in:
// - Upload an ad: it's read (layout, text slots, brands to keep out); then, once the person confirms the
//   credits, a clean brand-neutral template image is made from it. Live while that runs.
// - Browse starter templates: the 15 built-in formats (lib/ad-styles.ts), added for free.
// - Import from another app: a ready template of another of the person's products, copied here for
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
import { useT } from "@/lib/i18n/client";
import { m } from "@/lib/i18n/translate";

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
  analyzing: { label: m("Reading"), dot: "bg-accent" },
  analyzed: { label: m("To make"), dot: "bg-caution" },
  generating: { label: m("Making"), dot: "bg-accent" },
  ready: { label: m("Ready"), dot: "bg-win" },
  failed: { label: m("Failed"), dot: "bg-warn" },
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
    return { ok: response.ok, data: await response.json().catch(() => ({ error: m("The server didn't answer. Try again.") })) };
  } catch {
    return { ok: false, data: { error: m("The request didn't go through. Check your connection and try again.") } };
  }
}
/** The server's message (already in the person's language, or one of send()'s marked fallbacks), else `fallback`. Show it with t(). */
const errorOf = (data: Record<string, unknown>, fallback: string) => (typeof data.error === "string" && data.error) || fallback;

export function TemplateLibrary({ productId, productImages, onUse, initialOpenId = null, context, imageProvider = "higgsfield", openaiReady = null, openaiPlan = null }: TemplateLibraryProps) {
  const { t, tn } = useT();
  const fail = (data: Record<string, unknown>, fallback: string) => notice(t(errorOf(data, fallback)));
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
    if (room <= 0) return notice(t("A product's library holds up to {n} of your own templates. Remove one first.", { n: MAX_CUSTOM_TEMPLATES }), t("The library is full"));
    const bad = files.find((f) => !ACCEPT.includes(f.type)) ?? files.find((f) => f.size > MAX_BYTES);
    if (bad) return notice(!ACCEPT.includes(bad.type) ? t("{name} isn't a PNG, JPEG or WebP image.", { name: bad.name }) : t("{name} is over 10 MB.", { name: bad.name }), t("Can't use that file"));
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
      if (!ok || !data.template) { await fail(data, m("Couldn't upload the ad. Try again.")); continue; }
      upsert(data.template as ProductTemplate);
    }
    reload().catch(() => {});
  }

  async function addStarter(style: AdStyle) {
    setActing(style.id);
    const { ok, data } = await send(url, "POST", { action: "add-starter", starterId: style.id });
    setActing(null);
    if (!ok || !data.template) return fail(data, m("Couldn't add it. Try again."));
    upsert(data.template as ProductTemplate);
  }

  /** A ready template of another product, copied into this Library (free; the same one twice returns the copy). */
  async function importOne(t: ImportableTemplate): Promise<boolean> {
    setActing(t.id);
    const { ok, data } = await send(url, "POST", { action: "import", templateId: t.id });
    setActing(null);
    if (!ok || !data.template) { await fail(data, m("Couldn't import it. Try again.")); return false; }
    upsert(data.template as ProductTemplate);
    setFilter((f) => (f === "all" || f === t.kind ? f : "all"));
    return true;
  }

  /**
   * Price check, the cost dialog, then the remake at the confirmed price, via `via` (the card's pick, or
   * the other provider from a failed card's "Try with … instead"). Nothing is spent without the click.
   */
  async function makeTemplate(tpl: ProductTemplate, via: ImageProvider = provider) {
    setActing(tpl.id);
    const planned = await send(url, "POST", { action: "plan-remake", templateId: tpl.id, provider: via });
    setActing(null);
    if (!planned.ok) return fail(planned.data, m("Couldn't check the price. Try again."));
    const credits = Number(planned.data.credits);
    const usd = Number(planned.data.usd) || 0;
    const warnings = Array.isArray(planned.data.warnings) ? (planned.data.warnings as string[]) : [];
    if (!Number.isFinite(credits)) return notice(t("Couldn't check the price. Try again."));
    const ok = await ask({
      title: t("Make this template?"),
      body: (
        <Facts rows={[
          [t("Template"), tpl.name],
          [t("Model"), t("{model} · 1 image", { model: gptImageLabel(via) })],
          [t("Aspect"), tpl.analysis?.aspect ?? "4:5"],
          providerCostRow(via, { credits, usd }),
        ]} note={<>
          {warnings.map((w) => <span key={w} className="block">{w}</span>)}
          <span className="block">{t("A clean copy of the ad's layout with its brand, product, people and words taken out, saved to this product's Library.")} {via === "openai"
            ? t("Billed by OpenAI in dollars, estimated from OpenAI's published prices (checked {date}).", { date: OPENAI_IMAGE_PRICING.checked })
            : t("Prices from Higgsfield's cost check on {date}; the live price is checked again before it runs.", { date: PRICES_CHECKED })}</span>
        </>} />
      ),
      confirm: via === "openai" ? t("Spend ≈{usd} at OpenAI", { usd: fmtUsd(usd) }) : t("Spend ~{credits} credits", { credits: fmtCredits(credits) }),
    });
    if (!ok) return;
    if (via !== provider) setProvider(via);
    setActing(tpl.id);
    const { ok: started, data } = await send(url, "POST", { action: "remake", templateId: tpl.id, confirmedCredits: credits, provider: via, confirmedUsd: usd });
    setActing(null);
    if (!started) return fail(data, m("Couldn't start. Try again."));
    if (data.template) upsert(data.template as ProductTemplate);
    reload().catch(() => {});
  }

  async function rename(t: ProductTemplate, name: string) {
    const next = name.trim().slice(0, 80);
    if (!next || next === t.name) return;
    upsert({ ...t, name: next });
    const { ok, data } = await send(url, "PATCH", { templateId: t.id, name: next });
    if (!ok) { upsert(t); return fail(data, m("Couldn't rename it. Try again.")); }
    if (data.template) upsert(data.template as ProductTemplate);
  }

  async function remove(tpl: ProductTemplate) {
    const ok = await ask({
      title: t("Remove {name}?", { name: tpl.name }),
      body: tpl.kind === "starter"
        ? t("It leaves this product's Library. You can add it again from the starters any time.")
        : tpl.importedFrom
        ? t("It leaves this product's Library. The original stays in {product}.", { product: tpl.importedFrom })
        : t("The uploaded ad and its template are deleted from this product's storage (unless another product imported it). This can't be undone."),
      confirm: t("Remove"), danger: true,
    });
    if (!ok) return;
    setActing(tpl.id);
    const { ok: done, data } = await send(url, "DELETE", { templateId: tpl.id });
    setActing(null);
    if (!done) return fail(data, m("Couldn't remove it. Try again."));
    drop(tpl.id);
    if (openId === tpl.id) setOpenId(null);
  }

  /** A failed remake goes back through the price check; a failed read is read again (free). */
  async function retry(t: ProductTemplate) {
    if (t.analysis) return makeTemplate(t);
    setActing(t.id);
    const { ok, data } = await send(url, "POST", { action: "analyze", templateId: t.id });
    setActing(null);
    if (!ok) return fail(data, m("Couldn't read it again. Try again."));
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
          ? <StyleDetail key={open.id} style={style} title={t(open.name)} ctx={ctx} loading={loading} productKind={productKind} productImages={productImages} onUse={onUse} onBack={() => setOpenId(null)} productId={productId} />
          : open.analysis
          ? <CustomTemplateDetail key={open.id} template={open} analysis={open.analysis} ctx={ctx} loading={loading} productKind={productKind} productImages={productImages} onUse={onUse} onBack={() => setOpenId(null)} productId={productId} />
          : <p className="text-xs text-muted">{t("This template can't be opened.")} <button type="button" className="font-medium text-ink underline-offset-2 hover:underline" onClick={() => setOpenId(null)}>{t("Back to the Library")}</button></p>}
      </div>
    );
  }

  if (!listing && !loadFailed) return <LibrarySkeleton />;
  if (loadFailed || listing?.error) {
    return (
      <div className="grid justify-items-center gap-2 rounded-inner border border-line bg-raised px-4 py-8 text-center">
        <p className="text-xs text-muted">{listing?.error ?? t("Couldn't load this product's Library.")}</p>
        <Button size="sm" variant="secondary" onClick={retryLoad}>{t("Try again")}</Button>
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
        <p className="mt-3 text-sm font-medium text-ink">{t("This product's Library is empty")}</p>
        <p className="mt-1 max-w-[300px] text-caption text-muted">{t("Upload an ad you like: it's read and turned into a clean, reusable template for this product. Or start from {n} proven formats. Templates stay with this product.", { n: AD_STYLES.length })}</p>
        <div className="mt-4 flex flex-wrap justify-center gap-1.5">
          <Button size="sm" onClick={pickFiles}><IconUpload />{t("Upload an ad")}</Button>
          <Button size="sm" variant="secondary" onClick={() => setBrowsing(true)}>{t("Browse starter templates")}</Button>
          <Button size="sm" variant="secondary" onClick={() => setImporting(true)}><IconDownload />{t("Import from another app")}</Button>
        </div>
        <p className="mt-2.5 text-xs text-faint">{t("or drop an image here · PNG, JPG or WebP up to 10 MB")}</p>
        {aiLock && <FeatureLock state={aiLock} className="mt-3">{t("An uploaded ad is read by the AI before it becomes a template")}</FeatureLock>}
      </div>
      {tail}
      </>
    );
  }

  const canUpload = filter !== "starter";
  return (
    <>
    <div {...dropHandlers} className={cx("@container relative rounded-inner transition", over && "ring-2 ring-accent/40 ring-offset-4 ring-offset-card")}>
      <div className="mb-3 grid grid-cols-1 gap-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-medium text-ink">{t("Template library")}</h2>
            <p className="text-xs text-muted">{tn(templates.length, "{n} template for this app. Open it, add your words and pictures, and it's made in this style.", "{n} templates for this app. Open one, add your words and pictures, and it's made in that style.")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button size="sm" variant="secondary" onClick={() => setImporting(true)}><IconDownload />{t("Import from another app")}</Button>
            <Button size="sm" variant="secondary" onClick={() => setBrowsing(true)}><IconPlus />{t("Starters")}</Button>
            <Button size="sm" onClick={pickFiles} disabled={custom.length >= MAX_CUSTOM_TEMPLATES}><IconUpload />{t("Upload an ad")}</Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Search templates")} aria-label={t("Search templates")}
            className={cx(inputClass, "w-full max-w-[240px]")} />
          {aiLock && <FeatureLock state={aiLock}>{t("An uploaded ad is read by the AI before it becomes a template")}</FeatureLock>}
          <Segmented label={t("Show")} value={filter} onChange={setFilter} options={[
            { value: "all" as const, label: <>{t("All")} <span className="text-faint tabular-nums">{templates.length}</span></> },
            { value: "starter" as const, label: <>{t("Starters")} <span className="text-faint tabular-nums">{starters.length}</span></> },
            { value: "custom" as const, label: <>{t("Yours")} <span className="text-faint tabular-nums">{custom.length}</span></> },
          ]} />
          <Segmented label={t("Format")} value={group} onChange={setGroup} options={[
            { value: "all" as const, label: t("Any format") },
            ...STYLE_GROUPS.map((g) => ({ value: g.id, label: t(g.label) })),
          ]} />
        </div>
      </div>

      <ul className="grid grid-flow-row-dense grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2 @4xl:grid-cols-[repeat(auto-fill,minmax(176px,1fr))]">
        {canUpload && pending.map((p) => (
          <li key={p.key} className="min-w-0">
            <TileFrame name={p.name} aspect={null} status={null} image={p.preview} dim overlay={<Working label={t("Uploading…")} shimmer />} />
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
        <p className="py-6 text-center text-xs text-muted">{t("No templates match.")} <button type="button" onClick={() => { setQuery(""); setGroup("all"); }} className="font-medium text-ink underline-offset-2 hover:underline">{t("Clear the search")}</button></p>
      )}
      {filter === "starter" && !starters.length && (
        <p className="py-6 text-center text-xs text-muted">{t("No starters in this Library yet.")} <button type="button" onClick={() => setBrowsing(true)} className="font-medium text-ink underline-offset-2 hover:underline">{t("Browse the {n} starters", { n: AD_STYLES.length })}</button></p>
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
  const { t } = useT();
  const picture = (
    <>
      {image
        ? <StyleThumb src={thumbUrl(image, 640)} alt={name} fallback={t("No image")} className={cx("size-full !object-contain p-2 transition duration-300", dim && "opacity-35 blur-[1px]", onOpen && "group-hover:scale-[1.03]")} />
          : <span className="block size-full bg-control" />}
      {overlay && <span className="absolute inset-0 grid place-items-center">{overlay}</span>}
      {aspect && <Pill className="absolute top-2 left-2">{aspect}</Pill>}
      {status && <Pill dot={status.dot} className="absolute top-2 right-2">{t(status.label)}</Pill>}
      {note && <Pill className="absolute bottom-2 left-2 max-w-[calc(100%-1rem)]"><span className="truncate" title={note}>{note}</span></Pill>}
      {onOpen && !overlay && (
        <span className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center pb-3 opacity-0 transition group-hover:opacity-100">
          <span className="rounded-full border border-hairline bg-raised px-2.5 py-1 text-xs font-medium text-ink shadow-raised">{t("Use template")}</span>
        </span>
      )}
    </>
  );
  const box = "relative block aspect-[4/5] w-full overflow-hidden border-b border-line bg-control";
  return (
    <div className="group flex h-full min-w-0 flex-col overflow-hidden rounded-small border border-line bg-card transition hover:border-ink/20">
      {onOpen
        ? <button type="button" onClick={onOpen} aria-label={t("Open {name}", { name })} className={cx(box, "focus-visible:outline-2 focus-visible:-outline-offset-2")}>{picture}</button>
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

function TemplateCard({ template: tpl, acting, onOpen, onRetry, onRename, onRemove, provider, onTryOther }: {
  template: ProductTemplate; acting: boolean; onOpen: () => void; onRetry: () => void; onRename: (name: string) => void; onRemove: () => void;
  /** The Library's provider: Retry uses it; "Try with … instead" the other one (a failed remake only). */
  provider: ImageProvider; onTryOther?: () => void;
}) {
  const { t } = useT();
  const [editing, setEditing] = useState(false);
  const starter = tpl.kind === "starter";
  const status = starter ? { label: m("Starter"), dot: "bg-faint" } : STATUS[tpl.status];
  const image = tpl.status === "ready" ? imageOf(tpl) : tpl.sourceUrl ?? imageOf(tpl);
  const overlay = tpl.status === "analyzing" ? <Working label={t("Reading the ad…")} shimmer />
    : tpl.status === "generating" ? <Working label={t("Making the template…")} />
    : tpl.status === "failed" ? (
      <span className="grid justify-items-center gap-1.5 px-3 text-center">
        <IconX className="size-5 text-warn" />
        <span className="line-clamp-3 text-xs leading-4 text-label" title={tpl.error ? t(tpl.error) : undefined}>{tpl.error ? t(tpl.error) : tpl.analysis ? t("Making the template failed.") : t("Reading the ad failed.")}</span>
        <Button size="sm" variant="secondary" disabled={acting} onClick={onRetry}>{acting ? <Spinner className="size-3.5" /> : null}{t("Retry")}</Button>
        {onTryOther && <Button size="sm" variant="ghost" disabled={acting} onClick={onTryOther} title={t("Same model (GPT Image 2.5), the other provider; you confirm the price first")}>{tryOtherLabel(provider)}</Button>}
      </span>
    ) : null;
  return (
    <TileFrame
      name={starter ? t(tpl.name) : tpl.name} aspect={aspectOf(tpl)} status={status} image={image} dim={tpl.status !== "ready"} overlay={overlay}
      onOpen={tpl.status === "ready" ? onOpen : undefined}
      editing={editing} onRenamed={(name) => { setEditing(false); if (name) onRename(name); }}
      menu={<CardMenu disabled={acting} onRename={() => setEditing(true)} onRemove={onRemove} />}
      note={tpl.importedFrom ? t("From {product}", { product: tpl.importedFrom }) : null}
      caption={guidanceCaption(guidanceOf(tpl), t) ?? [GROUP_LABEL[groupOf(tpl) ?? ""] ? t(GROUP_LABEL[groupOf(tpl) ?? ""]) : null, starter ? t("Starter") : tpl.importedFrom ? t("Imported") : t("Yours")].filter(Boolean).join(" · ")}
    />
  );
}

/** Read and waiting for the person: what was found, and "Make template" (which confirms the credits first). */
function AnalyzedCard({ template: tpl, acting, onMake, onRename, onRemove, provider, onProvider, productId, openaiReady, openaiPlan, lock }: {
  template: ProductTemplate; acting: boolean; onMake: () => void; onRename: (name: string) => void; onRemove: () => void;
  provider: ImageProvider; onProvider: (provider: ImageProvider) => void; productId: string; openaiReady: boolean | null; openaiPlan: OpenAiImagePlan | null;
  /** Set when this install can't make images yet: shown in place of "Make template". */
  lock: FeatureState | null;
}) {
  const { t, tn } = useT();
  const [editing, setEditing] = useState(false);
  const a = tpl.analysis;
  const fields = a?.fields ?? [];
  const shownFields = fields.slice(0, 4);
  const estimate = remakeEstimate(tpl, provider);
  return (
    <div className="flex h-full min-w-0 gap-3 rounded-small border border-line bg-card p-2.5">
      <div className="relative w-[92px] shrink-0 self-start overflow-hidden rounded-inner border border-line bg-control">
        {tpl.sourceUrl
          ? <StyleThumb src={thumbUrl(tpl.sourceUrl, 200)} alt={t("{name}, the uploaded ad", { name: tpl.name })} fallback={t("No image")} className="aspect-[4/5] w-full object-top" />
            : <span className="block aspect-[4/5] w-full bg-control" />}
        <Pill dot={STATUS.analyzed.dot} className="absolute bottom-1.5 left-1.5">{t(STATUS.analyzed.label)}</Pill>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex h-7 items-center gap-1.5">
          {editing
            ? <RenameInput name={tpl.name} onDone={(name) => { setEditing(false); if (name) onRename(name); }} />
            : <span className="min-w-0 truncate text-sm font-medium text-ink" title={tpl.name}>{tpl.name}</span>}
          {a && !editing && <Badge className="shrink-0 tabular-nums">{a.aspect}</Badge>}
          <span className="ml-auto" />
          <CardMenu disabled={acting} onRename={() => setEditing(true)} onRemove={onRemove} />
        </div>
        {guidanceCaption(a, t) && <p className="-mt-1.5 truncate text-xs text-muted" title={a?.bestFor}>{guidanceCaption(a, t)}</p>}
        <div className="grid gap-0.5">
          <span className="text-xs font-medium text-muted">{fields.length ? tn(fields.length, "{n} text slot", "{n} text slots") : t("No text on the image")}</span>
          {shownFields.map((f) => (
            <span key={f.key} className="flex min-w-0 gap-1.5 text-xs leading-4">
              <span className="shrink-0 text-label">{f.label}</span>
              <span className="min-w-0 truncate text-muted" title={f.example}>{f.sensitive ? t("your own, sourced") : f.example}</span>
            </span>
          ))}
          {fields.length > shownFields.length && <span className="text-xs leading-4 text-faint">{t("+{n} more", { n: fields.length - shownFields.length })}</span>}
        </div>
        {a?.brands.length ? <p className="line-clamp-2 text-xs leading-4 text-muted"><span className="font-medium text-label">{t("Kept out")}</span> {a.brands.join(", ")}</p> : null}
        {lock ? <FeatureLock state={lock} className="mt-auto" /> : <>
          <ImageProviderPicker value={provider} onChange={onProvider} productId={productId} openaiReady={openaiReady} plan={openaiPlan} quality={TEMPLATE_REMAKE_OPTIONS.quality} resolution={TEMPLATE_REMAKE_OPTIONS.resolution} compact className="mt-auto" />
          <Button size="sm" onClick={onMake} disabled={acting || !a} className="self-start">
            {acting ? <><Spinner className="size-3.5" />{t("Checking the price…")}</> : <>{t("Make template")}<span className="font-normal opacity-60">· {costLabel(provider, estimate)}</span></>}
          </Button>
        </>}
      </div>
    </div>
  );
}

function RenameInput({ name, onDone }: { name: string; onDone: (name: string | null) => void }) {
  const { t } = useT();
  const done = useRef(false);
  const finish = (value: string | null) => { if (done.current) return; done.current = true; onDone(value); };
  return (
    <input autoFocus defaultValue={name} maxLength={80} aria-label={t("Template name")}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={(e) => finish(e.currentTarget.value)}
      onKeyDown={(e) => { if (e.key === "Enter") finish(e.currentTarget.value); if (e.key === "Escape") finish(null); }}
      className={cx(inputClass, "h-7 min-w-0 flex-1 px-2 py-0 text-sm")} />
  );
}

/** "…" with Rename and Remove. */
function CardMenu({ disabled, onRename, onRemove }: { disabled?: boolean; onRename: () => void; onRemove: () => void }) {
  const { t } = useT();
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
      <IconButton size="sm" label={t("More")} disabled={disabled} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} />
      {open && (
        <div role="menu" className="page-in absolute right-0 bottom-full z-20 mb-1 w-36 rounded-card border border-hairline bg-raised p-1 shadow-pop">
          <button type="button" role="menuitem" onClick={() => { setOpen(false); onRename(); }} className={cx(item, "text-ink")}><IconPencil />{t("Rename")}</button>
          <button type="button" role="menuitem" onClick={() => { setOpen(false); onRemove(); }} className={cx(item, "text-warn")}><IconTrash />{t("Remove")}</button>
        </div>
      )}
    </div>
  );
}

function LibrarySkeleton() {
  const { t } = useT();
  return (
    <div aria-busy="true">
      <span className="sr-only">{t("Loading the Library")}</span>
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
  const { t } = useT();
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeRef.current?.focus(); }, []);
  return (
    <PanelPortal onClose={onClose}>
      <div className={cx(PANEL_OVERLAY, "z-[70]")} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div role="dialog" aria-modal="true" aria-label={t("Starter templates")} className={cx(PANEL, "page-in @container max-w-[600px]")}>
          <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-line bg-card px-4 py-3">
            <div className="min-w-0">
              <h2 className="text-sm font-medium">{t("Starter templates")}</h2>
              <p className="mt-0.5 text-xs text-muted">{t("{n} proven Meta ad formats. Free to add; they stay in this product's Library.", { n: AD_STYLES.length })} <span className="tabular-nums">{t("{n} added", { n: added.size })}</span></p>
            </div>
            <button ref={closeRef} type="button" onClick={onClose} aria-label={t("Close")} className="grid size-7 shrink-0 place-items-center rounded-control text-muted transition hover:bg-hover hover:text-ink"><IconX className="size-4" /></button>
          </header>
          <div className="grid gap-4 p-4">
            {STYLE_GROUPS.map((g) => (
              <section key={g.id} aria-label={t(g.label)}>
                <h3 className="mb-2 text-xs font-medium text-muted">{t(g.label)}</h3>
                <ul className="grid grid-cols-2 gap-2.5 @lg:grid-cols-3">
                  {AD_STYLES.filter((s) => s.group === g.id).map((s) => {
                    const isAdded = added.has(s.id);
                    return (
                      <li key={s.id} className="flex min-w-0 flex-col overflow-hidden rounded-small border border-line bg-card">
                        <div className="relative aspect-[4/5] w-full overflow-hidden border-b border-line bg-control">
                          <StyleThumb src={s.thumbImage} alt={t("{name} example", { name: t(s.name) })} className="size-full object-top" />
                          <Pill className="absolute top-2 left-2">{s.aspects.join(" · ")}</Pill>
                        </div>
                        <div className="flex flex-1 flex-col gap-1 p-2.5">
                          <span className="truncate text-xs font-medium text-ink" title={t(s.name)}>{t(s.name)}</span>
                          {guidanceCaption(s, t) && <span className="-mt-1 truncate text-xs text-faint">{guidanceCaption(s, t)}</span>}
                          <p className="line-clamp-2 min-h-8 text-xs leading-4 text-muted">{t(s.tagline)}</p>
                          <Button size="sm" variant={isAdded ? "ghost" : "secondary"} disabled={isAdded || acting === s.id} onClick={() => onAdd(s)} className="mt-1.5 w-full">
                            {isAdded ? <><IconCheck />{t("Added")}</> : acting === s.id ? <><Spinner className="size-3.5" />{t("Adding…")}</> : <><IconPlus />{t("Add to library")}</>}
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
  const { t } = useT();
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
        <div role="dialog" aria-modal="true" aria-label={t("Import from another app")} className={cx(MODAL, "page-in @container max-w-[640px]")}>
          <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-line bg-card px-4 py-3">
            <div className="min-w-0">
              <h2 className="text-sm font-medium">{t("Import from another app")}</h2>
              <p className="mt-0.5 text-xs text-muted">{t("Ready templates from your other products. Free: the template image is reused, nothing new is made. You fill it in for this product as usual.")}</p>
            </div>
            <button ref={closeRef} type="button" onClick={onClose} aria-label={t("Close")} className="grid size-7 shrink-0 place-items-center rounded-control text-muted transition hover:bg-hover hover:text-ink"><IconX className="size-4" /></button>
          </header>
          <div className="grid gap-4 p-4">
            {!listing && !loadFailed ? (
              <div aria-busy="true" className="grid grid-cols-2 gap-2.5 @lg:grid-cols-3">
                <span className="sr-only">{t("Loading your other products")}</span>
                {[0, 1, 2].map((i) => <Bone key={i} className="aspect-[4/5] w-full rounded-small" />)}
              </div>
            ) : loadFailed || listing?.error ? (
              <div className="grid justify-items-center gap-2 py-6 text-center">
                <p className="text-xs text-muted">{listing?.error ?? t("Couldn't load your other products.")}</p>
                <Button size="sm" variant="secondary" onClick={load}>{t("Try again")}</Button>
              </div>
            ) : !groups.length ? (
              <p className="py-8 text-center text-xs text-muted">{t("No templates in your other products yet.")}</p>
            ) : groups.map((g) => (
              <section key={g.productId} aria-label={g.productName}>
                <h3 className="mb-2 flex items-baseline gap-1.5 text-xs font-medium text-muted">
                  <span className="truncate">{g.productName}</span><span className="text-faint tabular-nums">{g.templates.length}</span>
                </h3>
                <ul className="grid grid-cols-2 gap-2.5 @lg:grid-cols-3">
                  {g.templates.map((tpl) => {
                    const isAdded = tpl.added || done.has(tpl.id);
                    const image = imageOf(tpl);
                    return (
                      <li key={tpl.id} className="flex min-w-0 flex-col overflow-hidden rounded-small border border-line bg-card">
                        <div className="relative aspect-[4/5] w-full overflow-hidden border-b border-line bg-control">
                          {image
                            ? <StyleThumb src={thumbUrl(image, 480)} alt={tpl.name} fallback={t("No image")} className="size-full object-top" />
                              : <span className="block size-full bg-control" />}
                          {aspectOf(tpl) && <Pill className="absolute top-2 left-2">{aspectOf(tpl)}</Pill>}
                        </div>
                        <div className="flex flex-1 flex-col gap-1 p-2.5">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink" title={tpl.kind === "starter" ? t(tpl.name) : tpl.name}>{tpl.kind === "starter" ? t(tpl.name) : tpl.name}</span>
                            <Badge className="shrink-0">{tpl.kind === "starter" ? t("Starter") : t("Custom")}</Badge>
                          </span>
                          <Button size="sm" variant={isAdded ? "ghost" : "secondary"} disabled={isAdded || acting === tpl.id} onClick={() => take(tpl)} className="mt-1.5 w-full">
                            {isAdded ? <><IconCheck />{t("In this Library")}</> : acting === tpl.id ? <><Spinner className="size-3.5" />{t("Importing…")}</> : <><IconDownload />{t("Import")}</>}
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
