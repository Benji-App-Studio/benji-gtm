"use client";
// The "Images" section of a product, on the Brand page's Assets tab: what the product is and sells, as pictures
// (app screens, products, packaging, lifestyle, people, logos). Upload them (button or drop), let the
// AI sort them (kind, label, group, what each suits), and fix what it got wrong: a kind the user picks
// sticks. People carry consent (confirmed, unknown, not given) and a "possible minor" flag: a batch
// that uses anyone not cleared warns at create time and QA asks a person to check. Product and packaging
// images can get a cut-out ("Make cut-out": a background remover run by the desktop runner), previewed
// on the tile, for composed ads' "Use the real product". Recreate and Studio later suggest these as
// references. Loads on its own.
import { memo, useCallback, useEffect, useRef, useState, type CSSProperties, type DragEvent } from "react";
import { ASSET_KIND_LABEL, ASSET_KINDS, ASSET_SOURCE_LABEL, canCutOut, CONSENT_OPTIONS, CUTOUT_CREDITS, groupAssets, peopleToCheck, type AssetConsent, type AssetKind, type ProductAsset } from "@/lib/product-assets";
import { ask, notice } from "../dialog";
import { IconChevronDown, IconExternal, IconEye, IconEyeOff, IconImage, IconLock, IconPencil, IconSparkles, IconTrash, IconUpload, IconWand } from "../icons";
import { Badge, Button, cx, Spinner, Thumb, TintIcon } from "../ui";
import { LockedNote, useLocked } from "../research/gates";
import { ASSET_IMAGE_TYPES, ASSET_MAX_BYTES, uploadProductAsset } from "./upload-asset";
import { StorageNotice, useStorageGuard } from "../storage-notice";
import { useT } from "@/lib/i18n/client";
import { joinAsSentences, joinList } from "@/lib/i18n/join";
import { m } from "@/lib/i18n/translate";

type Patch = Partial<Pick<ProductAsset, "kind" | "label" | "group_name" | "hidden" | "consent" | "possible_minor">>;
type Pending = { key: string; name: string; preview: string };
type Sorting = { all: boolean; count: number; started: number };
/** A cut-out being made: the job's status, its error, and the cut-out it replaces (so a redo is noticed). */
type Cutting = { status: string; error?: string | null; before: string | null };
const CUTOUT_ACTIVE = ["queued", "running", "finalizing"];
const CUTOUT_POLL_MS = 8_000;

const SOURCE_SHORT: Record<ProductAsset["source"], string> = { upload: m("Uploaded"), website: m("Website"), app_store: "App Store", google_play: "Google Play" };
const KIND_STICKS = m("Your pick sticks: the AI won't change it");
const UPLOADS_AT_ONCE = 3;

async function send<T>(url: string, init: RequestInit, offline: string): Promise<T & { error?: string }> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } }).catch(() => null);
  const data = await response?.json().catch(() => null);
  return (response?.ok ? data ?? {} : { error: data?.error ?? offline }) as T & { error?: string };
}

/**
 * One product's images. `refreshKey` changes when the AI reader finishes (it collects images from the
 * website and store listing), so the section loads again then.
 */
