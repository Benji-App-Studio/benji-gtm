"use client";
// The Studio for one product: start a batch, watch its jobs, review what comes back.
// Opens from the client cache and follows jobs and creatives live over Realtime. Playground results are
// reviewed here too (lib/studio-sources.ts); ?review=<creativeId> opens that creative's review panel.
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCached } from "@/lib/client-cache";
import { pendingWork } from "@/lib/creative-review";
import { CREATIVE_COLUMNS, type CreativeJobRow, type CreativeView, type StudioOverview } from "@/lib/creative-types";
import { reviewParam, studioRows } from "@/lib/studio-sources";
import { createClient } from "@/lib/supabase/client";
import { notice } from "../dialog";
import { StudioSkeleton } from "../page-skeletons";
import { ErrorNote, Page, SectionHeader } from "../ui";
import { ProductPageHeader } from "../workspace/product-header";
import { PlaybookTips } from "../playbook-tip";
import { SendToMeta } from "../launch/send-sheet";
import { BatchForm } from "./batch-form";
import { CreativeGallery } from "./creative-gallery";
import { CapabilityPills, useFeatures } from "./features";
import { JobList } from "./job-list";
import { useComposedAds } from "./use-composed-ads";
import { useLogoOverlays } from "./use-logo-overlays";

