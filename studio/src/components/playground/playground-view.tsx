"use client";
// Studio › Remix and Studio › Templates (once "the Playground"): bring a reference ad and say what to
// change, add your own images, and new versions come back in the reference's exact style; or switch the
// form to Video and describe a shot. Templates (this app's own library of styles) fills the same form.
// The form is on the left; this app's results, live, on the right. The two tabs switch here, without a
// page load, so a template's "Use" lands in the form with nothing lost; the address follows the tab.
// Everything here belongs to one product: the page mounts it with key={productId}, so switching product
// starts from a clean slate (form, loaded request, open template, pickers, lightbox), and every list
// (results, templates, images) comes from that product's own API routes.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCached } from "@/lib/client-cache";
import { PLAYGROUND_MAX_INPUTS, type PlaygroundRequest } from "@/lib/playground";
import {
  DEFAULT_PLAYGROUND_OPTIONS, EMPTY_PLAYGROUND_REQUEST, isActiveJob, normalizePlaygroundRequest,
  type PlaygroundItem, type PlaygroundOptions, type PlaygroundOverview,
} from "@/lib/playground-plan";
import { softenVideoPrompt } from "@/lib/playground-video";
import { otherProvider } from "@/lib/image-provider";
import { createClient } from "@/lib/supabase/client";
import { ASSET_KIND_LABEL, type AssetKind } from "@/lib/product-assets";
import { PlaygroundSkeleton } from "../page-skeletons";
import { CapabilityPills, useFeatures } from "../studio/features";
import { Card, ErrorNote, Page } from "../ui";
import { useT } from "@/lib/i18n/client";
import { studioHref } from "@/lib/nav-model";
import { ProductPageHeader } from "../workspace/product-header";
import type { PickSource, PickTile } from "./image-picker";
import { PlaygroundForm } from "./playground-form";
import { PlaygroundResults, resultCards } from "./playground-results";
import { TemplateLibrary } from "./template-library";

type Tab = "playground" | "library";

