// Pieces the Product page and the AI product profile share: the profile's fields with their real labels
// (the form's question labels and option labels instead of keys and values), an even grid for them,
// chip rows, and social handles as linked chips.
import type { ReactNode } from "react";
import type { ProductKind } from "@/lib/db";
import { ALL_QUESTIONS, KIND_QUESTIONS, PRICES, SALES, type Question } from "@/lib/product-questions";
import { PLATFORMS, type Platform } from "@/lib/types";
import { cx, PlatformBadge } from "../ui";

export type Fact = { label: string; value: string };

/** A question's label as a field label: "Who buys it?" → "Who buys it". */
const asLabel = (label: string) => label.replace(/\?\s*$/, "");
const humanize = (key: string) => {
  const words = key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** The question behind an answer key: the kind's own wording first, then any kind's. */
function questionFor(kind: ProductKind | null | undefined, key: string): Question | undefined {
  return (kind ? KIND_QUESTIONS[kind]?.find((q) => q.key === key) : undefined) ?? ALL_QUESTIONS.find((q) => q.key === key);
}

const option = (options: { value: string; label: string }[], value: string) => options.find((o) => o.value === value)?.label;

export const priceLabel = (value: string | null | undefined) => (value ? option(PRICES, value) ?? humanize(value) : "");
export const salesLabel = (value: string | null | undefined) => (value && value !== "unknown" ? option(SALES, value) ?? humanize(value) : "");

/** Every non-empty answer, labelled, in the order the form asks them (the kind's questions, others, then "What makes it different"). */
export function answerFacts(kind: ProductKind | null | undefined, answers: Record<string, string> | null | undefined): Fact[] {
  const entries = Object.entries(answers ?? {}).filter(([, v]) => typeof v === "string" && v.trim());
  const order = [...(kind ? KIND_QUESTIONS[kind] ?? [] : []), ...ALL_QUESTIONS].map((q) => q.key);
  const rank = (key: string) => (key === "differentiator" ? 1e4 : order.includes(key) ? order.indexOf(key) : 1e3);
  return entries
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([key, value]) => {
      const q = questionFor(kind, key);
      const shown = q?.options ? option(q.options, value) ?? value.replace(/_/g, " ") : value.trim();
      return { label: q ? asLabel(q.label) : humanize(key), value: shown };
    });
}

/** The product's profile fields, labelled, empty ones left out. */
export function profileFacts(p: {
  kind?: ProductKind | null; audience?: string | null; price_tier?: string | null; sales_channel?: string | null; region?: string | null; answers?: Record<string, string> | null;
}): Fact[] {
  const core: Fact[] = [
    { label: "Who it's for", value: p.audience?.trim() ?? "" },
    { label: "Price point", value: priceLabel(p.price_tier) },
    { label: "Where people buy", value: salesLabel(p.sales_channel) },
    { label: "Market", value: p.region?.trim() ?? "" },
  ];
  return [...core, ...answerFacts(p.kind, p.answers)].filter((f) => f.value);
}

/** Values longer than this take a whole row, so one long answer doesn't stretch its neighbours. */
const LONG = 60;

/** Labelled fields in an even grid: short ones side by side, long ones full width underneath. */
export function FactGrid({ facts, className }: { facts: Fact[]; className?: string }) {
  if (!facts.length) return null;
  const short = facts.filter((f) => f.value.length <= LONG);
  const long = facts.filter((f) => f.value.length > LONG);
  return (
    <dl className={cx("grid gap-x-6 gap-y-3.5 @xl:grid-cols-2 @3xl:grid-cols-3", className)}>
      {[...short, ...long].map((f, i) => (
        <div key={`${i}-${f.label}`} className={cx("min-w-0 border-t border-line pt-2.5", f.value.length > LONG && "@xl:col-span-full")}>
          <dt className="eyebrow">{f.label}</dt>
          <dd className="mt-0.5 text-sm [overflow-wrap:anywhere]">{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A label and its value side by side on wide screens, stacked on narrow ones (chip rows). */
export function LabelledRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-1.5 @xl:grid-cols-[164px_minmax(0,1fr)] @xl:gap-4">
      <dt className="eyebrow @xl:pt-[5px]">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

export const chipClass = "inline-flex max-w-full items-center rounded-full bg-control px-2.5 py-1 text-xs leading-4 [overflow-wrap:anywhere]";

export function Chips({ items, className }: { items: string[]; className?: string }) {
  return <div className={cx("flex flex-wrap gap-1.5", className)}>{items.map((x) => <span key={x} className={chipClass}>{x}</span>)}</div>;
}

type SocialKey = Platform | "facebook";
const SOCIAL_KEYS: SocialKey[] = [...PLATFORMS, "facebook"];
const PROFILE_URL: Record<SocialKey, (h: string) => string> = {
  instagram: (h) => `https://instagram.com/${h}`,
  tiktok: (h) => `https://www.tiktok.com/@${h}`,
  youtube: (h) => `https://www.youtube.com/@${h}`,
  x: (h) => `https://x.com/${h}`,
  linkedin: (h) => `https://www.linkedin.com/company/${h}`,
  facebook: (h) => `https://facebook.com/${h}`,
};

/** The handles in a socials object, in platform order (website and empty ones left out). */
export function socialEntries(socials: Partial<Record<string, string | null | undefined>> | null | undefined) {
  return SOCIAL_KEYS.flatMap((key) => {
    const raw = socials?.[key]?.trim();
    return raw ? [{ key, raw }] : [];
  });
}

/** Social handles as chips: the platform badge and the handle, linked to the profile. */
export function SocialChips({ socials, className }: { socials: Partial<Record<string, string | null | undefined>> | null | undefined; className?: string }) {
  const list = socialEntries(socials);
  if (!list.length) return null;
  return (
    <div className={cx("flex flex-wrap gap-1.5", className)}>
      {list.map(({ key, raw }) => {
        const isUrl = /^https?:\/\//i.test(raw);
        const handle = raw.replace(/^@/, "");
        const href = isUrl ? raw : PROFILE_URL[key](encodeURIComponent(handle));
        return (
          <a key={key} href={href} target="_blank" rel="noopener noreferrer"
            className="inline-flex h-7 max-w-full min-w-0 items-center gap-2 rounded-full border border-line bg-raised pr-2.5 pl-2 transition hover:border-ink/20">
            {key === "facebook"
              ? <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink"><span className="size-2.5 rounded-full bg-accent" />Facebook</span>
              : <PlatformBadge platform={key} />}
            <span className="min-w-0 truncate font-mono text-xs text-muted">{isUrl ? raw.replace(/^https?:\/\/(www\.)?/i, "") : `@${handle}`}</span>
          </a>
        );
      })}
    </div>
  );
}
