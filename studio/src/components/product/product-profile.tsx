"use client";
// The Product tab of the Brand page: the product profile from onboarding (what it is, who it's for, its
// channels and competitors) with Edit, and the AI product profile under it (product-insight.tsx: the
// summary, audience and pains, value promised, proof, and its brand ideas as suggestions).
import Link from "next/link";
import { useCallback, useState } from "react";
import { refresh, useCached } from "@/lib/client-cache";
import { KIND_LABEL, STAGE_LABEL, type ProductRow } from "@/lib/db";
import { ProductInsightCard } from "../product-insight";
import { ProductForm } from "../product-form";
import { Badge, Button, Card } from "../ui";
import { Chips, FactGrid, LabelledRow, profileFacts, SocialChips, socialEntries } from "./fields";

export function ProductProfileTab({ product: p, onChanged }: { product: ProductRow; onChanged: (row: ProductRow) => void }) {
  const [editing, setEditing] = useState(false);
  // "main" only means something next to another app.
  const [apps] = useCached<ProductRow[]>("/api/products");
  const several = Array.isArray(apps) && apps.length > 1;
  /** A changed row: the tab, and the sidebar's product list (the name may have changed). */
  const changed = useCallback((row: ProductRow) => { onChanged(row); refresh("/api/products").catch(() => {}); }, [onChanged]);

  if (editing) {
    return (
      <div className="max-w-3xl">
        <button onClick={() => setEditing(false)} className="mb-3 text-caption text-muted hover:text-ink">‹ Back to the profile</button>
        <ProductForm product={p} onDone={async (row) => {
          setEditing(false);
          // Read the row again: saving new links starts the AI reader, and the card should show it running.
          const fresh = await fetch(`/api/products/${row.id}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null) as ProductRow | null;
          changed(fresh?.id ? fresh : row);
        }} />
      </div>
    );
  }

  const facts = profileFacts(p);
  const hasSocials = socialEntries(p.socials).length > 0;
  const site = p.website?.trim();
  return (
    <div className="grid max-w-4xl gap-3">
      <Card className="overflow-hidden p-0">
        <div className="grid gap-4 p-4">
          <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
            <div className="min-w-0 flex-1 basis-[240px]">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                <h2 className="text-title font-medium [overflow-wrap:anywhere]">{p.name}</h2>
                <span className="flex flex-wrap items-center gap-1.5">
                  {p.is_primary && several && <Badge tone="win">main</Badge>}
                  <Badge>{KIND_LABEL[p.kind]}</Badge>
                  {p.stage && <Badge tone="accent">{STAGE_LABEL[p.stage]}</Badge>}
                  {p.category_label && <Badge tone="highlight">{p.category_label}</Badge>}
                </span>
              </div>
              {site && (
                <a href={site.startsWith("http") ? site : `https://${site}`} target="_blank" rel="noopener noreferrer"
                  className="mt-1 block max-w-full truncate text-sm text-accent hover:underline">{site.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "")}</a>
              )}
            </div>
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>Edit</Button>
          </header>

          {p.description && <p className="text-sm leading-relaxed text-label [overflow-wrap:anywhere]">{p.description}</p>}

          <FactGrid facts={facts} />

          {(hasSocials || p.known_competitors.length > 0 || p.keywords.length > 0) && (
            <dl className="grid gap-3 border-t border-line pt-4">
              {hasSocials && <LabelledRow label="Socials"><SocialChips socials={p.socials} /></LabelledRow>}
              {p.known_competitors.length > 0 && <LabelledRow label="Competitors"><Chips items={p.known_competitors} /></LabelledRow>}
              {p.keywords.length > 0 && <LabelledRow label="Niche keywords"><Chips items={p.keywords} /></LabelledRow>}
            </dl>
          )}
        </div>
        <ProductInsightCard product={p} onEdit={() => setEditing(true)} onChanged={changed} />
      </Card>
      <p className="px-1 text-xs text-muted">Competitor searches and every prompt start from these details. Selling something else too? <Link href="/app/product/new" className="text-accent hover:underline">Add another app</Link></p>
    </div>
  );
}
