"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { KIND_LABEL, STAGE_LABEL, type ProductKind, type ProductRow, type Stage } from "@/lib/db";
import { KIND_QUESTIONS, PRICES, SALES } from "@/lib/product-questions";
import { APP_NAME } from "@/lib/brand-config";
import { PLATFORMS, type Platform } from "@/lib/types";
import { LockedNote, useLocked } from "./research/gates";
import { Badge, Button, Card, cx, Field, inputClass, PlatformBadge, Spinner } from "./ui";

const SOCIALS: (Platform | "facebook")[] = [...PLATFORMS, "facebook"];

interface Intake { category: string; categoryLabel: string; guesses: Record<string, string>; platformScores: Record<Platform, number>; keywords: { keyword: string; fit: number }[] }

type Draft = {
  kind: ProductKind | null; name: string; website: string; links: string; description: string; stage: Stage | null;
  audience: string; price_tier: string; sales_channel: string; region: string; answers: Record<string, string>;
  socials: Record<string, string>; known_competitors: string;
  category: string | null; category_label: string | null; platform_scores: Record<Platform, number> | null; keywords: string[];
};

const fromRow = (row?: ProductRow): Draft => ({
  kind: row?.kind ?? null, name: row?.name ?? "", website: row?.website ?? "", links: (row?.links ?? []).join("\n"), description: row?.description ?? "", stage: row?.stage ?? null,
  audience: row?.audience ?? "", price_tier: row?.price_tier ?? "", sales_channel: row?.sales_channel ?? "", region: row?.region ?? "",
  answers: row?.answers ?? {}, socials: (row?.socials as Record<string, string>) ?? {}, known_competitors: row?.known_competitors.join(", ") ?? "",
  category: row?.category ?? null, category_label: row?.category_label ?? null, platform_scores: row?.platform_scores ?? null, keywords: row?.keywords ?? [],
});

const STEPS = ["What you're building", "The basics", "About it", "Your channels", "Competitors"];

