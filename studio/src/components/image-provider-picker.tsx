"use client";
// "GPT Image 2.5 · via Higgsfield | via OpenAI": who makes this generation's images, the same model
// either way. Picking one also remembers it for the product (products.image_provider), so the next
// generation starts from it; each generation can still pick the other.
//
// Only a provider that has a key is offered. With one key the picker names that provider and says how
// to add the other; with none it says what to connect. While the install isn't known, both are offered.
//
// Via OpenAI, a quality that this install's Supabase plan can't finish in one run gets a short note
// (`plan`, from the creatives backend's health answer): it is collected later, in the background, or it
// can't run on this plan at all. An older backend sends no plan, and then nothing is said.
import { useEffect } from "react";
import { featureState } from "@/lib/capabilities";
import { fmtUsd, IMAGE_PROVIDERS, OPENAI_IMAGE_PRICING, openAiQualityNote, PROVIDER_NAME, type ImageProvider, type OpenAiImagePlan } from "@/lib/image-provider";
import { useInstall } from "@/lib/install/use-install";
import { availableProvider, FeatureLock, imageProvidersOf, KEYS_HREF } from "./studio/features";
import { cx, Locked, Segmented } from "./ui";

/** Remembers the product's choice; a failure only means it isn't remembered. */
export function rememberImageProvider(productId: string, provider: ImageProvider) {
  fetch(`/api/products/${productId}/image-provider`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider }) }).catch(() => {});
}

export function ImageProviderPicker({ value, onChange, productId, openaiReady, plan, quality, resolution, className, compact = false }: {
  value: ImageProvider;
  onChange: (provider: ImageProvider) => void;
  /** When given, the pick is remembered for this product. */
  productId?: string;
  /** For an install whose keys can't be read: false when the creatives backend says OpenAI has no key. */
  openaiReady?: boolean | null;
  /** What the Supabase plan does with each OpenAI quality, with the quality and resolution this generation uses. */
  plan?: OpenAiImagePlan | null;
  quality?: string;
  resolution?: string;
  className?: string;
  compact?: boolean;
}) {
  const { install } = useInstall();
  const providers = imageProvidersOf(install);
  const usable = IMAGE_PROVIDERS.filter((p) => !providers || providers[p]);
  // A choice that has no key moves to the one that has (not remembered: the person didn't pick it).
  const fallback = availableProvider(value, providers);
  useEffect(() => { if (fallback !== value) onChange(fallback); }, [fallback, value, onChange]);

  const pick = (next: ImageProvider) => {
    if (next === value) return;
    onChange(next);
    if (productId) rememberImageProvider(productId, next);
  };
  const label = <span className="text-xs font-medium text-muted">{compact ? "Made via" : "GPT Image 2.5 via"}</span>;
  // Only an OpenAI job is run inside the project's own time limit; Higgsfield's are collected either way.
  const slow = fallback === "openai" && quality && resolution ? openAiQualityNote(plan, resolution, quality) : null;
  const slowNote = slow ? <p role="status" className={cx("text-xs", slow.mode === "refuse" ? "text-warn" : "text-caution-ink", !compact && "text-right")}>{slow.text}</p> : null;

  if (providers && usable.length === 0) return <FeatureLock state={featureState("studio.images", install)} className={className} />;
  if (usable.length === 1) {
    const other = IMAGE_PROVIDERS.find((p) => p !== usable[0])!;
    return (
      <div className={cx("grid gap-1.5", className)}>
        <div className="flex flex-wrap items-center justify-between gap-2">{label}<span className="text-xs font-medium text-ink">{PROVIDER_NAME[usable[0]]}</span></div>
        <Locked href={KEYS_HREF} action="Add the key">{PROVIDER_NAME[other]} can make them too</Locked>
        {slowNote}
      </div>
    );
  }
  return (
    <div className={cx("grid gap-1", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {label}
        <Segmented label="Who makes the images" value={value} onChange={pick}
          options={IMAGE_PROVIDERS.map((p) => ({ value: p, label: PROVIDER_NAME[p] }))} />
      </div>
      {value === "openai" && (
        <p className="text-right text-xs text-faint">
          {!providers && openaiReady === false ? <span className="text-caution-ink">OpenAI has no key yet: add one in Settings &gt; API keys. </span> : null}
          Billed by OpenAI in dollars, not Higgsfield credits (prices checked {OPENAI_IMAGE_PRICING.checked}).
        </p>
      )}
      {slowNote}
    </div>
  );
}

/** The cost line for a confirm dialog: credits or dollars, as the provider charges. */
export const providerCostRow = (provider: ImageProvider, cost: { credits: number; usd?: number }): [string, React.ReactNode] => (provider === "openai"
  ? ["Estimated OpenAI cost", <span key="c" className="text-sm font-medium text-ink">≈ {fmtUsd(cost.usd ?? 0)}</span>]
  : ["Estimated Higgsfield cost", <span key="c" className="text-sm font-medium text-ink">{cost.credits % 1 === 0 ? cost.credits : cost.credits.toFixed(2)} credits</span>]);