/** The cached list with newer live rows swapped in and new ones on top, newest first. */
function merge<T extends { id: string; updated_at: string; created_at: string }>(base: T[], live: Record<string, T>): T[] {
  const byId = new Map(base.map((row) => [row.id, row]));
  for (const row of Object.values(live)) {
    const known = byId.get(row.id);
    if (!known || Date.parse(row.updated_at) >= Date.parse(known.updated_at)) byId.set(row.id, known ? { ...known, ...row } : row);
  }
  return [...byId.values()].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

/** Reads ?review=<creativeId> once (in its own Suspense boundary, as useSearchParams needs) and drops it from the address. */
function ReviewLink({ onReview }: { onReview: (id: string) => void }) {
  const params = useSearchParams();
  const id = reviewParam(params);
  useEffect(() => {
    if (!id) return;
    onReview(id);
    const url = new URL(window.location.href);
    url.searchParams.delete("review");
    window.history.replaceState(window.history.state, "", url);
  }, [id, onReview]);
  return null;
}

export function StudioView({ productId }: { productId: string }) {
  const url = `/api/studio/${productId}`;
  const [overview, reload] = useCached<StudioOverview & { error?: string }>(url);
  // Realtime rows layered over the cached overview: whichever copy of a row is newer wins.
  const [liveJobs, setLiveJobs] = useState<Record<string, CreativeJobRow>>({});
  const [liveCreatives, setLiveCreatives] = useState<Record<string, CreativeView>>({});
  const [showForm, setShowForm] = useState(true);
  /** "Send to Meta": null when closed, else the approved creatives it starts with. */
  const [sendIds, setSendIds] = useState<string[] | null>(null);
  const supabase = useMemo(() => createClient(), []);
  const features = useFeatures(productId);
  // Template remakes' rows arrive over realtime too and stay out; the Playground's jobs stay out, its results are reviewed here.
  const batchIds = useMemo(() => ({ hidden: new Set(overview?.hiddenBatchIds ?? []), playground: new Set(overview?.playgroundBatchIds ?? []) }), [overview]);
  const { jobs, creatives } = useMemo(() => studioRows(merge(overview?.jobs ?? [], liveJobs), merge(overview?.creatives ?? [], liveCreatives), batchIds), [overview, liveJobs, liveCreatives, batchIds]);
  const [openId, setOpenId] = useState<string | null>(null);
  // A link's creative (?review=<id>): open its panel; when it isn't among the latest the overview lists, fetch it once.
  const [linked, setLinked] = useState<string | null>(null);
  const onReview = useCallback((id: string) => { setOpenId(id); setLinked(id); }, []);
  const missing = linked && overview?.workspace && !creatives.some((c) => c.id === linked) ? linked : null;
  const fetchedLink = useRef<string | null>(null);
  useEffect(() => {
    if (!missing || fetchedLink.current === missing) return;
    fetchedLink.current = missing;
    supabase.from("creatives").select(CREATIVE_COLUMNS).eq("id", missing).eq("product_id", productId).maybeSingle<CreativeView>().then(({ data }) => {
      if (data) return setLiveCreatives((live) => ({ ...live, [data.id]: data }));
      setOpenId(null);
      notice("That creative isn't in this product any more.", "Not found").catch(() => {});
    });
  }, [missing, supabase, productId]);

  const reloadSoon = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleReload = useCallback(() => {
    if (reloadSoon.current) clearTimeout(reloadSoon.current);
    reloadSoon.current = setTimeout(() => { reload().catch(() => {}); }, 400);
  }, [reload]);

  useEffect(() => {
    const channel = supabase.channel(`studio-${productId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "creative_jobs", filter: `product_id=eq.${productId}` }, (payload) => {
        if (payload.eventType === "DELETE") return scheduleReload();
        const row = payload.new as CreativeJobRow;
        setLiveJobs((live) => ({ ...live, [row.id]: row }));
        if (payload.eventType === "INSERT") scheduleReload(); // a new batch row comes with it
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "creatives", filter: `product_id=eq.${productId}` }, (payload) => {
        if (payload.eventType === "DELETE") return scheduleReload();
        const row = payload.new as CreativeView;
        setLiveCreatives((live) => ({ ...live, [row.id]: row }));
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
      if (reloadSoon.current) clearTimeout(reloadSoon.current);
    };
  }, [productId, supabase, scheduleReload]);

  // A safety net while anything is in flight, in case the live connection drops.
  const working = jobs.some((j) => j.status === "running" || j.status === "finalizing" || j.status === "queued") || creatives.some((c) => c.qa_status === "pending" || c.qa_status === "running");
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => { reload().catch(() => {}); }, 20_000);
    return () => clearInterval(timer);
  }, [working, reload]);
  // Recreate's "Place our logo": the real logo file goes on each finished image as it arrives.
  const logos = useLogoOverlays(jobs, creatives, scheduleReload);
  const composed = useComposedAds(jobs, creatives, scheduleReload);
  // What each card shows: placing or composing that failed after its retries, and what approval waits for.
  const failures = useMemo(() => ({ ...composed.failed, ...logos.failed }), [composed.failed, logos.failed]);
  const { retry: retryLogo } = logos;
  const { retry: retryCompose } = composed;
  const retryWork = useCallback((id: string) => { retryLogo(id); retryCompose(id); }, [retryLogo, retryCompose]);
  const waiting = useMemo(() => {
    const params = new Map(jobs.map((j) => [j.id, j.params]));
    return Object.fromEntries(creatives.flatMap((c) => {
      const why = pendingWork(c, c.job_id ? params.get(c.job_id) : null);
      return why ? [[c.id, why]] : [];
    })) as Record<string, string>;
  }, [jobs, creatives]);

  if (!overview) return <StudioSkeleton />;
  if (!overview.workspace) {
    return <Page><ProductPageHeader productId={productId} page="Studio" /><ErrorNote>{overview.error ?? "This product doesn't exist."}</ErrorNote></Page>;
  }
  const { workspace, backend } = overview;
  const approved = creatives.filter((c) => c.approval === "approved").length;
  // Launchable: approved with a passing (or warned) QA, by batch for the job list's "Send to Meta".
  const launchable = creatives.filter((c) => c.approval === "approved" && (c.qa_status === "pass" || c.qa_status === "warn"));
  const launchableByBatch = new Map<string, string[]>();
  for (const c of launchable) if (c.batch_id) launchableByBatch.set(c.batch_id, [...(launchableByBatch.get(c.batch_id) ?? []), c.id]);

  return (
    <Page>
      <Suspense fallback={null}><ReviewLink onReview={onReview} /></Suspense>
      <ProductPageHeader productId={productId} page="Studio" name={workspace.name}
        subtitle={`Turn a brief, a winning format or a competitor's ad into UGC videos, image ads and post-style ads. Each creative is checked against the policy; you approve what Launch may use. ${approved} approved so far.`}
        actions={<CapabilityPills features={features} backend={backend} />} />
      {overview.error && <ErrorNote>{overview.error}</ErrorNote>}

      <section className="mb-8">
        <SectionHeader title="New batch" action={<button type="button" className="rounded-xs text-xs text-muted transition-colors hover:text-ink" onClick={() => setShowForm(!showForm)} aria-expanded={showForm}>{showForm ? "Hide" : "Show"}</button>} />
        {showForm && (
          <details className="group mb-3 text-xs">
            <summary className="w-fit cursor-pointer list-none text-muted hover:text-ink">Tips for a batch that tests well <span aria-hidden className="inline-block transition-transform group-open:rotate-90">›</span></summary>
            <PlaybookTips ids={["different-concepts", "variations-vs-concepts", "hook-and-sound-off", "creative-is-targeting"]} className="mt-2" />
          </details>
        )}
        {showForm && (
          <Suspense fallback={null}>
            <BatchForm productId={productId} overview={overview} features={features} onStarted={() => { reload().catch(() => {}); }} />
          </Suspense>
        )}
      </section>

      <section className="mb-8">
        <SectionHeader title="Jobs" />
        <JobList batches={overview.batches} jobs={jobs} features={features} onChanged={() => { reload().catch(() => {}); }} launchableByBatch={launchableByBatch} onSendToMeta={setSendIds} />
      </section>

      <section>
        <SectionHeader title="Creatives" />
        <PlaybookTips ids={["fatigue"]} className="mb-3" />
        <CreativeGallery productId={productId} features={features} creatives={creatives} batches={overview.batches} playgroundBatchIds={batchIds.playground} openId={openId} onOpen={setOpenId}
          waiting={waiting} failures={failures} onRetryWork={retryWork} onChanged={() => { reload().catch(() => {}); }} onSendToMeta={setSendIds} />
      </section>
      <SendToMeta productId={productId} open={sendIds !== null} initialIds={sendIds ?? []} onClose={() => setSendIds(null)} />
    </Page>
  );
}
