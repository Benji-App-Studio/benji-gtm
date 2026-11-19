"use client";
// Small pieces the "Send to Meta" sheet is built from: labelled fields, money inputs, the "More
// options" fold, error lists, Meta's targeting search and the placement picker.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { metaCall, type SearchHit } from "@/lib/launch/send";
import { type MetaObjective, PLATFORM_LABEL, PLATFORMS, type PlacementRule, POSITION_LABEL, POSITIONS } from "@/lib/launch/rules";
import { IconChevronRight, IconSearch, IconX } from "../icons";
import { cx, inputClass, Spinner } from "../ui";

/** A label, the control, and a one-line explanation under it. */
export function Labeled({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx("grid min-w-0 content-start gap-1.5", className)}>
      <span className="text-sm font-medium text-ink">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

/** A group of fields with a heading. */
export function Group({ title, hint, children, className }: { title: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("grid min-w-0 gap-3 border-t border-line pt-4 first:border-t-0 first:pt-0", className)}>
      <div>
        <h3 className="text-sm font-medium">{title}</h3>
        {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

/** An amount in the account currency (major units). Empty means "not set". */
export function MoneyInput({ value, onChange, currency, placeholder, label }: { value: number | null | undefined; onChange: (v: number | null) => void; currency: string; placeholder?: string; label?: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <input type="number" inputMode="decimal" min={0} step="0.01" aria-label={label} className={inputClass} placeholder={placeholder}
        value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} />
      <span className="shrink-0 text-xs text-muted">{currency}</span>
    </div>
  );
}

/** Advanced fields, folded away so the common path stays short. */
export function MoreOptions({ children, label = "More options", defaultOpen = false }: { children: ReactNode; label?: string; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="group rounded-inner border border-line bg-canvas/40 px-3 py-2">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm font-medium text-label hover:text-ink">
        <IconChevronRight className="size-3.5 transition-transform group-open:rotate-90" />{label}
      </summary>
      <div className="mt-3 grid gap-4 pb-1">{children}</div>
    </details>
  );
}

/** What has to be fixed before the next step, in the app's error style. */
export function Problems({ list, title = "Fix these first" }: { list: string[]; title?: string }) {
  if (!list.length) return null;
  return (
    <div role="alert" className="rounded-inner border border-warn/30 bg-warn-soft/40 p-3 text-sm">
      <p className="font-medium text-warn">{title}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-ink">{list.map((m) => <li key={m}>{m}</li>)}</ul>
    </div>
  );
}

/** A note from the playbook (never blocks). */
export function Hint({ children }: { children: ReactNode }) {
  return <p className="rounded-inner bg-caution-soft px-3 py-2 text-xs text-caution-ink">{children}</p>;
}

/** Removable chips. */
export function Chips<T>({ items, label, onRemove }: { items: T[]; label: (item: T) => ReactNode; onRemove: (index: number) => void }) {
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item, i) => (
        <span key={i} className="inline-flex max-w-full items-center gap-1 rounded-full bg-control py-0.5 pr-1 pl-2.5 text-xs text-ink">
          <span className="truncate">{label(item)}</span>
          <button type="button" onClick={() => onRemove(i)} aria-label="Remove" className="grid size-4 place-items-center rounded-full text-muted hover:bg-active hover:text-ink"><IconX className="size-3" /></button>
        </span>
      ))}
    </div>
  );
}