/** Onboarding, adding another product, and editing one: the same five steps. */
export function ProductForm({ product, onDone }: { product?: ProductRow; onDone?: (row: ProductRow) => void }) {
  const router = useRouter();
  const [step, setStep] = useState(product ? 1 : 0);
  const [draft, setDraft] = useState<Draft>(fromRow(product));
  const [readDescription, setReadDescription] = useState(product?.description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Without the AI key the form still works: nothing is filled in for you, and the links aren't read.
  const aiLocked = useLocked("ai");
  /** Whether the AI read the description (false: the fields on the next step are the user's to fill in). */
  const [filled, setFilled] = useState(Boolean(product?.category));
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const setAnswer = (key: string, value: string) => setDraft((d) => ({ ...d, answers: { ...d.answers, [key]: value } }));

  /** The AI reads the description: category, customer, price, where it sells, channels and keywords. */
  async function readProduct() {
    if (draft.description.trim() === readDescription.trim() && draft.category) return setStep(2);
    setError("");
    if (aiLocked) { set({ region: draft.region || "Worldwide" }); return setStep(2); }
    setBusy(true);
    const response = await fetch("/api/intake", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: draft.name, description: draft.description, website: draft.website, kind: draft.kind }) }).catch(() => null);
    const data = await response?.json().catch(() => null);
    setBusy(false);
    // The read is a convenience: when it doesn't come back, the next step is filled in by hand.
    if (!response?.ok || !data?.category) { setFilled(false); set({ region: draft.region || "Worldwide" }); return setStep(2); }
    const intake = data as Intake;
    setFilled(true);
    setReadDescription(draft.description);
    const firstQuestion = draft.kind ? KIND_QUESTIONS[draft.kind][0] : null;
    set({
      category: intake.category, category_label: intake.categoryLabel, platform_scores: intake.platformScores,
      keywords: intake.keywords.filter((k) => k.fit >= 0.5).slice(0, 8).map((k) => k.keyword),
      audience: draft.audience || intake.guesses.audience || "", price_tier: draft.price_tier || intake.guesses.price || "",
      sales_channel: draft.sales_channel || intake.guesses.salesChannel || "", region: draft.region || "Worldwide",
      answers: firstQuestion && !firstQuestion.options && !draft.answers[firstQuestion.key] && intake.keywords[0] && firstQuestion.key !== "city"
        ? { ...draft.answers, [firstQuestion.key]: intake.keywords[0].keyword } : draft.answers,
    });
    setStep(2);
  }

  async function save() {
    setBusy(true); setError("");
    const body = { ...draft, website: draft.website || null, known_competitors: draft.known_competitors };
    // A dropped connection or an answer that isn't JSON: say so and let the person try again (the button stayed on "Saving…").
    const response = await fetch(product ? `/api/products/${product.id}` : "/api/products", { method: product ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const data = await response?.json().catch(() => null);
    setBusy(false);
    if (!response?.ok || !data?.id) return setError(data?.error ?? "Couldn't save. Check your connection and try again.");
    // The AI reads the links in the background (new product, or links changed); the corner indicator shows it.
    const linksBefore = [product?.website ?? "", ...(product?.links ?? [])].join("\n").trim();
    const linksNow = [data.website ?? "", ...(data.links ?? [])].join("\n").trim();
    if (!aiLocked && linksNow && (!product || linksNow !== linksBefore)) {
      await fetch(`/api/products/${data.id}/insight`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "start" }) }).catch(() => null);
    }
    if (onDone) onDone(data); else { router.replace(data?.id ? `/app/w/${data.id}` : "/app/w"); router.refresh(); }
  }

  const canNext = [Boolean(draft.kind), Boolean(draft.name.trim()) && draft.description.trim().length >= 15, Boolean(draft.stage), true, true][step];

  return (
    <div>
      <ol className="mb-5 flex flex-wrap items-center gap-2 text-xs">
        {STEPS.map((label, i) => (
          <li key={label} className="flex items-center gap-2">
            <button type="button" disabled={i > step && !product} onClick={() => (i < step || product) && setStep(i)}
              className={cx("grid size-5 place-items-center rounded-full text-[11px] font-medium", i < step ? "bg-win text-on-ink" : i === step ? "bg-accent-fill text-on-accent" : "bg-control text-muted")}>{i < step ? "✓" : i + 1}</button>
            <span className={cx(i === step ? "font-medium text-ink" : "text-muted", "hidden @xl:inline")}>{label}</span>
            {i < STEPS.length - 1 && <span className="h-px w-4 bg-line" />}
          </li>
        ))}
      </ol>

      <Card className="p-4">
        {step === 0 && (
          <>
            <h2 className="text-title font-medium">What are you building?</h2>
            <p className="mt-1 text-sm text-muted">Pick the closest. It decides a couple of the questions we ask next.</p>
            <div className="mt-4 grid gap-2 @xl:grid-cols-3">
              {(Object.keys(KIND_LABEL) as ProductKind[]).map((kind) => (
                <button key={kind} type="button" onClick={() => set({ kind })}
                  className={cx("rounded-control border px-3 py-2.5 text-left text-sm transition", draft.kind === kind ? "border-accent/60 bg-accent-soft font-medium" : "border-line bg-card hover:bg-hover")}>{KIND_LABEL[kind]}</button>
              ))}
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <h2 className="text-title font-medium">The basics</h2>
            <p className="mt-1 text-sm text-muted">What it is, who it&apos;s for and how people buy it, in a few honest lines.</p>
            <div className="mt-4 grid gap-4">
              <div className="grid gap-4 @xl:grid-cols-2">
                <Field label="Product or brand name"><input className={inputClass} value={draft.name} maxLength={120} onChange={(e) => set({ name: e.target.value })} placeholder="Volt" /></Field>
                <Field label="Website (optional)"><input className={inputClass} value={draft.website} onChange={(e) => set({ website: e.target.value })} placeholder="https://volt.drinks" /></Field>
              </div>
              <Field label="More links (optional)" hint={aiLocked
                ? <LockedNote state={aiLocked}>Store listing, docs, anything about it. One per line. They are saved now and read once the AI is connected.</LockedNote>
                : "Store listing, docs, anything about it. One per line. After you save, the AI reads them and your website's pages, then offers a fuller profile: the problem, the customer, your brand colours and voice."}>
                <textarea className={cx(inputClass, "min-h-20 font-mono")} value={draft.links} onChange={(e) => set({ links: e.target.value })}
                  placeholder={"https://apps.apple.com/app/volt/id1234567890\nhttps://volt.drinks/about"} />
              </Field>
              <Field label="What is it?" hint={`${draft.description.trim().length} characters · at least 15`}>
                <textarea className={cx(inputClass, "min-h-28")} value={draft.description} maxLength={2000} onChange={(e) => set({ description: e.target.value })}
                  placeholder="A zero-sugar energy drink with natural caffeine for gamers and students, sold online and in convenience stores." />
              </Field>
            </div>
          </>
        )}

        {step === 2 && draft.kind && (
          <>
            <div className="flex flex-wrap items-center gap-2"><h2 className="text-title font-medium">About {draft.name || "it"}</h2>{draft.category_label && <Badge tone="accent">{draft.category_label}</Badge>}</div>
            <p className="mt-1 text-sm text-muted">{filled ? "We've filled in what we could from your description; fix anything that's off." : "Fill in what you know. You can change any of it later."}</p>
            <div className="mt-4">
              <p className="mb-2 text-sm font-medium">Where are you today?</p>
              <div className="grid gap-2 @xl:grid-cols-4">
                {(Object.keys(STAGE_LABEL) as Stage[]).map((stage) => (
                  <button key={stage} type="button" onClick={() => set({ stage })} className={cx("rounded-control border px-3 py-2.5 text-left text-sm transition", draft.stage === stage ? "border-accent/60 bg-accent-soft font-medium" : "border-line bg-card hover:bg-hover")}>{STAGE_LABEL[stage]}</button>
                ))}
              </div>
            </div>
            <div className="mt-4 grid gap-4 @xl:grid-cols-2">
              {KIND_QUESTIONS[draft.kind].map((q) => (
                <Field key={q.key} label={q.label}>
                  {q.options ? (
                    <select className={inputClass} value={draft.answers[q.key] ?? ""} onChange={(e) => setAnswer(q.key, e.target.value)}>
                      <option value="">Choose…</option>{q.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  ) : <input className={inputClass} value={draft.answers[q.key] ?? ""} placeholder={q.placeholder} onChange={(e) => setAnswer(q.key, e.target.value)} />}
                </Field>
              ))}
              <Field label="Who is it for?"><input className={inputClass} value={draft.audience} onChange={(e) => set({ audience: e.target.value })} placeholder="Gen Z gamers, busy parents, finance teams…" /></Field>
              <Field label="Price point">
                <select className={inputClass} value={draft.price_tier} onChange={(e) => set({ price_tier: e.target.value })}><option value="">Choose…</option>{PRICES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
              </Field>
              <Field label="Where do people buy it?">
                <select className={inputClass} value={draft.sales_channel} onChange={(e) => set({ sales_channel: e.target.value })}><option value="">Choose…</option>{SALES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
              </Field>
              <Field label="Which market?"><input className={inputClass} value={draft.region} onChange={(e) => set({ region: e.target.value })} placeholder="Worldwide, US, UK, India…" /></Field>
              <div className="@xl:col-span-2"><Field label="What makes it different? (optional)"><input className={inputClass} value={draft.answers.differentiator ?? ""} onChange={(e) => setAnswer("differentiator", e.target.value)} placeholder="Half the sugar, built for agencies, open till 3am…" /></Field></div>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h2 className="text-title font-medium">Your channels</h2>
            <p className="mt-1 text-sm text-muted">Where you already post, if anywhere. We use these to compare you with your competitors later; leave any blank.</p>
            <div className="mt-4 grid gap-3 @xl:grid-cols-2">
              {SOCIALS.map((key) => (
                <label key={key} className="flex items-center gap-3 text-sm">
                  <span className="w-32 shrink-0">{key === "facebook" ? <span className="inline-flex items-center gap-1.5 text-xs font-medium"><span className="size-2.5 rounded-full bg-accent" />Facebook</span> : <PlatformBadge platform={key} />}</span>
                  <input className={cx(inputClass, "py-1.5")} value={draft.socials[key] ?? ""} placeholder={key === "linkedin" ? "company slug or URL" : key === "facebook" ? "page name or URL" : "handle"}
                    onChange={(e) => set({ socials: { ...draft.socials, [key]: e.target.value } })} />
                </label>
              ))}
            </div>
          </>
        )}

        {step === 4 && (
          <>
            <h2 className="text-title font-medium">Competitors you already know</h2>
            <p className="mt-1 text-sm text-muted">Optional. Names, @handles or links, separated by commas. Don&apos;t know any yet? That&apos;s what {APP_NAME} is for: leave it empty.</p>
            <textarea aria-label="Competitors you already know" className={cx(inputClass, "mt-4 min-h-28")} value={draft.known_competitors} onChange={(e) => set({ known_competitors: e.target.value })} placeholder="@celsiusofficial, Liquid Death, monster.energy…" />
            <p className="mt-2 text-xs text-muted">This is the product&apos;s one competitor list, the same one as Research → Competitors. Ones you follow there or that have a Facebook Page are removed there.</p>
            {draft.keywords.length > 0 && (
              <div className="mt-4">
                <p className="mb-2 text-sm font-medium">Your niche, in search terms</p>
                <div className="flex flex-wrap gap-1.5">{draft.keywords.map((k) => <span key={k} className="rounded-full border border-hairline bg-control px-2 py-0.5 text-xs text-ink">{k}</span>)}</div>
                <p className="mt-2 text-xs text-muted">Picked by the AI from your description. Used to find competitors, and the best content in your niche if there are none.</p>
              </div>
            )}
          </>
        )}

        {error && <p className="mt-5 text-sm text-warn">{error}</p>}
        <div className="mt-4 flex justify-between">
          {step > 0 ? <Button variant="ghost" onClick={() => setStep(step - 1)}>Back</Button> : <span />}
          {step === 1 ? <Button onClick={readProduct} disabled={busy || !canNext}>{busy ? <><Spinner /> Reading your description…</> : "Continue"}</Button>
            : step < STEPS.length - 1 ? <Button onClick={() => setStep(step + 1)} disabled={!canNext}>Continue</Button>
            : <Button onClick={save} disabled={busy}>{busy ? <><Spinner /> Saving…</> : product ? "Save changes" : "Finish"}</Button>}
        </div>
      </Card>
    </div>
  );
}
