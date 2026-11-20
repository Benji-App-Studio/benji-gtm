"use client";
// The Assets tab: the real app (App Store link and screenshots, in the Brand page's draft and saved with
// its Save button) and the product's images (product/product-images.tsx, which saves each change on its
// own). The logo and fonts are on the Brand tab with the rest of the brand.
import { useRef, useState, type DragEvent } from "react";
import type { BrandBasics } from "@/lib/brand";
import { BRAND_LIMITS } from "@/lib/workspace-schema";
import { useT } from "@/lib/i18n/client";
import { ProductImages } from "../product/product-images";
import { Button, Card, cx, Field, inputClass, Spinner } from "../ui";
import { Block, IMAGE_TYPES, RemoveButton, uploadBrandImage } from "./brand-fields";

type Props = {
  productId: string;
  basics: BrandBasics;
  /** When the AI reader last finished: it collects images, so the images load again then. */
  insightAt?: string | null;
  onChange: (patch: Partial<BrandBasics>) => void;
  onError: (text: string) => void;
};

export function BrandAssetsTab({ productId, basics, insightAt, onChange, onError }: Props) {
  return (
    <div className="grid gap-3">
      <AppBlock productId={productId} basics={basics} onChange={onChange} onError={onError} />
      <Card className="overflow-hidden p-0 [&>section]:border-t-0">
        <ProductImages productId={productId} refreshKey={insightAt} />
      </Card>
    </div>
  );
}

/** Where people get the app and what it looks like: creatives show these screenshots instead of an invented UI. */
function AppBlock({ productId, basics, onChange, onError }: Omit<Props, "insightAt">) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const shots = basics.screenshotUrls;

  async function addShots(files: File[]) {
    const room = BRAND_LIMITS.screenshots - shots.length;
    if (!files.length) return;
    if (room <= 0) return onError(t("The brand holds {n} screenshots. Remove some first.", { n: BRAND_LIMITS.screenshots }));
    setBusy(true);
    try {
      const urls: string[] = [];
      for (const file of files.slice(0, room)) urls.push(await uploadBrandImage(productId, "screenshot", file, t));
      onChange({ screenshotUrls: [...shots, ...urls] });
    } catch (error) { onError(error instanceof Error ? error.message : String(error)); }
    setBusy(false);
  }
  const move = (from: number, to: number) => {
    const list = [...shots];
    list.splice(to, 0, ...list.splice(from, 1));
    onChange({ screenshotUrls: list });
  };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    void addShots(Array.from(event.dataTransfer.files).filter((f) => IMAGE_TYPES.includes(f.type)));
  };

  return (
    <Block title={t("The app")} hint={t("Where people get it, and the real screens: creatives show these instead of an invented UI.")} count={t("{n}/{max} screenshots", { n: shots.length, max: BRAND_LIMITS.screenshots })}>
      <Field label={t("App Store link")} hint={t("Studio imports the listing; Launch needs it for install ads.")}>
        <input className={inputClass} value={basics.appStoreUrl} inputMode="url" placeholder="https://apps.apple.com/app/id…" onChange={(e) => onChange({ appStoreUrl: e.target.value })} />
      </Field>
      <div onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}
        className={cx("grid gap-3 rounded-inner border border-dashed p-3 transition", dragging ? "border-ink bg-hover" : "border-line")}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm"><span className="font-medium">{t("Screenshots")}</span> <span className="text-xs text-muted">· {t("in the order to use them. Drop images here.")}</span></p>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => input.current?.click()}>{busy && <Spinner />}{t("Add screenshots")}</Button>
          <input ref={input} type="file" accept={IMAGE_TYPES.join(",")} multiple hidden onChange={(e) => { void addShots(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
        </div>
        {shots.length > 0 && (
          <ol className="grid grid-cols-3 gap-2 @xl:grid-cols-5 @3xl:grid-cols-6">
            {shots.map((url, i) => (
              <li key={url} className="grid gap-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt={t("Screenshot {n}", { n: i + 1 })} loading="lazy" className="aspect-[9/19.5] w-full rounded-small border border-line bg-raised object-cover" />
                <div className="flex items-center justify-between text-xs">
                  <span className="font-mono text-faint">{String(i + 1).padStart(2, "0")}</span>
                  <span className="flex">
                    <button type="button" aria-label={t("Move earlier")} disabled={i === 0} onClick={() => move(i, i - 1)} className="grid size-6 place-items-center rounded-control text-muted hover:bg-hover hover:text-ink disabled:opacity-30">←</button>
                    <button type="button" aria-label={t("Move later")} disabled={i === shots.length - 1} onClick={() => move(i, i + 1)} className="grid size-6 place-items-center rounded-control text-muted hover:bg-hover hover:text-ink disabled:opacity-30">→</button>
                    <RemoveButton label={t("Remove screenshot {n}", { n: i + 1 })} onClick={() => onChange({ screenshotUrls: shots.filter((u) => u !== url) })} />
                  </span>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </Block>
  );
}
