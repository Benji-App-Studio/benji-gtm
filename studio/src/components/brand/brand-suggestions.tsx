"use client";
// What the AI product profile suggests for the brand (lib/brand.ts brandSuggestions), one row each with
// "Use this". The Brand tab applies a suggestion to its draft; the Product tab saves it straight away.
import type { ReactNode } from "react";
import type { BrandSuggestion } from "@/lib/brand";
import { IconSparkles } from "../icons";
import { Button, Spinner, TintIcon } from "../ui";

function Value({ s }: { s: BrandSuggestion }) {
  if (s.key === "colors") {
    return (
      <span className="flex flex-wrap gap-1.5">
        {s.value.map((c) => (
          <span key={c.hex} className="flex items-center gap-1.5 rounded-full border border-line bg-card py-0.5 pr-2 pl-0.5 text-xs">
            <span className="size-4 rounded-full border border-ink/10" style={{ background: c.hex }} />
            <span className="font-mono">{c.hex}</span>{c.name && <span className="text-muted">{c.name}</span>}
          </span>
        ))}
      </span>
    );
  }
  if (s.key === "icon") return <span className="truncate font-mono text-xs text-muted">{s.value}</span>;
  if (s.key === "screenshots") return <span className="text-xs text-muted">{s.value.length} screenshot{s.value.length === 1 ? "" : "s"} from the store listing</span>;
  if (s.key === "claims") return <span className="text-xs">{s.value.join(" · ")}</span>;
  return <span className="text-xs [overflow-wrap:anywhere]">{s.value}</span>;
}

/** `busy` is the key being applied (the Product page saves each one). */
export function BrandSuggestions({ suggestions, onUse, busy, note }: { suggestions: BrandSuggestion[]; onUse: (s: BrandSuggestion) => void; busy?: string | null; note?: ReactNode }) {
  if (!suggestions.length) return null;
  return (
    <div className="grid gap-2 rounded-card border border-line bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <TintIcon tone="accent" size="sm"><IconSparkles /></TintIcon>
        <p className="text-sm font-medium">Suggested by the AI profile</p>
        {note && <span className="text-xs text-muted">{note}</span>}
      </div>
      <ul className="grid">
        {suggestions.map((s) => (
          <li key={s.key} className="-mx-1 flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 rounded-control px-1 py-1.5 transition-colors hover:bg-hover">
            <span className="w-36 shrink-0 text-xs text-muted">{s.label}</span>
            <span className="min-w-0 flex-1"><Value s={s} /></span>
            <Button size="sm" variant="secondary" onClick={() => onUse(s)} disabled={Boolean(busy)}>{busy === s.key && <Spinner />}Use this</Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