/** `openTemplate` opens one of this product's templates, and `library` starts on the Library tab (links from the Studio). */
export function PlaygroundView({ productId, openTemplate = null, library = false }: { productId: string; openTemplate?: string | null; library?: boolean }) {
  const url = `/api/playground/${productId}`;
  const [overview, reload] = useCached<PlaygroundOverview>(url);
  const { t } = useT();
  const [tab, setTabState] = useState<Tab>(library ? "library" : "playground");
  /** Switches tab and puts it in the address (Remix or Templates), so a reload opens the same one. */
  const setTab = (next: Tab) => {
    setTabState(next);
    const href = studioHref(productId, next === "library" ? "templates" : "remix");
    if (window.location.pathname !== href) window.history.replaceState(window.history.state, "", href);
  };
  const [request, setRequest] = useState<PlaygroundRequest>(EMPTY_PLAYGROUND_REQUEST);
  const [options, setOptions] = useState<PlaygroundOptions>(DEFAULT_PLAYGROUND_OPTIONS);
  // The product's remembered image provider seeds the form once, when the overview first arrives (render-time, not an effect).
  const [seeded, setSeeded] = useState(false);
  if (overview && !seeded) {
    setSeeded(true);
    setOptions((o) => ({ ...o, provider: overview.imageProvider ?? o.provider }));
  }
  const formRef = useRef<HTMLDivElement>(null);
  const supabase = useMemo(() => createClient(), []);
  const features = useFeatures(productId);
  const items = useMemo(() => overview?.items ?? [], [overview]);

  const reloadSoon = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleReload = useCallback(() => {
    if (reloadSoon.current) clearTimeout(reloadSoon.current);
    reloadSoon.current = setTimeout(() => { reload().catch(() => {}); }, 500);
  }, [reload]);

  // Jobs and results arrive over Realtime (as on the Studio); each change reloads the history.
  useEffect(() => {
    const channel = supabase.channel(`playground-${productId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "creative_jobs", filter: `product_id=eq.${productId}` }, scheduleReload)
      .on("postgres_changes", { event: "*", schema: "public", table: "creatives", filter: `product_id=eq.${productId}` }, scheduleReload)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
      if (reloadSoon.current) clearTimeout(reloadSoon.current);
    };
  }, [productId, supabase, scheduleReload]);

  // A safety net while anything is in flight, in case the live connection drops.
  const working = items.some((i) => i.jobs.some((j) => isActiveJob(j.status)) || i.outputs.some((o) => o.qaStatus === "pending" || o.qaStatus === "running"));
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => { reload().catch(() => {}); }, 15_000);
    return () => clearInterval(timer);
  }, [working, reload]);

  const sources = useMemo<Record<PickSource, PickTile[]>>(() => ({
    product: (overview?.productImages ?? []).map((a) => ({ url: a.url, label: a.label, caption: t(ASSET_KIND_LABEL[a.kind as AssetKind] ?? a.kind) })),
    research: (overview?.researchImages ?? []).map((a) => ({ url: a.url, label: a.page, caption: a.page })),
    // Images only: a video result becomes a reference through "Use as reference" (its frame).
    results: resultCards(items).flatMap((c) => (c.type === "output" && c.output.kind !== "video" ? [{ url: c.output.url, label: c.item.request.prompt.slice(0, 80), caption: c.output.aspect }] : [])),
  }), [overview, items, t]);

  const showForm = () => {
    setTab("playground");
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const load = (next: Partial<PlaygroundRequest>, nextOptions?: PlaygroundOptions) => {
    setRequest(normalizePlaygroundRequest({ ...EMPTY_PLAYGROUND_REQUEST, ...next }));
    if (nextOptions) setOptions(nextOptions);
    showForm();
  };

  if (!overview) return <PlaygroundSkeleton />;
  if (!overview.workspace) return <Page><ProductPageHeader productId={productId} page="Studio" /><ErrorNote>{overview.error ?? t("This product doesn't exist.")}</ErrorNote></Page>;
  const { workspace, backend } = overview;

  return (
    <Page>
      <ProductPageHeader productId={productId} page="Studio" name={workspace.name}
        tab={tab === "library" ? "templates" : "remix"}
        onTab={(next) => { if (next === "create") return false; setTab(next === "templates" ? "library" : "playground"); return true; }}
        subtitle={tab === "library"
          ? t("Ready-made styles for {name}: pick one, add your pictures and make it yours.", { name: workspace.appName || workspace.name })
          : t("Bring an ad you like, say what to change and add your own pictures: new versions come back in its exact style for {name}. Or describe a shot and make a video.", { name: workspace.appName || workspace.name })}
        actions={<CapabilityPills features={features} backend={backend} />}
      />
      {overview.error && <ErrorNote>{overview.error}</ErrorNote>}
      {/* The Library is a marketplace: it takes the whole width, as many templates a row as fit. */}
      {tab === "library" ? (
        <div>
          <TemplateLibrary productId={productId} initialOpenId={openTemplate} productImages={overview.productImages.map((a) => ({ url: a.url, label: a.label, kind: a.kind }))} onUse={(next) => load(next)}
            imageProvider={overview.imageProvider} openaiReady={backend ? backend.openaiImages : null} openaiPlan={backend?.openaiImagePlan} />
        </div>
      ) : (
      <div className="grid items-start gap-3 @4xl:grid-cols-[minmax(340px,400px)_minmax(0,1fr)]">
        <div ref={formRef} className="min-w-0 scroll-mt-14 @4xl:sticky @4xl:top-14">
          <Card className="grid gap-4 p-4">
            <PlaygroundForm
              productId={productId} overview={overview} features={features} request={request} options={options} onRequest={setRequest} onOptions={setOptions} sources={sources}
              onStarted={() => { reload().catch(() => {}); }}
            />
          </Card>
        </div>
        <PlaygroundResults
          productId={productId} items={items} features={features}
          // Image mode: the new reference. Video mode (no style reference): the first of the images.
          onUseAsReference={(url) => {
            setRequest((r) => (r.mode === "video" ? { ...r, inputUrls: [url, ...r.inputUrls.filter((u) => u !== url)].slice(0, PLAYGROUND_MAX_INPUTS) } : { ...r, referenceUrl: url }));
            showForm();
          }}
          onEdit={(item: PlaygroundItem) => { const { options: o, ...r } = item.request; load(r, o); }}
          onSoften={(item: PlaygroundItem) => { const { options: o, ...r } = item.request; load({ ...r, prompt: softenVideoPrompt(r.prompt) }, o); }}
          // "Try with OpenAI/Higgsfield instead": the same request in the form on the other provider; nothing runs until Generate is confirmed.
          onTryOther={(item: PlaygroundItem) => { const { options: o, ...r } = item.request; load(r, { ...o, provider: otherProvider(o.provider) }); }}
          onChanged={() => { reload().catch(() => {}); }}
        />
      </div>
      )}
    </Page>
  );
}
