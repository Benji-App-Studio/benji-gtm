"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { revalidate } from "@/lib/client-cache";
import { KIND_LABEL, type ProductRow } from "@/lib/db";
import { useT } from "@/lib/i18n/client";
import { sentenceGap } from "@/lib/i18n/join";
import { m } from "@/lib/i18n/translate";
import { PLATFORMS, type Platform } from "@/lib/types";
import { PartnersSwitch } from "./direct-forms";
import { CompetitorFormSkeleton } from "./page-skeletons";
import { Badge, Button, ButtonLink, Card, cx, EmptyState, PlatformBadge, Segmented, Spinner } from "./ui";
import { appSettingsHref } from "@/lib/nav-model";

const TIMEFRAMES = [30, 60, 90, 180];
const DEPTHS = [{ value: 10, label: m("Quick") }, { value: 20, label: m("Standard") }, { value: 40, label: m("Deep") }];

/** A competitor analysis for one of the user's products, starting from its saved profile. `productId` picks that app first. */
export function CompetitorForm({ onBack, productId: initial }: { onBack: () => void; productId?: string | null }) {
  const { t, tn, locale } = useT();
  const router = useRouter();
  const [products, setProducts] = useState<ProductRow[] | null>(null);
  const [productId, setProductId] = useState("");
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [sinceDays, setSinceDays] = useState(30);
  const [depth, setDepth] = useState(20);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [includeNiche, setIncludeNiche] = useState(true);
  const [readComments, setReadComments] = useState(true);
  const [partners, setPartners] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);

  const choose = (product: ProductRow) => {
    setProductId(product.id);
    const scores = product.platform_scores;
    setPlatforms(scores ? PLATFORMS.filter((p) => (scores[p] ?? 0) >= 2) : ["instagram", "tiktok"]);
    setKeywords(product.keywords.slice(0, 6));
  };
  useEffect(() => {
    // The shared list (lib/client-cache.ts): no second request when a page just loaded it.
    revalidate<ProductRow[]>("/api/products", 30_000).then((list) => {
      setProducts(Array.isArray(list) ? list : []);
      const first = Array.isArray(list) ? list.find((p) => p.id === initial) ?? list[0] : undefined;
      if (first) choose(first);
    }).catch(() => { setProducts([]); setLoadFailed(true); });
  }, [initial]);
  const product = products?.find((p) => p.id === productId);

  function addKeyword(value: string) {
    const clean = value.trim();
    if (clean && !keywords.includes(clean) && keywords.length < 8) setKeywords([...keywords, clean]);
    setDraft("");
  }

  async function submit() {
    setBusy(true); setError("");
    // A dropped connection or an answer that isn't JSON must not leave the button spinning.
    const response = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "competitors", productId, platforms, sinceDays, limitPerAccount: depth, keywords, includeNiche, readComments, partners }) }).catch(() => null);
    const data = await response?.json().catch(() => null);
    setBusy(false);
    if (!response?.ok || !data?.id) return setError(data?.error ?? t("Couldn't reach the server. Check your connection and try again."));
    router.push(`/app/p/${data.id}`);
  }

  if (!products) return <CompetitorFormSkeleton />;
  if (loadFailed) return <EmptyState title={t("Couldn't load your apps")} body={t("The server didn't answer. Check your connection and reload the page.")} />;
  if (!products.length) return <EmptyState title={t("Add your app first")} body={t("A competitor search starts from your app's profile: what it is and who it's for.")} action={<ButtonLink href="/app/product/new">{t("Add an app")}</ButtonLink>} />;

  return (
    <Card className="p-4">
      <p className="text-sm text-muted">{t("The AI names the brands you're up against with their social accounts, checks each one against your app, and you pick who to study.")}</p>

      <div className="mt-5">
        <p className="mb-2 text-sm font-medium">{t("App")}</p>
        <div className="grid gap-2 @xl:grid-cols-2">
          {products.map((p) => (
            <button key={p.id} type="button" onClick={() => choose(p)} className={cx("rounded-control border px-4 py-3 text-left transition", p.id === productId ? "border-accent/60 bg-accent-soft" : "border-line bg-card hover:bg-hover")}>
              <span className="block font-medium">{p.name}</span>
              <span className="text-xs text-muted">{KIND_LABEL[p.kind] ? t(KIND_LABEL[p.kind]) : p.kind}</span>
            </button>
          ))}
        </div>
        {product && <p className="mt-2 text-xs text-muted">{product.description} <Link href={appSettingsHref(product.id)} className="text-accent hover:underline">{t("Edit")}</Link></p>}
      </div>

      <div className="mt-6">
        <p className="mb-2 text-sm font-medium">{t("Channels")}</p>
        <div className="grid gap-2 @xl:grid-cols-2">
          {PLATFORMS.map((p) => {
            const on = platforms.includes(p);
            const importance = product?.platform_scores?.[p] ?? 0;
            return (
              <button key={p} type="button" onClick={() => setPlatforms(on ? platforms.filter((x) => x !== p) : [...platforms, p])}
                className={cx("flex items-center justify-between rounded-control border px-4 py-3 text-left transition", on ? "border-accent/60 bg-accent-soft" : "border-line bg-card hover:bg-hover")}>
                <span className="flex items-center gap-3"><span className={cx("grid size-4 shrink-0 place-items-center rounded-sm border transition", on ? "border-primary bg-primary text-on-ink" : "border-line bg-raised")}>{on && <svg viewBox="0 0 10 10" className="size-2.5" aria-hidden><path d="M1.5 5.2 4 7.6 8.6 2.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>}</span><PlatformBadge platform={p} showBeta /></span>
                <span className="flex gap-0.5" title={t("How much this channel likely matters for your product")}>{[0, 1, 2, 3].map((i) => <span key={i} className={cx("h-3 w-1", importance > i + 0.5 ? "bg-accent" : "bg-ink/10")} />)}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-5 grid gap-4 @xl:grid-cols-2">
        <div>
          <p className="mb-2 text-sm font-medium">{t("Time frame")}</p>
          <Segmented label={t("Time frame")} value={String(sinceDays)} onChange={(v) => setSinceDays(Number(v))} options={TIMEFRAMES.map((d) => ({ value: String(d), label: tn(d, "{n} day", "{n} days") }))} />
        </div>
        <div>
          <p className="mb-2 text-sm font-medium">{t("Depth")}</p>
          <Segmented label={t("Depth")} value={String(depth)} onChange={(v) => setDepth(Number(v))} options={DEPTHS.map((d) => ({ value: String(d.value), label: t(d.label) }))} />
          <p className="mt-1 text-xs text-muted">{t("{n} recent posts per competitor per channel", { n: depth })}</p>
        </div>
      </div>

      <div className="mt-6">
        <p className="mb-2 text-sm font-medium">{t("Niche search terms")}</p>
        <div className="flex flex-wrap gap-2">
          {keywords.map((k) => <span key={k} className="inline-flex h-6 items-center gap-1.5 rounded-full border border-hairline bg-control px-2.5 text-xs text-ink">{k}<button type="button" onClick={() => setKeywords(keywords.filter((x) => x !== k))} className="text-on-ink/60 hover:text-on-ink" aria-label={t("Remove {name}", { name: k })}>×</button></span>)}
          <input aria-label={t("Add a niche search term")} className="min-w-40 flex-1 rounded-control border border-line bg-raised px-3 py-1.5 text-xs outline-none focus:border-ink/25" placeholder={keywords.length >= 8 ? t("8 terms max") : t("Add a term and press Enter")}
            value={draft} disabled={keywords.length >= 8} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addKeyword(draft); } }} />
        </div>
        <label className="mt-3 flex items-start gap-2 text-sm">
          <input type="checkbox" checked={includeNiche} onChange={(e) => setIncludeNiche(e.target.checked)} className="mt-0.5 size-4 accent-accent" />
          <span>{t("Also analyze the best content in your niche.")} <span className="text-muted">{t("The top posts around these terms from any creator, ranked by buyers in the comments, not just views. If no competitors turn up, this runs on its own.")}</span></span>
        </label>
      </div>

      <label className="mt-4 flex items-start gap-2 text-sm">
        <input type="checkbox" checked={readComments} onChange={(e) => setReadComments(e.target.checked)} className="mt-0.5 size-4 accent-accent" />
        <span>{t("Read more comments.")} <span className="text-muted">{t("Up to 25 comments on each channel's 20 most-viewed posts, to find buyers and what your audience asks for. Adds about $1–4 per run.")}</span></span>
      </label>

      <div className="mt-4">
        <PartnersSwitch checked={partners} onChange={setPartners}
          title={t("Map each competitor's creator program")}
          detail={t("Finds the creators posting for each competitor: collab posts, the paid-partnership label, posts tagging them, and bios that declare a tie (“athlete @brand”, a discount code). Shown in a Partners tab. Adds about $0.70 plus $0.07 per competitor.")} />
      </div>

      {/* The product's competitor list (kept in Research; known_competitors mirrors it): one line, and where to change it. */}
      {product && (
        <p className="mt-6 text-sm">
          {product.known_competitors.length
            ? <><Badge tone="highlight">{t("Included")}</Badge> <span className="text-muted">{t("Your competitor list: {names}.", { names: product.known_competitors.join(", ") })}</span></>
            : <span className="text-muted">{t("No competitor list yet: the analysis finds them.")}</span>}{sentenceGap(locale)}
          <Link href={`/app/w/${product.id}/research?competitors`} className="text-accent hover:underline">{t("Edit the list")}</Link>
        </p>
      )}
      {error && <p className="mt-4 text-sm text-warn">{error}</p>}
      <div className="mt-6 flex justify-between">
        <Button variant="ghost" onClick={onBack}>{t("Back")}</Button>
        <Button onClick={submit} disabled={busy || !productId || !platforms.length}>{busy ? <><Spinner /> {t("Starting…")}</> : t("Find my competitors")}</Button>
      </div>
    </Card>
  );
}
