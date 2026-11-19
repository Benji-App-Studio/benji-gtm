"use client";
// "Your images": small tiles of the product's own images (Product page) to send to Higgsfield with a
// creative. Used by Recreate and the Studio's batch form. The AI may mark some as suggested, but
// nothing is ever picked for the user: a tile is picked only when they click it (or upload one here).
// The grid is folded away until opened (a product can have 100+ images); the picks stay in view.
import Link from "next/link";
import { useRef, useState } from "react";
import { ASSET_IMAGE_TYPES } from "../product/upload-asset";
import { PRODUCT_REFERENCES } from "@/lib/product-assets";
import { showOriginal, thumbUrl } from "@/lib/thumb";
import { IconChevronDown, IconPlus } from "../icons";
import { cx, Spinner } from "../ui";

export interface ImageTile {
  /** What `picked` holds for this tile (an asset id, or its url). */
  key: string;
  url: string;
  label: string;
  /** A short kind label for the caption ("App screen", "Product"…). */
  kindLabel: string;
  suggested?: boolean;
  /** Why it's suggested (the tooltip). */
  why?: string | null;
}

export function ProductImagePicker({ productId, tiles, picked, onChange, onUpload, max = PRODUCT_REFERENCES }: {
  /** For the "add images" link (the Brand page's Assets tab). */
  productId?: string;
  tiles: ImageTile[];
  /** Picked keys, in the order they go to Higgsfield. */
  picked: string[];
  onChange: (keys: string[]) => void;
  /** Uploads one image; the parent adds it and picks it. Throws with a message on failure. */
  onUpload?: (file: File) => Promise<void>;
  max?: number;
}) {
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const full = picked.length >= max;

  function toggle(key: string) {
    if (picked.includes(key)) return onChange(picked.filter((k) => k !== key));
    if (!full) onChange([...picked, key]);
  }

  async function upload(file: File) {
    if (!onUpload) return;
    setUploading(true);
    setError(null);
    try {
      await onUpload(file);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't upload the image. Try again.");
    }
    setUploading(false);
  }

  const chosen = picked.map((k) => tiles.find((t) => t.key === k)).filter((t): t is ImageTile => Boolean(t));
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
          className="inline-flex h-8 items-center gap-1.5 rounded-control border border-hairline bg-raised px-2.5 text-xs font-medium text-ink transition-colors hover:bg-hover">
          <IconChevronDown className={cx("size-3.5 transition", !open && "-rotate-90")} />
          {open ? "Hide images" : tiles.length ? `Show ${tiles.length} image${tiles.length === 1 ? "" : "s"}` : "Add images"}
          {picked.length > 0 && <span className="rounded-full bg-accent-soft px-1.5 text-xs text-accent tabular-nums">{picked.length} picked</span>}
        </button>
        {!open && chosen.map((t, i) => (
          <button key={t.key} type="button" onClick={() => setOpen(true)} title={`${i + 1}. ${t.label}`} className="relative size-8 overflow-hidden rounded-md border border-accent">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={thumbUrl(t.url, 64, 64)} alt="" className="size-full object-cover" onError={(e) => showOriginal(e.currentTarget)} />
          </button>
        ))}
      </div>
      {open && (<>
      <ul className="flex flex-wrap gap-2">
        {tiles.map((t) => {
          const n = picked.indexOf(t.key) + 1;
          const off = full && !n;
          return (
            <li key={t.key} className="grid w-[72px] gap-1">
              <button
                type="button" onClick={() => toggle(t.key)} aria-pressed={n > 0} aria-disabled={off || undefined}
                aria-label={`${n ? `Unpick (${n} of ${max})` : "Pick"} ${t.label}${t.suggested ? ", suggested" : ""}`}
                title={[t.label, t.why, off ? `Up to ${max}: unpick one to choose this` : null].filter(Boolean).join(" · ")}
                className={cx(
                  "relative size-[72px] overflow-hidden rounded-inner border bg-canvas transition",
                  n ? "border-accent ring-2 ring-accent" : "border-line hover:border-ink/30",
                  off && "cursor-not-allowed opacity-45 hover:border-line",
                )}
              >
                {/* A 160 px copy, not the original: a workspace can have 100+ images of up to ~26 megapixels each. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={thumbUrl(t.url, 160, 160)} alt="" width={72} height={72} loading="lazy" decoding="async" onError={(e) => showOriginal(e.currentTarget)} className="size-full object-cover" />
                {n > 0 && <span className="absolute top-1 left-1 grid size-5 place-items-center rounded-full bg-accent text-xs font-medium text-on-ink tabular-nums">{n}</span>}
                {t.suggested && <span className="absolute inset-x-1 bottom-1 truncate rounded-full bg-card/90 px-1 text-center text-xs leading-4 font-medium text-accent">Suggested</span>}
              </button>
              <span className="truncate text-xs leading-tight text-muted" title={t.label}>{t.kindLabel}</span>
            </li>
          );
        })}
        {onUpload && (
          <li className="grid w-[72px] gap-1">
            <button
              type="button" onClick={() => input.current?.click()} disabled={uploading}
              className="grid size-[72px] place-items-center rounded-inner border border-dashed border-line px-1 text-center text-xs leading-tight text-muted transition hover:border-ink/30 hover:text-ink disabled:cursor-wait"
            >
              {uploading ? <Spinner /> : <span className="grid justify-items-center gap-1"><IconPlus className="size-4" />Upload an image</span>}
            </button>
            <input ref={input} type="file" accept={ASSET_IMAGE_TYPES.join(",")} className="hidden" onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) upload(file);
            }} />
          </li>
        )}
      </ul>
      </>)}
      {error && <p className="text-xs text-warn">{error}</p>}
      <p className="text-xs text-muted">
        {tiles.length
          ? <>{picked.length ? `${picked.length} of ${max} picked, sent in this order.` : `Pick up to ${max}; none are picked for you.`}{full ? " Unpick one to choose another." : ""} </>
          : "No product images yet. "}
        <Link href={productId ? `/app/w/${productId}/brand?tab=assets` : "/app/w"} className="text-accent hover:underline">{tiles.length ? "Add or sort images on the Assets tab" : "Add product images on the Assets tab"}</Link>
      </p>
    </div>
  );
}
