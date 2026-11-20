"use client";
// An app's settings page (/app/w/<id>/settings): everything about one app in four tabs (?tab=, lib/nav-model.ts).
// - Profile (product/product-profile.tsx): what the app is and who it's for, and the AI's fuller read of its links.
// - Brand (brand-core.tsx, then brand-assets.tsx): what every creative follows (the essentials open, the rest
//   under "More detail"), then the App Store link, screenshots and the app's own pictures.
// - Connections (settings/app-settings.tsx): Meta, RevenueCat, Superwall, Mixpanel, AppStack.
// - Advanced (settings/app-settings.tsx): where the app's files go, and deleting the app.
// The Brand tab edits one draft (lib/brand.ts: basics and the brand system) saved together by Save;
// saving keeps the brand kit's colours, tone and claims in step for every older reader. Profile and the
// connections save on their own. The AI product profile only suggests ("Use this").
// "Import a brand guide" reads a pasted guide, a file or a brand folder in the browser
// (lib/brand-import.ts), shows what it found, then uploads any font files and product images and saves.
// Only the parts the guide has are replaced; the rest of the brand stays as it is.
// Every generator (Studio, Remix, Recreate, composed ads) reads what's saved here.
import { useCallback, useEffect, useRef, useState } from "react";
import { applySuggestion, unionList, type BrandBasics, type BrandOverview, type BrandSuggestion } from "@/lib/brand";
import { GUIDE_HEADINGS, readBrandFolder, readBrandGuide, type BrandImport } from "@/lib/brand-import";
import { EMPTY_BRAND_SYSTEM, keepHandEntered, type BrandSystem } from "@/lib/brand-system";
import type { ProductRow } from "@/lib/db";
import { uploadProductAsset } from "../product/upload-asset";
import { ProductProfileTab } from "../product/product-profile";
import { AppAdvanced, AppConnectionsPanel } from "../settings/app-settings";
import { useT } from "@/lib/i18n/client";
import { appSettingsHref, APP_SETTINGS_TABS, type AppSettingsTab } from "@/lib/nav-model";
import { IconAlert } from "../icons";
import { Badge, Button, Card, cx, ErrorNote, inputClass, Page, segmentClass, segmentTrackClass, Spinner, StatusPill } from "../ui";
import { BrandSkeleton } from "../page-skeletons";
import { ProductPageHeader } from "../workspace/product-header";
import { BrandAssetsTab } from "./brand-assets";
import { BrandCoreTab } from "./brand-core";
import { uploadFont } from "./brand-fields";
import { BrandSuggestions } from "./brand-suggestions";
import { LockedNote, useLocked } from "../research/gates";

type Overview = BrandOverview & { error?: string };
const EMPTY_BASICS: BrandBasics = { appName: "", tagline: "", iconUrl: "", appStoreUrl: "", screenshotUrls: [] };
const failed = (error: string): Overview => ({ name: "", appName: "", stored: false, draft: { basics: EMPTY_BASICS, system: EMPTY_BRAND_SYSTEM }, suggestions: [], hasProfile: false, error });

/** Reads every file of a picked folder: text for .md/.json, the File for the rest. */
async function readPicked(list: FileList) {
  const files = [...list];
  const entries = await Promise.all(files.map(async (f) => ({ path: f.webkitRelativePath || f.name, text: /\.(md|markdown|txt|json)$/i.test(f.name) ? await f.text() : undefined })));
  const byPath = new Map(files.map((f) => [f.webkitRelativePath || f.name, f]));
  const top = (files[0]?.webkitRelativePath ?? "").split("/");
  const folder = top[0] || files[0]?.name || "";
  return { entries, byPath, folder };
}