/** Meta's targeting search: type, then pick a result (interests can only come from here, with their real ids). */
export function SearchPicker({ productId, kind, placeholder, onPick, exclude = [] }: {
  productId: string; kind: "interest" | "geo" | "locale"; placeholder: string; onPick: (hit: SearchHit) => void; exclude?: string[];
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) return;
    const n = ++seq.current;
    const timer = setTimeout(() => {
      setBusy(true);
      metaCall<{ items: SearchHit[] }>(productId, "search", { kind, q: query })
        .then((r) => { if (n === seq.current) { setHits(r.items); setError(null); } })
        .catch((e) => { if (n === seq.current) setError(e instanceof Error ? e.message : String(e)); })
        .finally(() => { if (n === seq.current) setBusy(false); });
    }, 300);
    return () => clearTimeout(timer);
  }, [q, kind, productId]);

  const shown = q.trim().length >= 2 ? hits.filter((h) => !exclude.includes(h.id)) : [];
  return (
    <div className="relative min-w-0">
      <div className="relative">
        <IconSearch className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted" />
        <input className={cx(inputClass, "pl-8")} value={q} placeholder={placeholder} aria-label={placeholder} onChange={(e) => setQ(e.target.value)} />
        {busy && <Spinner className="absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-muted" />}
      </div>
      {error && <p className="mt-1 text-xs text-warn">{error}</p>}
      {shown.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-inner border border-line bg-raised py-1 shadow-pop">
          {shown.map((h) => (
            <li key={`${h.type ?? kind}-${h.id}`}>
              <button type="button" className="flex w-full items-baseline justify-between gap-3 px-3 py-1.5 text-left text-sm hover:bg-hover"
                onClick={() => { onPick(h); setQ(""); setHits([]); }}>
                <span className="min-w-0">
                  <span className="font-medium">{h.name}</span>
                  {h.detail && <span className="block truncate text-xs text-muted">{h.detail}</span>}
                </span>
                <span className="shrink-0 text-xs text-muted">{h.type ?? (h.size ? `${Intl.NumberFormat("en", { notation: "compact" }).format(h.size)}+ people` : "")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {q.trim().length >= 2 && !busy && !error && !shown.length && <p className="mt-1 text-xs text-muted">Nothing found for “{q.trim()}”.</p>}
    </div>
  );
}

/** Manual placements: platforms, and (optionally) the positions on each. Empty positions = all of that platform. */
export function PlacementPicker({ value, onChange, objective }: { value: PlacementRule; onChange: (rule: PlacementRule) => void; objective: MetaObjective }) {
  const platforms = PLATFORMS.filter((p) => !(objective === "OUTCOME_APP_PROMOTION" && p === "threads"));
  const togglePlatform = (p: (typeof PLATFORMS)[number]) => {
    const on = value.publisher_platforms.includes(p);
    const next: PlacementRule = { ...value, publisher_platforms: on ? value.publisher_platforms.filter((x) => x !== p) : [...value.publisher_platforms, p] };
    if (on) delete next[`${p}_positions`];
    onChange(next);
  };
  const togglePosition = (p: (typeof PLATFORMS)[number], pos: string) => {
    const current = value[`${p}_positions`] ?? [];
    const list = current.includes(pos) ? current.filter((x) => x !== pos) : [...current, pos];
    const next: PlacementRule = { ...value, [`${p}_positions`]: list };
    if (!list.length) delete next[`${p}_positions`];
    onChange(next);
  };
  return (
    <div className="grid gap-2">
      {platforms.map((p) => {
        const on = value.publisher_platforms.includes(p);
        const positions = value[`${p}_positions`] ?? [];
        return (
          <div key={p} className="rounded-inner border border-line bg-raised p-2.5">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={on} onChange={() => togglePlatform(p)} className="accent-[var(--color-accent)]" />{PLATFORM_LABEL[p]}
              {on && <span className="text-xs font-normal text-muted">{positions.length ? `${positions.length} placement${positions.length === 1 ? "" : "s"}` : "all placements"}</span>}
            </label>
            {on && (
              <div className="mt-2 flex flex-wrap gap-1.5 pl-6">
                {POSITIONS[p].map((pos) => (
                  <button key={pos} type="button" onClick={() => togglePosition(p, pos)} aria-pressed={positions.includes(pos)}
                    className={cx("rounded-full border px-2 py-0.5 text-xs", positions.includes(pos) ? "border-transparent bg-primary text-on-ink" : "border-line text-muted hover:border-ink/30 hover:text-ink")}>
                    {POSITION_LABEL[pos] ?? pos}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <p className="text-xs text-muted">Pick no placements on a platform to use all of them.</p>
    </div>
  );
}

/** A plain radio list with a hint per option. */
export function Choice<T extends string>({ value, onChange, options, name }: { value: T | null; onChange: (v: T) => void; options: { value: T; label: ReactNode; hint?: ReactNode; disabled?: boolean }[]; name: string }) {
  return (
    <div role="radiogroup" className="grid gap-1.5">
      {options.map((o) => (
        <label key={o.value} className={cx("flex cursor-pointer gap-2.5 rounded-inner border px-3 py-2 text-sm", value === o.value ? "border-ink/40 bg-raised" : "border-line hover:border-ink/20", o.disabled && "pointer-events-none opacity-50")}>
          <input type="radio" name={name} checked={value === o.value} disabled={o.disabled} onChange={() => onChange(o.value)} className="mt-0.5 accent-[var(--color-accent)]" />
          <span className="min-w-0">
            <span className="font-medium">{o.label}</span>
            {o.hint && <span className="block text-xs text-muted">{o.hint}</span>}
          </span>
        </label>
      ))}
    </div>
  );
}
