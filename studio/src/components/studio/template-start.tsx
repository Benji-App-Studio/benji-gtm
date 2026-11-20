"use client";
// "Start from a template": this app's ready templates, each a link that opens it on Studio › Templates
// (?template=<id>), where template remakes are made with their own form. What they make is
// reviewed in the Studio's creatives with the rest. Starters (the built-in formats) are added there too.
import { useCached } from "@/lib/client-cache";
import { adStyleById } from "@/lib/ad-styles";
import type { ProductTemplate } from "@/lib/playground-templates";
import { studioHref } from "@/lib/nav-model";
import { useT } from "@/lib/i18n/client";
import Link from "next/link";
import { ButtonLink, Thumb } from "../ui";

const imageOf = (t: ProductTemplate) => t.thumbUrl ?? t.templateUrl ?? (t.starterId ? adStyleById(t.starterId)?.thumbImage : null) ?? null;

export function TemplateStart({ productId }: { productId: string }) {
  const [listing] = useCached<{ templates?: ProductTemplate[]; error?: string }>(`/api/playground/${productId}/templates`);
  const ready = (listing?.templates ?? []).filter((t) => t.status === "ready");
  const { t: tr } = useT();
  const templates = studioHref(productId, "templates");
  return (
    <div className="grid gap-3">
      <p className="text-xs text-muted">{tr("A template keeps a proven ad's layout and swaps in your words and images. Templates open on their own tab with a short form; what they make shows up in the creatives below for review.")}</p>
      {listing?.error ? <p className="text-sm text-warn">{listing.error}</p> : !listing ? (
        <div className="grid grid-cols-3 gap-2 @2xl:grid-cols-6 @4xl:grid-cols-8">{[0, 1, 2].map((i) => <span key={i} className="skeleton aspect-[4/5] w-full" />)}</div>
      ) : ready.length ? (
        <ul className="grid grid-cols-3 gap-2 @2xl:grid-cols-6 @4xl:grid-cols-8">
          {ready.map((t) => (
            <li key={t.id}>
              <Link href={`${templates}?template=${t.id}`} className="group grid gap-1 text-xs">
                <Thumb src={imageOf(t)} alt="" className="aspect-[4/5] w-full rounded-small border border-line transition group-hover:border-ink/40" />
                <span className="line-clamp-2 text-muted group-hover:text-ink">{t.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-muted">{tr("No ready templates for this product yet.")}</p>}
      <div className="flex flex-wrap gap-2">
        <ButtonLink size="sm" variant="secondary" href={templates}>{ready.length ? tr("All templates and starters") : tr("Add a starter or upload an ad")}</ButtonLink>
        <ButtonLink size="sm" variant="ghost" href={studioHref(productId, "remix")}>{tr("Remix an ad instead")}</ButtonLink>
      </div>
    </div>
  );
}
