"use client";
// "Start from a Playground template": this product's ready templates, each a link that opens it on the
// Playground (?template=<id>), where template remakes are made with their own form. What they make is
// reviewed in the Studio's creatives with the rest. Starters (the built-in formats) are added there too.
import { useCached } from "@/lib/client-cache";
import { adStyleById } from "@/lib/ad-styles";
import type { ProductTemplate } from "@/lib/playground-templates";
import { workspaceHref } from "@/lib/workspace-schema";
import Link from "next/link";
import { ButtonLink, Thumb } from "../ui";

const imageOf = (t: ProductTemplate) => t.thumbUrl ?? t.templateUrl ?? (t.starterId ? adStyleById(t.starterId)?.thumbImage : null) ?? null;

export function TemplateStart({ productId }: { productId: string }) {
  const [listing] = useCached<{ templates?: ProductTemplate[]; error?: string }>(`/api/playground/${productId}/templates`);
  const ready = (listing?.templates ?? []).filter((t) => t.status === "ready");
  const playground = workspaceHref(productId, "playground");
  return (
    <div className="grid gap-3">
      <p className="text-xs text-muted">A template keeps a proven ad&apos;s layout and swaps in your words and images. Templates open on the Playground, which has its own short form; what they make shows up in the creatives below for review.</p>
      {listing?.error ? <p className="text-sm text-warn">{listing.error}</p> : !listing ? (
        <div className="grid grid-cols-3 gap-2 @2xl:grid-cols-6">{[0, 1, 2].map((i) => <span key={i} className="skeleton aspect-[4/5] w-full" />)}</div>
      ) : ready.length ? (
        <ul className="grid grid-cols-3 gap-2 @2xl:grid-cols-6">
          {ready.map((t) => (
            <li key={t.id}>
              <Link href={`${playground}?template=${t.id}`} className="group grid gap-1 text-xs">
                <Thumb src={imageOf(t)} alt="" className="aspect-[4/5] w-full rounded-inner border border-line transition group-hover:border-ink/40" />
                <span className="line-clamp-2 text-muted group-hover:text-ink">{t.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-muted">No ready templates for this product yet.</p>}
      <div className="flex flex-wrap gap-2">
        <ButtonLink size="sm" variant="secondary" href={`${playground}?tab=library`}>{ready.length ? "All templates and starters" : "Add a starter or upload an ad"}</ButtonLink>
        <ButtonLink size="sm" variant="ghost" href={playground}>Open the Playground</ButtonLink>
      </div>
    </div>
  );
}