export function AppSettingsView({ productId, tab: linkedTab }: { productId: string; tab: AppSettingsTab }) {
  const { t, tn } = useT();
  const [tab, setTab] = useState<AppSettingsTab>(linkedTab);
  // A link to another tab of this page (the server passes the new ?tab=) switches to it.
  const [linked, setLinked] = useState(linkedTab);
  if (linkedTab !== linked) { setLinked(linkedTab); setTab(linkedTab); }

  const [overview, setOverview] = useState<Overview | null>(null);
  const [product, setProduct] = useState<ProductRow | null>(null);
  const [productFailed, setProductFailed] = useState(false);
  const [basics, setBasics] = useState<BrandBasics>(EMPTY_BASICS);
  const [sys, setSys] = useState<BrandSystem>(EMPTY_BRAND_SYSTEM);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "win" | "warn"; text: string } | null>(null);
  const [pending, setPending] = useState<(BrandImport & { byPath: Map<string, File>; folder: string }) | null>(null);
  const [withImages, setWithImages] = useState(true);
  const [importing, setImporting] = useState<string | null>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  // The "Import a brand guide" panel: paste a guide, or pick a file or a folder.
  const [importOpen, setImportOpen] = useState(false);
  const [pasted, setPasted] = useState("");
  // Brand suggestions come from the AI's read of the product's links: without its key there are none.
  const aiLocked = useLocked("ai");

  const loadBrand = useCallback(async () => {
    const data = await fetch(`/api/products/${productId}/brand`, { cache: "no-store" }).then((r) => r.json() as Promise<Overview>).catch(() => failed(t("Couldn't reach the server. Check your connection and reload.")));
    if (!data.draft) return failed(data.error ?? t("Couldn't load the brand."));
    return data;
  }, [productId, t]);

  const showBrand = useCallback((data: Overview) => { setOverview(data); setBasics(data.draft.basics); setSys(data.draft.system); }, []);

  useEffect(() => {
    let live = true;
    void loadBrand().then((data) => { if (live) showBrand(data); });
    fetch(`/api/products/${productId}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
      .then((row: ProductRow | null) => { if (live) { if (row?.id) setProduct(row); else setProductFailed(true); } });
    return () => { live = false; };
  }, [productId, loadBrand, showBrand]);

  // Folder pickers need these attributes, which React doesn't type.
  useEffect(() => { folderInput.current?.setAttribute("webkitdirectory", ""); folderInput.current?.setAttribute("directory", ""); }, [overview, tab, importOpen]);

  /** Switches tab and puts it in the address, so a reload or a shared link opens the same tab. */
  function open(next: AppSettingsTab) {
    if (next === tab) return;
    // "Use this" on the Profile tab saves straight to the brand: pick it up unless there are edits here.
    if (tab === "profile" && next === "brand" && !dirty) void loadBrand().then(showBrand);
    setTab(next);
    // "Saved" belongs to the tab it was said on.
    setMessage(null);
    window.history.replaceState(null, "", appSettingsHref(productId, next));
  }

  const edit = (patch: Partial<BrandSystem>) => { setSys((s) => ({ ...s, ...patch })); setDirty(true); };
  const editBasics = (patch: Partial<BrandBasics>) => { setBasics((b) => ({ ...b, ...patch })); setDirty(true); };
  const warn = (text: string) => setMessage({ tone: "warn", text });
  /** "Use this" on the Brand tab: into the draft, saved with everything else. */
  const use = (s: BrandSuggestion) => { const next = applySuggestion({ basics, system: sys }, s); setBasics(next.basics); setSys(next.system); setDirty(true); };

  async function save(next = sys) {
    setSaving(true);
    setMessage(null);
    const response = await fetch(`/api/products/${productId}/brand`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ basics, system: next }) }).catch(() => null);
    const data = await response?.json().catch(() => null) as Overview | null;
    setSaving(false);
    if (!response?.ok || !data?.draft) { warn(data?.error ?? t("Couldn't save. Try again.")); return false; }
    showBrand(data);
    setDirty(false);
    setMessage({ tone: "win", text: t("Saved. Every new generation uses it.") });
    return true;
  }

  async function pick(list: FileList | null) {
    if (!list?.length) return;
    const { entries, byPath, folder } = await readPicked(list);
    setPending({ ...readBrandFolder(entries, folder, t), byPath, folder });
    setImportOpen(false);
  }

  /** Reads the pasted guide. */
  function readPasted() {
    if (!pasted.trim()) return;
    setPending({ ...readBrandGuide(pasted, undefined, t), byPath: new Map(), folder: t("the pasted guide") });
    setImportOpen(false);
  }

  /** Uploads the fonts (and, if wanted, the product images and logos), links them, then saves. */
  async function runImport() {
    if (!pending) return;
    // The import replaces the parts it brings; every other part stays, and so does what only this page
    // sets: the brand's own forbidden claims, verified facts, wording, disclaimers and the sources of
    // offers and prices.
    const brought = Object.fromEntries(pending.parts.map((part) => [part, structuredClone(pending.system[part])])) as Partial<BrandSystem>;
    const next: BrandSystem = keepHandEntered(sys, { ...structuredClone(sys), ...brought, source: pending.system.source, importedFrom: pending.system.importedFrom, updatedAt: pending.system.updatedAt });
    next.voice.forbiddenClaims = unionList([sys.voice.forbiddenClaims, pending.system.voice.forbiddenClaims]);
    const problems: string[] = [];
    try {
      for (const [i, task] of pending.fonts.entries()) {
        setImporting(t("Uploading fonts ({n}/{total})…", { n: i + 1, total: pending.fonts.length }));
        const file = pending.byPath.get(task.path);
        if (!file) continue;
        try {
          const url = await uploadFont(productId, file, t);
          next.fonts = next.fonts.map((f) => (f.role === task.role && f.family === task.family ? { ...f, url, weight: task.weight } : f));
        } catch (e) { problems.push(e instanceof Error ? e.message : String(e)); }
      }
      if (withImages) {
        for (const [i, task] of pending.images.entries()) {
          setImporting(t("Adding images ({n}/{total})…", { n: i + 1, total: pending.images.length }));
          const file = pending.byPath.get(task.path);
          if (!file) continue;
          try {
            const asset = await uploadProductAsset(productId, file, { kind: task.kind, label: task.label }, t);
            if (task.productSlug) next.products = next.products.map((p) => (p.slug === task.productSlug ? { ...p, assetIds: [...p.assetIds, asset.id] } : p));
          } catch (e) { problems.push(e instanceof Error ? e.message : String(e)); }
        }
      }
      setImporting(t("Saving…"));
      if (!(await save(next))) return;
      setPending(null);
      setPasted("");
      if (problems.length) warn(tn(problems.length, "Imported, with {n} file not uploaded: {problems}", "Imported, with {n} files not uploaded: {problems}", { problems: problems.slice(0, 2).join("; ") }));
    } finally {
      setImporting(null);
    }
  }

  // Only the suggestions that would still change something, against what's being edited.
  const suggestions = (overview?.suggestions ?? []).filter((s) => JSON.stringify(applySuggestion({ basics, system: sys }, s)) !== JSON.stringify({ basics, system: sys }));

  if (!overview) return <BrandSkeleton />;
  const appName = basics.appName || overview.name || t("this app");
  const drafting = tab === "brand";
  const TAB_LABEL: Record<AppSettingsTab, string> = { profile: t("Profile"), brand: t("Brand"), connections: t("Connections"), advanced: t("Advanced") };
  const subtitle = tab === "profile" ? t("What {name} is and who it's for: your profile, and the AI's fuller read of your links.", { name: appName })
    : tab === "connections" ? t("The accounts {name}'s pages work from: Meta for ads, and RevenueCat, Superwall, Mixpanel or AppStack for what customers earn.", { name: appName })
    : tab === "advanced" ? t("Where {name}'s files go, and deleting the app.", { name: appName })
    : t("What every creative for {name} follows, and the pictures it uses. The essentials are here; the rest is under More detail.", { name: appName });

  return (
    <Page>
      <ProductPageHeader productId={productId} page="App settings" name={overview.name} subtitle={subtitle}
        actions={<>
          {drafting && sys.source === "brand-skill" && <StatusPill tone="win">{t("Imported")}{sys.importedFrom ? ` · ${sys.importedFrom === "Pasted guide" ? t("Pasted guide") : sys.importedFrom}` : ""}</StatusPill>}
          {drafting && <Button variant="secondary" aria-expanded={importOpen} onClick={() => setImportOpen(!importOpen)}>{t("Import a brand guide")}</Button>}
          {(drafting || dirty) && <Button onClick={() => save()} disabled={!dirty || saving}>{saving ? <><Spinner /> {t("Saving…")}</> : dirty && !drafting ? t("Save brand changes") : t("Save")}</Button>}
        </>}
      />

      <div role="tablist" aria-label={t("App settings")} className={cx(segmentTrackClass, "no-scrollbar mb-5 overflow-x-auto")}>
        {APP_SETTINGS_TABS.map((key) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => open(key)} className={segmentClass(tab === key)}>{TAB_LABEL[key]}</button>
        ))}
      </div>

      {overview.error && drafting && <ErrorNote>{overview.error}</ErrorNote>}
      {message && <p className={cx("mb-3 text-sm", message.tone === "win" ? "text-win" : "text-warn")}>{message.text}</p>}

      {importOpen && drafting && !pending && (
        <Card className="mb-4 grid gap-3 p-4">
          <div>
            <p className="text-sm font-medium">{t("Import a brand guide")}</p>
            <p className="mt-0.5 text-sm text-muted">{t("Paste your guide as Markdown or JSON, or pick a file or a folder of files. You see what was found before anything is saved, and only those parts are replaced.")}</p>
          </div>
          <textarea className={cx(inputClass, "min-h-32 font-mono")} aria-label={t("Brand guide")} value={pasted} onChange={(e) => setPasted(e.target.value)}
            placeholder={"## Voice in one line\nCalm, plain and a little dry.\n\n## How it sounds\n- Short sentences. No hype.\n\n## Prompt modifier\nWarm daylight, off-white surfaces, one product in frame."} />
          <details className="group text-xs text-muted">
            <summary className="w-fit cursor-pointer list-none rounded-xs text-label hover:text-ink">{t("What it reads")} <span aria-hidden className="inline-block transition-transform group-open:rotate-90">›</span></summary>
            <ul className="mt-2 grid gap-1">
              {GUIDE_HEADINGS.map((g) => <li key={g.part}><span className="font-medium text-label">{t(g.part)}:</span> <span className="font-mono">{g.headings}</span></li>)}
              <li>{t("A folder can also hold {fonts}, {logos} and {images}: those files are uploaded with the import.", { fonts: "fonts/", logos: "logos/", images: "product-images/" })}</li>
            </ul>
          </details>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <input ref={fileInput} type="file" multiple accept=".md,.markdown,.txt,.json,text/markdown,text/plain,application/json" className="hidden" onChange={(e) => { void pick(e.target.files); e.target.value = ""; }} />
            <input ref={folderInput} type="file" multiple className="hidden" onChange={(e) => { void pick(e.target.files); e.target.value = ""; }} />
            <Button variant="ghost" onClick={() => setImportOpen(false)}>{t("Cancel")}</Button>
            <Button variant="secondary" onClick={() => folderInput.current?.click()}>{t("Choose a folder")}</Button>
            <Button variant="secondary" onClick={() => fileInput.current?.click()}>{t("Choose a file")}</Button>
            <Button variant="secondary" onClick={readPasted} disabled={!pasted.trim()}>{t("Read the pasted guide")}</Button>
          </div>
        </Card>
      )}

      {pending && drafting && (
        <Card className="mb-4 grid gap-3 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-medium">{pending.folder ? t("Import {name}?", { name: pending.folder }) : t("Import this guide?")}</p>
            <p className="text-xs text-muted">{pending.read.length ? t("Only the parts below are replaced; the rest of the brand stays. Nothing is saved until you import.") : t("Nothing to import yet.")}</p>
          </div>
          <div className="flex flex-wrap gap-1.5">{pending.read.map((r) => <Badge key={r} tone="accent">{r}</Badge>)}</div>
          {pending.warnings.map((w) => <p key={w} className="flex items-start gap-1.5 text-xs text-caution-ink"><IconAlert className="mt-0.5 size-3.5 shrink-0" />{w}</p>)}
          <div className="grid gap-1 text-xs text-muted">
            {pending.fonts.length > 0 && <span>{tn(pending.fonts.length, "{n} font file goes to the product's storage (composed ads render with it).", "{n} font files go to the product's storage (composed ads render with them).")}</span>}
            {pending.images.length > 0 && (
              <label className="flex items-center gap-2 text-ink">
                <input type="checkbox" checked={withImages} onChange={(e) => setWithImages(e.target.checked)} />
                {tn(pending.images.length, "Also add {n} image (product shots and logos) to Assets, linked to its product", "Also add {n} images (product shots and logos) to Assets, linked to their products")}
              </label>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setPending(null)} disabled={Boolean(importing)}>{t("Cancel")}</Button>
            <Button variant="secondary" onClick={runImport} disabled={Boolean(importing) || !pending.read.length}>{importing ? <><Spinner /> {importing}</> : t("Import")}</Button>
          </div>
        </Card>
      )}

      {tab === "brand" && (
        <>
          {!overview.stored && !pending && !importOpen && (
            <Card className="mb-4 grid gap-2 p-4 text-sm">
              <p className="font-medium">{t("No brand saved yet")}</p>
              <p className="text-muted">{t("Fill in the fields below, or import a brand guide you already have (paste it, or pick a file). Until then, creatives use what's below and the AI product profile.")}{" "}<button type="button" className="rounded-xs font-medium text-accent hover:underline" onClick={() => setImportOpen(true)}>{t("Import a brand guide")}</button></p>
            </Card>
          )}
          {aiLocked && !overview.hasProfile && (
            <LockedNote state={aiLocked} className="mb-4">{t("Suggestions for colours, voice and claims to avoid come from the AI's read of your links. It needs {keys}.", { keys: aiLocked.missingKeys.join(", ") })}</LockedNote>
          )}
          {suggestions.length > 0 && (
            <div className="mb-4"><BrandSuggestions suggestions={suggestions} onUse={use} note={t("Use one to add it to the draft below, then Save.")} /></div>
          )}
          <BrandCoreTab productId={productId} basics={basics} sys={sys} placeholder={overview.name} hasProfile={overview.hasProfile} dirty={dirty}
            editBasics={editBasics} edit={edit} onError={warn} />
          {/* The pictures share the brand's draft, so one Save covers both. */}
          <section id="assets" className="mt-10 scroll-mt-16">
            <h2 className="mb-3 text-sm font-medium text-ink">{t("Pictures and App Store")}</h2>
            <BrandAssetsTab productId={productId} basics={basics} insightAt={product?.insight_at} onChange={editBasics} onError={warn} />
          </section>
        </>
      )}

      {tab === "profile" && (product ? <ProductProfileTab product={product} onChanged={setProduct} /> : productFailed ? <ErrorNote>{t("Couldn't load the product profile. Reload to try again.")}</ErrorNote> : <Spinner />)}

      {tab === "connections" && <AppConnectionsPanel id={productId} />}
      {tab === "advanced" && <AppAdvanced id={productId} />}
    </Page>
  );
}