export const ProductImages = memo(function ProductImages({ productId, refreshKey }: { productId: string; refreshKey?: string | null }) {
  const { t, tn } = useT();
  const offline = t("Couldn't reach the server. Try again.");
  const [assets, setAssets] = useState<ProductAsset[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [pending, setPending] = useState<Pending[]>([]);
  const [filter, setFilter] = useState<AssetKind | "all">("all");
  const [showHidden, setShowHidden] = useState(false);
  const [sorting, setSorting] = useState<Sorting | null>(null);
  const [sortPrompt, setSortPrompt] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  const base = `/api/products/${productId}/assets`;

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  // Load when the card mounts, again when the AI reader finishes, and after a sort.
  useEffect(() => {
    let stale = false;
    fetch(base, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { assets?: ProductAsset[] }) => { if (!stale) { setAssets(Array.isArray(data.assets) ? data.assets : []); setFailed(false); } })
      .catch(() => { if (!stale) setFailed(true); });
    return () => { stale = true; };
  }, [base, refreshKey, reload]);

  const patch = useCallback(async (asset: ProductAsset, change: Patch) => {
    const swap = (next: ProductAsset) => setAssets((list) => list?.map((a) => (a.id === asset.id ? next : a)) ?? list);
    swap({ ...asset, ...change, ...(change.kind ? { kind_locked: true } : {}) });
    const result = await send<{ asset: ProductAsset }>(`${base}/${asset.id}`, { method: "PATCH", body: JSON.stringify(change) }, offline);
    if (result.error || !result.asset) { swap(asset); return notice(result.error ?? t("The change wasn't saved."), t("Couldn't save the change")); }
    swap(result.asset);
  }, [base, offline, t]);

  // Sorting needs the AI's key and cut-outs the desktop runner: each says so instead of failing.
  const aiLocked = useLocked("ai");
  const runnerLocked = useLocked("studio.runner");
  // Cut-outs: queued here, made by the desktop runner, checked every few seconds until the PNG lands on the image.
  const [cutting, setCutting] = useState<Record<string, Cutting>>({});
  const makeCutout = useCallback(async (asset: ProductAsset) => {
    if (runnerLocked) return notice(<span className="grid gap-2"><span>{t(runnerLocked.body)}</span><LockedNote state={runnerLocked}>{t("Cut-outs need the desktop runner")}</LockedNote></span>, t(runnerLocked.title));
    const ok = await ask({
      title: asset.cutout_url ? t("Make the cut-out again?") : t("Make a cut-out?"),
      body: asset.cutout_url
        ? t("The desktop runner removes the background and saves a transparent PNG of this image (about {credits} Higgsfield credit). Composed ads can then place your real product instead of the model drawing it. The new one replaces the current cut-out.", { credits: CUTOUT_CREDITS })
        : t("The desktop runner removes the background and saves a transparent PNG of this image (about {credits} Higgsfield credit). Composed ads can then place your real product instead of the model drawing it.", { credits: CUTOUT_CREDITS }),
      confirm: t("Make cut-out"),
    });
    if (!ok) return;
    setCutting((c) => ({ ...c, [asset.id]: { status: "queued", before: asset.cutout_url ?? null } }));
    const result = await send<{ job?: { status: string; error: string | null } }>(`${base}/${asset.id}/cutout`, { method: "POST", body: "{}" }, offline);
    if (result.error || !result.job) {
      setCutting((c) => { const next = { ...c }; delete next[asset.id]; return next; });
      return notice(result.error ?? t("The cut-out wasn't queued."), t("Couldn't start the cut-out"));
    }
    setCutting((c) => ({ ...c, [asset.id]: { status: result.job!.status, error: result.job!.error, before: asset.cutout_url ?? null } }));
  }, [base, runnerLocked, offline, t]);
  const activeCutouts = Object.entries(cutting).filter(([, c]) => CUTOUT_ACTIVE.includes(c.status)).map(([id]) => id).join(",");
  useEffect(() => {
    if (!activeCutouts) return;
    const timer = setInterval(async () => {
      for (const id of activeCutouts.split(",")) {
        const data = await fetch(`${base}/${id}/cutout`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null) as { cutout_url?: string | null; cutout_path?: string | null; job?: { status: string; error: string | null } | null } | null;
        if (!data || !alive.current) continue;
        setCutting((c) => {
          const was = c[id];
          if (!was) return c;
          const next = { ...c };
          if (data.cutout_url && data.cutout_url !== was.before) delete next[id];
          else if (data.job) next[id] = { ...was, status: data.job.status === "done" ? "finalizing" : data.job.status, error: data.job.error };
          return next;
        });
        if (data.cutout_url) setAssets((list) => list?.map((a) => (a.id === id ? { ...a, cutout_url: data.cutout_url ?? null, cutout_path: data.cutout_path ?? a.cutout_path } : a)) ?? list);
      }
    }, CUTOUT_POLL_MS);
    return () => clearInterval(timer);
  }, [activeCutouts, base]);

  const remove = useCallback(async (asset: ProductAsset) => {
    const ok = await ask({
      title: t("Delete this image?"),
      body: asset.source === "upload"
        ? t("It's removed from this product and its file is deleted. This can't be undone.")
        : t("It's removed from this product. To keep it but leave it out of suggestions, hide it instead."),
      confirm: t("Delete"), danger: true,
    });
    if (!ok) return;
    setAssets((list) => list?.filter((a) => a.id !== asset.id) ?? list);
    const result = await send(`${base}/${asset.id}`, { method: "DELETE" }, offline);
    if (result.error) {
      setAssets((list) => (list ? [asset, ...list].sort((a, b) => b.created_at.localeCompare(a.created_at)) : list));
      notice(result.error, t("Couldn't delete the image"));
    }
  }, [base, offline, t]);

  async function upload(files: File[]) {
    if (!files.length) return;
    const errors: string[] = [];
    const items: (Pending & { file: File })[] = [];
    for (const file of files) {
      if (!ASSET_IMAGE_TYPES.includes(file.type)) errors.push(t("{name} isn't a PNG, JPEG or WebP image.", { name: file.name }));
      else if (file.size > ASSET_MAX_BYTES) errors.push(t("{name} is over 15 MB.", { name: file.name }));
      else items.push({ key: crypto.randomUUID(), name: file.name, preview: URL.createObjectURL(file), file });
    }
    setNote(null);
    setPending((list) => [...items.map(({ key, name, preview }) => ({ key, name, preview })), ...list]);
    let added = 0;
    const queue = [...items];
    const worker = async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        try {
          const asset = await uploadProductAsset(productId, item.file, {}, t);
          added++;
          setAssets((list) => [asset, ...(list ?? []).filter((a) => a.id !== asset.id)]);
        } catch (error) {
          const message = error instanceof Error ? error.message : t("It didn't upload.");
          errors.push(message.includes(item.name) ? message : `${item.name}: ${message}`);
        } finally {
          const done = item;
          setPending((list) => list.filter((p) => p.key !== done.key));
          setTimeout(() => URL.revokeObjectURL(done.preview), 1_000);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(UPLOADS_AT_ONCE, items.length) }, worker));
    if (!alive.current) return;
    if (added) setSortPrompt(true);
    if (errors.length) {
      notice(
        <ul className="grid gap-1.5">{errors.map((e, i) => <li key={i} className="[overflow-wrap:anywhere]">{e}</li>)}</ul>,
        tn(errors.length, "Couldn't upload an image", "Couldn't upload {n} images"),
      );
    }
  }

  /** Reads the product's links again for their pictures; checks back until it's done, then reloads. */
  const [finding, setFinding] = useState(false);
  async function find() {
    setNote(null);
    setFinding(true);
    const started = await send<{ status?: string }>(base, { method: "POST", body: JSON.stringify({ action: "find" }) }, offline);
    if (started.error) { setFinding(false); return notice(started.error, t("Couldn't look for images")); }
    for (let i = 0; i < 90 && alive.current; i++) {
      await new Promise((r) => setTimeout(r, 4000));
      const row = await fetch(`/api/products/${productId}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null) as { insight_status?: string | null; insight_message?: string | null } | null;
      if (row && row.insight_status !== "running") { if (alive.current) setNote(row.insight_message ?? t("Done.")); break; }
    }
    if (!alive.current) return;
    setFinding(false);
    setReload((n) => n + 1);
  }

  async function sort(all: boolean) {
    const list = assets ?? [];
    const count = all ? list.length : list.filter((a) => !a.sorted_at).length;
    if (all && !(await ask({
      title: t("Re-sort all images?"),
      body: tn(count, "The AI looks at {n} image again and relabels, regroups and re-tags it. Kinds you picked stay as they are. It takes a minute or two.", "The AI looks at all {n} images again and relabels, regroups and re-tags them. Kinds you picked stay as they are. It takes a minute or two."),
      confirm: t("Re-sort all"),
    }))) return;
    setSortPrompt(false);
    setNote(null);
    setSorting({ all, count, started: Date.now() });
    const result = await send<{ sorted?: number }>(base, { method: "POST", body: JSON.stringify({ action: "sort", all }) }, offline);
    if (!alive.current) return;
    setSorting(null);
    if (result.error) return notice(result.error, t("Couldn't sort the images"));
    setNote(typeof result.sorted === "number" ? tn(result.sorted, "Sorted {n} image.", "Sorted {n} images.") : t("Sorted."));
    setReload((n) => n + 1);
  }

  const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer.types).includes("Files");
  const dropProps = {
    onDragEnter: (event: DragEvent) => { if (!hasFiles(event)) return; event.preventDefault(); dragDepth.current++; setDragging(true); },
    onDragOver: (event: DragEvent) => { if (hasFiles(event)) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; } },
    onDragLeave: (event: DragEvent) => { if (!hasFiles(event)) return; dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false); },
    onDrop: (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      upload(Array.from(event.dataTransfer.files));
    },
  };

  const all = assets ?? [];
  const hiddenCount = all.filter((a) => a.hidden).length;
  const shown = showHidden ? all : all.filter((a) => !a.hidden);
  const unsorted = all.filter((a) => !a.sorted_at).length;
  const kinds = ASSET_KINDS.map((k) => ({ ...k, count: shown.filter((a) => a.kind === k.id).length })).filter((k) => k.count > 0);
  const active = filter !== "all" && kinds.some((k) => k.id === filter) ? filter : "all";
  const groups = groupAssets(active === "all" ? shown : shown.filter((a) => a.kind === active));
  const visibleCount = all.length - hiddenCount;
  const empty = assets !== null && all.length === 0 && pending.length === 0;
  const pick = () => input.current?.click();
  // Uploading adds files: refused when storage is full (the notice under the buttons says why).
  const uploadGuard = useStorageGuard("upload");

  const caption = assets === null ? (failed ? t("Couldn't load the images.") : t("Loading…"))
    : t("What you sell, as pictures. They are suggested as references when you recreate a competitor's ad.");

  return (
    <section className="relative border-t border-line" aria-label={t("Images")} {...dropProps}>
      <input ref={input} type="file" accept={ASSET_IMAGE_TYPES.join(",")} multiple hidden onChange={(e) => { upload(Array.from(e.target.files ?? [])); e.target.value = ""; }} />

      <div className="flex flex-wrap items-start gap-x-4 gap-y-3 px-4 py-4">
        <div className="flex min-w-0 flex-1 basis-[260px] items-start gap-3">
          <TintIcon size="sm"><IconImage /></TintIcon>
          <div className="min-w-0 flex-1">
            <div className="flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1">
              <h3 className="text-sm font-medium">{t("Images")}</h3>
              {assets !== null && visibleCount > 0 && <Badge>{visibleCount}</Badge>}
              {unsorted > 0 && !sorting && <Badge tone="accent">{t("{n} not sorted", { n: unsorted })}</Badge>}
            </div>
            <p className="text-caption text-muted">
              {caption}
              {failed && assets === null && <> <button type="button" className="font-medium text-accent hover:underline" onClick={() => setReload((n) => n + 1)}>{t("Try again")}</button></>}
            </p>
            {note && <p className="mt-1 flex items-center gap-1.5 text-xs text-win"><IconSparkles className="size-3.5" />{note}</p>}
          </div>
        </div>
        {assets !== null && (
          <div className="flex flex-wrap items-center gap-2">
            {all.length > 0 && (aiLocked ? <LockedNote state={aiLocked}>{t("Sorting needs {keys}", { keys: aiLocked.missingKeys.join(", ") })}</LockedNote> : <SortButton unsorted={unsorted} total={all.length} busy={Boolean(sorting)} onSort={sort} />)}
            <Button size="sm" variant="ghost" onClick={find} disabled={finding} title={t("Read your website and store listing again for their pictures (no new profile)")}>
              {finding ? <Spinner className="size-3.5" /> : <IconExternal />}{finding ? t("Finding images…") : t("Find images on my site")}
            </Button>
            <Button size="sm" variant="secondary" onClick={pick} disabled={uploadGuard.block} title={uploadGuard.block ? uploadGuard.message ?? undefined : undefined}><IconUpload />{t("Upload")}</Button>
            {hiddenCount > 0 && (
              <Button size="sm" variant={showHidden ? "secondary" : "ghost"} aria-pressed={showHidden} onClick={() => setShowHidden(!showHidden)}>
                {showHidden ? <IconEye /> : <IconEyeOff />}{t("Show hidden ({n})", { n: hiddenCount })}
              </Button>
            )}
            <StorageNotice action="upload" className="basis-full" />
          </div>
        )}
      </div>

      {sorting && <SortProgress sorting={sorting} />}

      <div className="@container px-4 pb-4">
      <div className={cx("grid gap-4", tileColumns)} style={tileWidth}>
        {assets === null && !failed && (
          <div className="flex gap-3 overflow-hidden" aria-hidden>
            {[0, 1, 2, 3, 4].map((i) => <div key={i} className={cx(tileClass, "skeleton aspect-square !rounded-inner")} />)}
          </div>
        )}

        {empty && (
          <button type="button" onClick={pick}
            className="group flex flex-col items-center rounded-small border border-dashed border-hairline px-4 py-6 text-center transition-colors hover:bg-hover">
            <TintIcon className="mb-3"><IconUpload /></TintIcon>
            <span className="text-sm font-medium">{t("Add pictures of what you sell")}</span>
            <span className="mt-1 max-w-md text-caption text-muted">
              {t("App screens, product shots, packaging, lifestyle photos, people using it, your logo. Drop them here or click to choose. PNG, JPEG or WebP, up to 15 MB each.")}
            </span>
            <span className="mt-2 max-w-md text-xs text-faint">{aiLocked
              ? t("Once the AI is connected, reading your links on the Profile tab also collects images from your website and store listing.")
              : t("Reading your links with AI on the Profile tab also collects images from your website and store listing.")}</span>
          </button>
        )}

        {sortPrompt && unsorted > 0 && !sorting && !aiLocked && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-inner bg-accent-soft px-3.5 py-2.5" role="status">
            <IconSparkles className="size-4 shrink-0 text-accent" />
            <p className="min-w-0 flex-1 basis-[220px] text-caption">
              {all.some((a) => !a.sorted_at && a.kind === "other" && !a.kind_locked)
                ? tn(unsorted, "{n} image not sorted yet (it sits under Other for now). Let the AI file it by kind, label it and note what it suits?", "{n} images not sorted yet (they sit under Other for now). Let the AI file them by kind, label them and note what each suits?")
                : tn(unsorted, "{n} image not sorted yet. Let the AI file it by kind, label it and note what it suits?", "{n} images not sorted yet. Let the AI file them by kind, label them and note what each suits?")}
            </p>
            <span className="flex items-center gap-1.5">
              <Button size="sm" variant="secondary" onClick={() => sort(false)}><IconSparkles />{t("Sort with AI")}</Button>
              <Button size="sm" variant="ghost" onClick={() => setSortPrompt(false)}>{t("Not now")}</Button>
            </span>
          </div>
        )}

        {kinds.length > 1 && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("Filter by kind")}>
            <FilterChip active={active === "all"} onClick={() => setFilter("all")} label={t("All")} count={shown.length} />
            {kinds.map((k) => <FilterChip key={k.id} active={active === k.id} onClick={() => setFilter(k.id)} label={t(k.plural)} count={k.count} />)}
          </div>
        )}

        {pending.length > 0 && (
          <div className="grid gap-2.5">
            <h4 className="eyebrow">{t("Uploading {n}…", { n: pending.length })}</h4>
            <ul className="flex flex-wrap gap-3">
              {pending.map((p) => (
                <li key={p.key} className={tileClass}>
                  <div className="relative aspect-square overflow-hidden rounded-inner border border-line bg-canvas">
                    <Thumb src={p.preview} alt={p.name} className="size-full opacity-50" />
                    <span className="absolute inset-0 grid place-items-center"><span className="grid size-9 place-items-center rounded-full bg-raised/90 shadow-raised"><Spinner /></span></span>
                  </div>
                  <p className="mt-1.5 truncate text-xs text-muted" title={p.name}>{p.name}</p>
                </li>
              ))}
            </ul>
          </div>
        )}

        {assets !== null && all.length > 0 && shown.length === 0 && (
          <p className="text-caption text-muted">
            {tn(hiddenCount, "The {n} image is hidden.", "All {n} images are hidden.")}{" "}
            <button type="button" className="font-medium text-accent hover:underline" onClick={() => setShowHidden(true)}>{t("Show hidden")}</button>
          </p>
        )}

        {groups.map((k) => (
          <div key={k.kind} className="grid gap-2.5">
            <h4 className="eyebrow">{t(k.label)} <span className="tabular-nums">· {k.groups.reduce((n, g) => n + g.assets.length, 0)}</span></h4>
            {/* Groups flow side by side on one column grid (tiles share one width and gap), so small groups don't each take a row. */}
            <div className="flex flex-wrap gap-x-3 gap-y-4">
              {k.groups.map((g) => (
                <div key={g.name ?? ""} className="flex max-w-full min-w-0 flex-col gap-2">
                  {(g.name || k.groups.length > 1) && <p className="w-0 min-w-full truncate text-xs font-medium text-label" title={g.name ?? undefined}>{g.name ?? t("Not grouped")}</p>}
                  <ul className="flex flex-wrap gap-3">
                    {g.assets.map((a) => <Tile key={a.id} asset={a} onPatch={patch} onDelete={remove} cutting={cutting[a.id] ?? null} onCutout={makeCutout} />)}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      </div>

      {dragging && (
        <div className="pointer-events-none absolute inset-2 z-10 grid place-items-center rounded-inner border-2 border-dashed border-accent bg-accent-soft/90 text-sm font-medium text-accent backdrop-blur-[1px]">
          <span className="flex items-center gap-2"><IconUpload className="size-5" />{t("Drop images to add them")}</span>
        </div>
      )}
    </section>
  );
});

// An even column grid that groups can share: columns by the section's width, every tile the same
// width, 12 px gaps (the flex rows' gap-3), so tiles line up across groups that sit side by side.
const tileColumns = "[--cols:2] @sm:[--cols:3] @xl:[--cols:5] @3xl:[--cols:6]";
const tileWidth = { "--tile": "calc((100cqw - (var(--cols) - 1) * 12px) / var(--cols) - 0.1px)" } as CSSProperties;
const tileClass = "w-[var(--tile)] min-w-0 shrink-0";

function FilterChip({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick}
      className={cx("inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium whitespace-nowrap transition",
        active ? "bg-primary text-on-ink" : "bg-control text-label hover:text-ink")}>
      {label}<span className={cx("tabular-nums", active ? "text-on-ink/70" : "text-faint")}>{count}</span>
    </button>
  );
}

// MARK: Sorting

/** "Sort with AI" (the images not sorted yet, or all when every one is), with "Re-sort all" in a small menu. */
function SortButton({ unsorted, total, busy, onSort }: { unsorted: number; total: number; busy: boolean; onSort: (all: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const someNew = unsorted > 0;
  const menu = someNew && unsorted < total;
  const { t, tn } = useT();

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", key); };
  }, [open]);

  return (
    <div ref={box} className="relative inline-flex">
      <Button size="sm" variant={someNew ? "primary" : "secondary"} disabled={busy} onClick={() => onSort(!someNew)} className={cx(menu && "rounded-r-none")}
        title={someNew ? tn(unsorted, "Sorts the {n} image not sorted yet. Kinds you picked stay.", "Sorts the {n} images not sorted yet. Kinds you picked stay.") : t("Sorts every image again. Kinds you picked stay.")}>
        {busy ? <Spinner className="size-3.5" /> : <IconSparkles />}{busy ? t("Sorting…") : someNew ? t("Sort with AI") : t("Re-sort with AI")}
      </Button>
      {menu && (
        <Button size="sm" variant="primary" disabled={busy} aria-label={t("More sort options")} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}
          className="rounded-l-none border-l border-on-ink/20 !px-2"><IconChevronDown /></Button>
      )}
      {open && (
        <div role="menu" className="page-in absolute top-full left-0 z-20 mt-1.5 w-60 rounded-inner border border-line bg-raised p-1 shadow-pop">
          <button type="button" role="menuitem" onClick={() => { setOpen(false); onSort(true); }} className="w-full rounded-inner px-3 py-2 text-left transition hover:bg-control focus-visible:bg-control focus-visible:outline-none">
            <span className="block text-sm font-medium">{t("Re-sort all {n}", { n: total })}</span>
            <span className="mt-0.5 block text-xs text-muted">{t("Relabels and regroups every image. Kinds you picked stay.")}</span>
          </button>
        </div>
      )}
    </div>
  );
}

/** The bar and the clock while the AI sorts (it takes 30–90 seconds); its own timer, so tiles don't re-render. */
function SortProgress({ sorting }: { sorting: Sorting }) {
  const { t, tn } = useT();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.round((now - sorting.started) / 1000));
  return (
    <div className="mb-4 grid gap-2 px-4">
      <div className="relative h-1 w-full overflow-hidden rounded-full bg-control" role="progressbar" aria-label={t("Sorting images")}>
        <span className="bg-task-indeterminate absolute inset-y-0 w-1/3 rounded-full bg-accent" />
      </div>
      <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted" aria-live="polite">
        <span className="text-ink">{sorting.all ? tn(sorting.count, "Re-sorting {n} image with AI…", "Re-sorting all {n} images with AI…") : tn(sorting.count, "Sorting {n} image with AI…", "Sorting {n} images with AI…")}</span>
        <span className="tabular-nums">{t("{n} s", { n: seconds })}</span>
        <span className="text-faint">{t("Usually 30–90 seconds. Kinds you picked stay.")}</span>
      </p>
    </div>
  );
}

// MARK: A tile

const actionClass = "grid size-7 place-items-center rounded-full bg-raised/90 text-ink shadow-raised backdrop-blur-sm transition hover:bg-raised focus-visible:outline-2 focus-visible:outline-accent [&_svg]:size-3.5";
const revealClass = "opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100";

/** One image: square, cover, hairline; label, source and what it suits underneath; actions on hover or focus. */
const Tile = memo(function Tile({ asset: a, onPatch, onDelete, cutting, onCutout }: { asset: ProductAsset; onPatch: (asset: ProductAsset, change: Patch) => void; onDelete: (asset: ProductAsset) => void; cutting: Cutting | null; onCutout: (asset: ProductAsset) => void }) {
  const { t, locale } = useT();
  const [draft, setDraft] = useState<string | null>(null);
  const label = a.label?.trim() || t("Untitled");
  const goodFor = a.good_for ?? [];
  const meta = [t(SOURCE_SHORT[a.source]), goodFor.join(", ")].filter(Boolean).join(" · ");
  const metaTitle = joinAsSentences(locale, [t(ASSET_SOURCE_LABEL[a.source]), goodFor.length ? t("Good for: {list}", { list: joinList(locale, goodFor) }) : "", a.kind_locked ? t("Kind picked by you: the AI won't change it") : ""]);

  const save = () => {
    if (draft === null) return;
    const next = draft.trim();
    setDraft(null);
    if (next !== (a.label ?? "").trim()) onPatch(a, { label: next || null });
  };

  return (
    <li className={cx("group", tileClass)}>
      <div className="relative aspect-square overflow-hidden rounded-inner border border-line bg-canvas" title={a.description ?? undefined}>
        <Thumb src={a.url} size={384} alt={label} className={cx("size-full transition", a.hidden && "opacity-40 grayscale")} />
        {a.hidden && <span className="absolute top-1.5 left-1.5"><Badge className="bg-raised/90 shadow-raised">{t("Hidden")}</Badge></span>}
        {a.cutout_url && canCutOut(a) && (
          <a href={a.cutout_url} target="_blank" rel="noopener noreferrer" title={t("The cut-out: open the transparent PNG")} style={CHECKER}
            className="absolute right-1.5 bottom-1.5 size-[38%] overflow-hidden rounded-inner border border-line shadow-raised">
            <Thumb src={a.cutout_url} alt={t("{label}, cut out", { label })} className="size-full !object-contain" />
          </a>
        )}

        <div className={cx("absolute top-1.5 right-1.5 flex gap-1", revealClass)}>
          <a href={a.url} target="_blank" rel="noopener noreferrer" className={actionClass} aria-label={t("Open the full image")} title={t("Open the full image")}><IconExternal /></a>
          <button type="button" className={actionClass} onClick={() => setDraft(a.label ?? "")} aria-label={t("Rename")} title={t("Rename")}><IconPencil /></button>
          <button type="button" className={actionClass} onClick={() => onPatch(a, { hidden: !a.hidden })}
            aria-label={a.hidden ? t("Unhide") : t("Hide")} title={a.hidden ? t("Unhide: suggest it for ads again") : t("Hide: keep it out of suggestions")}>{a.hidden ? <IconEye /> : <IconEyeOff />}</button>
          <button type="button" className={cx(actionClass, "hover:text-warn")} onClick={() => onDelete(a)} aria-label={t("Delete")} title={t("Delete")}><IconTrash /></button>
        </div>

        <label title={t(KIND_STICKS)} className={cx("absolute bottom-1.5 left-1.5 inline-flex h-7 max-w-[calc(100%-12px)] items-center gap-1 rounded-full bg-raised/90 pr-6 pl-2.5 text-xs font-medium text-ink shadow-raised backdrop-blur-sm focus-within:outline-2 focus-within:outline-accent", revealClass)}>
          {a.kind_locked && <IconLock className="size-3 shrink-0" />}
          <span className="truncate">{t(ASSET_KIND_LABEL[a.kind])}</span>
          <IconChevronDown className="pointer-events-none absolute right-1.5 size-3.5 text-muted" />
          <select aria-label={t("Kind. {note}.", { note: t(KIND_STICKS) })} value={a.kind} onChange={(e) => onPatch(a, { kind: e.target.value as AssetKind })} className="absolute inset-0 cursor-pointer opacity-0">
            <optgroup label={t(KIND_STICKS)}>
              {ASSET_KINDS.map((k) => <option key={k.id} value={k.id}>{t(k.label)}</option>)}
            </optgroup>
          </select>
        </label>
      </div>

      <div className="mt-1.5 min-w-0">
        {draft === null ? (
          <p className="truncate text-xs font-medium" title={label}>{label}</p>
        ) : (
          <input autoFocus value={draft} maxLength={120} aria-label={t("Image label")} onChange={(e) => setDraft(e.target.value)} onBlur={save}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save(); } if (e.key === "Escape") { e.preventDefault(); setDraft(null); } }}
            className="-mx-1 w-[calc(100%+8px)] rounded-inner border border-line bg-raised px-1 text-xs font-medium outline-none focus:border-ink/25 focus:ring-2 focus:ring-ink/5" />
        )}
        <p className="mt-0.5 flex min-w-0 items-center gap-1 text-xs leading-4 text-faint" title={metaTitle}>
          {a.kind_locked && <IconLock className="size-3 shrink-0" aria-hidden />}
          <span className="truncate">{meta}</span>
        </p>
        {a.kind === "person" && <PersonConsent asset={a} onPatch={onPatch} />}
        {canCutOut(a) && <CutoutLine asset={a} cutting={cutting} onCutout={onCutout} />}
      </div>
    </li>
  );
});

/** A person's consent to appear in ads and the "possible minor" flag; anything not cleared shows why. */
function PersonConsent({ asset: a, onPatch }: { asset: ProductAsset; onPatch: (asset: ProductAsset, change: Patch) => void }) {
  const { t } = useT();
  const check = peopleToCheck([a])[0];
  return (
    <div className="mt-1 grid gap-1">
      <select aria-label={t("Consent to appear in ads")} value={a.consent ?? "unknown"} onChange={(e) => onPatch(a, { consent: e.target.value as AssetConsent })}
        title={t(CONSENT_OPTIONS.find((c) => c.id === (a.consent ?? "unknown"))?.hint ?? "")}
        className={cx("h-6 w-full rounded-inner border border-line bg-raised px-1 text-xs outline-none focus:border-ink/25", a.consent === "confirmed" ? "text-win" : a.consent === "not_given" ? "text-warn" : "text-caution-ink")}>
        {CONSENT_OPTIONS.map((c) => <option key={c.id} value={c.id}>{t(c.label)}</option>)}
      </select>
      <label className="flex items-center gap-1.5 text-xs text-label" title={t("They may be under 18: a person checks every creative that uses them.")}>
        <input type="checkbox" checked={Boolean(a.possible_minor)} onChange={(e) => onPatch(a, { possible_minor: e.target.checked })} className="size-3 accent-current" />
        {t("Possible minor")}
      </label>
      {check && <span className="sr-only">{t("Not cleared for ads: {reasons}", { reasons: check.reasons.map((r) => t(r)).join(", ") })}</span>}
    </div>
  );
}

/** A transparent image's backdrop: a light checkerboard. */
const CHECKER: CSSProperties = { background: "repeating-conic-gradient(var(--color-control) 0 25%, var(--color-raised) 0 50%) 0 0 / 12px 12px" };

/** Under a product or packaging tile: "Make cut-out", its progress, its failure, or the cut-out's state with a redo. */
function CutoutLine({ asset: a, cutting, onCutout }: { asset: ProductAsset; cutting: Cutting | null; onCutout: (asset: ProductAsset) => void }) {
  const { t } = useT();
  const link = "inline-flex items-center gap-1 font-medium text-accent hover:underline [&_svg]:size-3";
  if (cutting && CUTOUT_ACTIVE.includes(cutting.status)) {
    return <p className="mt-1 flex items-center gap-1.5 text-xs text-muted"><Spinner className="size-3" />{cutting.status === "queued" ? t("Cut-out waiting for the desktop runner…") : t("Making the cut-out…")}</p>;
  }
  if (cutting && (cutting.status === "failed" || cutting.status === "cancelled")) {
    return (
      <p className="mt-1 text-xs text-warn" title={cutting.error ?? undefined}>
        <span className="line-clamp-2">{cutting.error ? t("The cut-out failed: {error}", { error: cutting.error }) : t("The cut-out failed.")}</span>{" "}
        <button type="button" className={link} onClick={() => onCutout(a)}>{t("Try again")}</button>
      </p>
    );
  }
  return (
    <p className="mt-1 flex items-center gap-2 text-xs">
      {a.cutout_url
        ? <><span className="text-win">{t("Cut-out ready")}</span><button type="button" className={link} onClick={() => onCutout(a)} title={t("Make the cut-out again")}>{t("Redo")}</button></>
        : <button type="button" className={link} onClick={() => onCutout(a)} title={t("A transparent PNG of the product, for composed ads' \"Use the real product\"")}><IconWand />{t("Make cut-out")}</button>}
    </p>
  );
}
