"use client";
// The Brand tab: the things people actually set (name and logo, one-line positioning, the look's
// prompt modifier, voice, words and claims to avoid, colours, fonts, offers with their sources, verified
// facts, wording, description disclaimers, avatars) open, and the rest of the brand system (look and
// voice details, offer rules, products, positioning) under "More detail".
// Edits go into the Brand page's draft (brand-view.tsx), saved with its Save button.
import { useMemo, useRef, useState } from "react";
import { kitColors, type BrandBasics } from "@/lib/brand";
import {
  BRAND_SYSTEM_LIMITS, brandSystemSummary, cleanBrandSystem, lookBlock, copyBlock,
  type BrandAvatar, type BrandColor, type BrandFact, type BrandFont, type BrandOffer, type BrandProduct, type BrandSubstitution, type BrandSystem, type ColorRole, type FontRole, type RequiredPhrase,
} from "@/lib/brand-system";
import { brandRules, rulesBlock } from "@/lib/brand-rules";
import { hexColor } from "@/lib/workspace-schema";
import { WorkspaceIcon } from "../workspace/parts";
import { IconCheck } from "../icons";
import { Badge, Button, Card, cx, Field, inputClass, Spinner } from "../ui";
import { Block, IMAGE_TYPES, ListField, RemoveButton, Section, SourceField, Text, uploadBrandImage, uploadFont } from "./brand-fields";
import { useIconPalette } from "./icon-palette";

const ROLES: ColorRole[] = ["primary", "secondary", "accent", "neutral", "background"];
const FONT_ROLES: FontRole[] = ["headline", "body", "accent", "legal"];
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

type ListKey = "avatars" | "offers" | "palette" | "fonts" | "products";

type Props = {
  productId: string;
  basics: BrandBasics;
  sys: BrandSystem;
  /** The product's name, shown until the brand has its own. */
  placeholder: string;
  hasProfile: boolean;
  dirty: boolean;
  editBasics: (patch: Partial<BrandBasics>) => void;
  edit: (patch: Partial<BrandSystem>) => void;
  onError: (text: string) => void;
};

export function BrandCoreTab({ productId, basics, sys, placeholder, hasProfile, dirty, editBasics, edit, onError }: Props) {
  const editLook = (patch: Partial<BrandSystem["look"]>) => edit({ look: { ...sys.look, ...patch } });
  const editVoice = (patch: Partial<BrandSystem["voice"]>) => edit({ voice: { ...sys.voice, ...patch } });
  const editAt = <K extends ListKey>(key: K, i: number, patch: Partial<BrandSystem[K][number]>) =>
    edit({ [key]: sys[key].map((x, j) => (j === i ? { ...x, ...patch } : x)) } as Partial<BrandSystem>);
  const removeAt = (key: ListKey, i: number) => edit({ [key]: sys[key].filter((_, j) => j !== i) } as Partial<BrandSystem>);
  const addColour = (hex: string) => edit({ palette: [...sys.palette, { name: "", hex, role: sys.palette.some((c) => c.role === "primary") ? "accent" : "primary", use: "" }] });
  const facts = sys.facts ?? [];
  const editFact = (i: number, patch: Partial<BrandFact>) => edit({ facts: facts.map((f, j) => (j === i ? { ...f, ...patch } : f)) });
  const substitutions = sys.voice.substitutions ?? [];
  const editSubstitution = (i: number, patch: Partial<BrandSubstitution>) => editVoice({ substitutions: substitutions.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const required = sys.voice.requiredPhrases ?? [];
  const editRequired = (i: number, patch: Partial<RequiredPhrase>) => editVoice({ requiredPhrases: required.map((x, j) => (j === i ? { ...x, ...patch } : x)) });

  const preview = useMemo(() => {
    const s = cleanBrandSystem(sys);
    const rules = rulesBlock(brandRules({ appName: basics.appName || placeholder, forbiddenClaims: s.voice.forbiddenClaims, system: s }));
    return [lookBlock(s), copyBlock(s, { variant: 1, kind: "image", rules: false }), rules].filter(Boolean).join("\n\n");
  }, [sys, basics.appName, placeholder]);
  const summary = brandSystemSummary(sys);
  const claims = sys.voice.forbiddenClaims.filter((c) => c.trim()).length;
  const detail = moreDetailCount(sys);

  return (
    <div className="grid items-start gap-6 @4xl:grid-cols-[minmax(0,1fr)_minmax(300px,360px)]">
      <div className="grid min-w-0 gap-3">
        <NameBlock productId={productId} basics={basics} placeholder={placeholder} onChange={editBasics} onError={onError} />

        <Block title="Look" hint="One paragraph that opens every image prompt." count={sys.look.promptModifier ? `${sys.look.promptModifier.length} chars` : "empty"}>
          <Text label="Prompt modifier" hint="50–75 words: exact hexes, light direction, colour grade, surfaces, mood, hard rules." value={sys.look.promptModifier} onChange={(v) => editLook({ promptModifier: v })} area rows={4} max={900} />
        </Block>

        <Block title="Voice" hint="How copy sounds, and what it must never say: QA rejects a creative that makes a forbidden claim.">
          <Text label="Voice in one line" hint="Who's talking, to whom, and how." value={sys.voice.oneLine} onChange={(v) => editVoice({ oneLine: v })} area max={400} />
          <div className="grid gap-3 @xl:grid-cols-2">
            <ListField label="Words we never use" value={sys.voice.avoid} onChange={(v) => editVoice({ avoid: v })} rows={4} />
            <ListField label="Forbidden claims" hint={`One per line (${claims}/${BRAND_SYSTEM_LIMITS.claims}). Never said or implied.`}
              value={sys.voice.forbiddenClaims} onChange={(v) => editVoice({ forbiddenClaims: v })} rows={4} />
          </div>
        </Block>

        <Block title="Colours" hint="Named, with roles. Prompts name them by role; posts, Recreate and Formats use primary and accent first." count={`${sys.palette.length}`}>
          {sys.palette.map((c: BrandColor, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <input type="color" aria-label="Pick a colour" value={hexColor(c.hex) ?? "#000000"} onChange={(e) => editAt("palette", i, { hex: e.target.value.toUpperCase() })} className="size-7 shrink-0 cursor-pointer rounded-full border border-ink/10 bg-card p-0" />
              <input className={cx(inputClass, "w-28!")} value={c.hex} aria-label="Hex" onChange={(e) => editAt("palette", i, { hex: e.target.value })} />
              <input className={cx(inputClass, "w-36!")} value={c.name} aria-label="Name" placeholder="Name" onChange={(e) => editAt("palette", i, { name: e.target.value })} />
              <select className={cx(inputClass, "w-32!")} value={c.role} aria-label="Role" onChange={(e) => editAt("palette", i, { role: e.target.value as ColorRole })}>{ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</select>
              <input className={cx(inputClass, "min-w-40 flex-1")} value={c.use} aria-label="Use" placeholder="What it's for" onChange={(e) => editAt("palette", i, { use: e.target.value })} />
              <RemoveButton label={`Remove ${c.hex}`} onClick={() => removeAt("palette", i)} />
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => addColour("")}>Add a colour</Button>
            <IconColours iconUrl={basics.iconUrl} palette={sys.palette} onAdd={addColour} />
          </div>
        </Block>

        <Block title="Fonts" hint="Composed ads set every line in these files (TTF, OTF or WOFF)." count={`${sys.fonts.filter((f) => f.url).length}/${sys.fonts.length} with files`}>
          {sys.fonts.map((f: BrandFont, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <select className={cx(inputClass, "w-28!")} value={f.role} aria-label="Role" onChange={(e) => editAt("fonts", i, { role: e.target.value as FontRole })}>{FONT_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</select>
              <input className={cx(inputClass, "w-40!")} value={f.family} aria-label="Family" onChange={(e) => editAt("fonts", i, { family: e.target.value })} />
              <input className={cx(inputClass, "w-20!")} type="number" step={100} min={100} max={900} value={f.weight} aria-label="Weight" onChange={(e) => editAt("fonts", i, { weight: Number(e.target.value) })} />
              {f.url ? <Badge tone="win"><IconCheck className="mr-1 size-3" />file</Badge> : <Badge tone="caution">no file</Badge>}
              <label className="cursor-pointer text-xs text-accent hover:underline">
                {f.url ? "Replace file" : "Upload file"}
                <input type="file" accept=".ttf,.otf,.woff" className="hidden" onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  try { editAt("fonts", i, { url: await uploadFont(productId, file) }); } catch (err) { onError(err instanceof Error ? err.message : String(err)); }
                }} />
              </label>
              <RemoveButton label={`Remove ${f.family}`} onClick={() => removeAt("fonts", i)} />
            </div>
          ))}
          <div><Button size="sm" variant="secondary" onClick={() => edit({ fonts: [...sys.fonts, { role: "headline", family: "", weight: 600, description: "" }] })}>Add a font</Button></div>
        </Block>

        <Block title="Offers" hint="The closed list: no creative may show any other price, discount, trial or code, and QA fails one that does." count={`${sys.offers.length}`}>
          {sys.offers.map((o: BrandOffer, i) => (
            <div key={o.id + i} className="grid gap-2 rounded-inner border border-line bg-raised p-3">
              <div className="flex items-center gap-2">
                <input className={cx(inputClass, "w-16! font-medium")} value={o.id} aria-label="Id" onChange={(e) => editAt("offers", i, { id: e.target.value })} />
                <input className={cx(inputClass, "flex-1")} value={o.name} aria-label="Name" placeholder="Free 7-day trial" onChange={(e) => editAt("offers", i, { name: e.target.value })} />
                <RemoveButton label={`Remove ${o.id}`} onClick={() => removeAt("offers", i)} />
              </div>
              <Text label="Exact wording allowed on a creative" hint="Shown word for word, e.g. From $9.99/month." value={o.wording} onChange={(v) => editAt("offers", i, { wording: v })} max={160} />
              <Text label="Terms" value={o.terms} onChange={(v) => editAt("offers", i, { terms: v })} area max={600} />
              <SourceField label="Where the price and wording were checked" value={o.source} onChange={(v) => editAt("offers", i, { source: v })} />
            </div>
          ))}
          <div><Button size="sm" variant="secondary" onClick={() => edit({ offers: [...sys.offers, { id: `O${sys.offers.length + 1}`, name: "", wording: "", terms: "" }] })}>Add an offer</Button></div>
        </Block>

        <Block title="Verified facts" hint="The numbers a creative may show (a rating, a count, a comparison price), word for word. QA fails any other number that isn't an offer's wording." count={`${facts.length}`}>
          {facts.map((f: BrandFact, i) => (
            <div key={f.id + i} className="grid gap-2 rounded-inner border border-line bg-raised p-3">
              <div className="flex flex-wrap items-center gap-2">
                <input className={cx(inputClass, "w-48! font-medium")} value={f.label} aria-label="What it is" placeholder="App Store rating" onChange={(e) => editFact(i, { label: e.target.value })} />
                <input className={cx(inputClass, "min-w-48 flex-1")} value={f.value} aria-label="Exact wording" placeholder="4.8★ · 2,000+ ratings" maxLength={160} onChange={(e) => editFact(i, { value: e.target.value })} />
                <RemoveButton label={`Remove ${f.label || "this fact"}`} onClick={() => edit({ facts: facts.filter((_, j) => j !== i) })} />
              </div>
              <SourceField value={f.source} onChange={(v) => editFact(i, { source: v ?? { kind: "manual" } })} />
            </div>
          ))}
          <div><Button size="sm" variant="secondary" disabled={facts.length >= BRAND_SYSTEM_LIMITS.facts} onClick={() => edit({ facts: [...facts, { id: `f${Date.now()}`, label: "", value: "", source: { kind: "manual" } }] })}>Add a fact</Button></div>
        </Block>

        <Block title="Wording" hint={<>Every prompt says &ldquo;Say X, never Y&rdquo;, and QA fails a creative or its copy that says Y (a former name works the same way: say your product&rsquo;s name, never the old one). Required phrases must come with their word.</>} count={`${substitutions.length + required.length}`}>
          <div className="grid gap-2">
            <span className="text-xs font-medium text-label">Say this, never that</span>
            {substitutions.map((x: BrandSubstitution, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <input className={cx(inputClass, "w-44!")} value={x.avoid} aria-label="Never say" placeholder="cheap" maxLength={80} onChange={(e) => editSubstitution(i, { avoid: e.target.value })} />
                <span className="text-xs text-muted">→ say</span>
                <input className={cx(inputClass, "w-52!")} value={x.use} aria-label="Say instead" placeholder="affordable" maxLength={120} onChange={(e) => editSubstitution(i, { use: e.target.value })} />
                <input className={cx(inputClass, "min-w-40 flex-1")} value={x.note ?? ""} aria-label="Why" placeholder="Why (optional)" maxLength={200} onChange={(e) => editSubstitution(i, { note: e.target.value })} />
                <RemoveButton label={`Remove ${x.avoid || "this rule"}`} onClick={() => editVoice({ substitutions: substitutions.filter((_, j) => j !== i) })} />
              </div>
            ))}
            <div><Button size="sm" variant="secondary" disabled={substitutions.length >= BRAND_SYSTEM_LIMITS.substitutions} onClick={() => editVoice({ substitutions: [...substitutions, { avoid: "", use: "" }] })}>Add a substitution</Button></div>
          </div>
          <div className="grid gap-2">
            <span className="text-xs font-medium text-label">Always say with it</span>
            {required.map((x: RequiredPhrase, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted">When copy mentions</span>
                <input className={cx(inputClass, "w-44!")} value={x.when} aria-label="When copy mentions" placeholder="free trial" maxLength={80} onChange={(e) => editRequired(i, { when: e.target.value })} />
                <span className="text-xs text-muted">also say</span>
                <input className={cx(inputClass, "min-w-48 flex-1")} value={x.phrase} aria-label="Also say" placeholder="cancel anytime" maxLength={200} onChange={(e) => editRequired(i, { phrase: e.target.value })} />
                <RemoveButton label={`Remove ${x.when || "this rule"}`} onClick={() => editVoice({ requiredPhrases: required.filter((_, j) => j !== i) })} />
              </div>
            ))}
            <div><Button size="sm" variant="secondary" disabled={required.length >= BRAND_SYSTEM_LIMITS.requiredPhrases} onClick={() => editVoice({ requiredPhrases: [...required, { when: "", phrase: "" }] })}>Add a required phrase</Button></div>
          </div>
        </Block>

        <Block title="Description disclaimers" hint="What Meta's link description carries on every ad (written copy starts with these). Keep results disclaimers here, not on the image." count={`${(sys.descriptionDisclaimers ?? []).length}`}>
          <ListField label="Disclaimers" hint={`One per line, up to ${BRAND_SYSTEM_LIMITS.disclaimers}. AI-made ads add "AI-generated imagery." on their own.`} value={sys.descriptionDisclaimers ?? []} onChange={(v) => edit({ descriptionDisclaimers: v })} />
        </Block>

        <Block title="Avatars" hint="The people ads speak to. Variant 1 speaks to the first, variant 2 to the second, and so on." count={`${sys.avatars.length}`}>
          {sys.avatars.map((a: BrandAvatar, i) => (
            <details key={a.id + i} className="rounded-inner border border-line bg-raised" open={!a.name}>
              <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm">
                <span className="font-medium">{a.name || "New avatar"}</span>
                <span className="min-w-0 truncate text-xs text-muted">{a.type}</span>
              </summary>
              <div className="grid gap-2 border-t border-line p-3">
                <div className="flex items-center gap-2">
                  <input className={cx(inputClass, "w-36! font-medium")} value={a.name} aria-label="Name" placeholder="Name" onChange={(e) => editAt("avatars", i, { name: e.target.value })} />
                  <input className={cx(inputClass, "flex-1")} value={a.type} aria-label="Type" placeholder="The busy parent, 30–45" onChange={(e) => editAt("avatars", i, { type: e.target.value })} />
                  <RemoveButton label={`Remove ${a.name || "this avatar"}`} onClick={() => removeAt("avatars", i)} />
                </div>
                <Text label="A moment" value={a.moment} onChange={(v) => editAt("avatars", i, { moment: v })} area max={600} />
                <ListField label="Their words (used verbatim)" value={a.painWords} onChange={(v) => editAt("avatars", i, { painWords: v })} />
                <div className="grid gap-2 @xl:grid-cols-2">
                  <Text label="Wants" value={a.wants} onChange={(v) => editAt("avatars", i, { wants: v })} area max={400} />
                  <Text label="Emotional driver" value={a.driver} onChange={(v) => editAt("avatars", i, { driver: v })} area max={300} />
                </div>
                <Text label="Ad point of view" hint="What an ad for them leads with and proves first." value={a.pov} onChange={(v) => editAt("avatars", i, { pov: v })} area max={400} />
                <ListField label="Objections" hint="One per line: doubt → answer." value={a.objections.map((o) => `${o.doubt} → ${o.answer}`)}
                  onChange={(v) => editAt("avatars", i, { objections: v.map((l) => { const [doubt, ...rest] = l.split("→"); return { doubt: doubt.trim(), answer: rest.join("→").trim() }; }) })} />
              </div>
            </details>
          ))}
          <div><Button size="sm" variant="secondary" onClick={() => edit({ avatars: [...sys.avatars, { id: `a${Date.now()}`, name: "", type: "", moment: "", painWords: [], wants: "", objections: [], driver: "", pov: "" }] })}>Add an avatar</Button></div>
        </Block>

        <details className="group/more mt-2">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-1 py-1 text-sm text-label hover:text-ink">
            <span className="transition group-open/more:rotate-90">›</span>
            <span className="font-medium">More detail</span>
            <span className="text-xs text-muted">{detail ? `${plural(detail, "field")} filled · ` : ""}look and voice details, offer rules, products, positioning</span>
          </summary>
          <div className="mt-3 grid gap-3">
            <Section title="Look details" hint="Art direction beyond the prompt modifier." count={countFilled([sys.look.lighting, sys.look.grade, sys.look.composition, sys.look.surfaces, sys.look.subjects, sys.look.mood, sys.look.packaging, sys.look.textOnImage, sys.look.offerStyle])}>
              <div className="grid gap-3 @xl:grid-cols-2">
                <Text label="Lighting" value={sys.look.lighting} onChange={(v) => editLook({ lighting: v })} max={400} />
                <Text label="Colour grade" value={sys.look.grade} onChange={(v) => editLook({ grade: v })} max={400} />
                <Text label="Composition" value={sys.look.composition} onChange={(v) => editLook({ composition: v })} max={400} />
                <Text label="Surfaces" value={sys.look.surfaces} onChange={(v) => editLook({ surfaces: v })} max={400} />
                <Text label="In frame" value={sys.look.subjects} onChange={(v) => editLook({ subjects: v })} max={400} />
                <Text label="Mood" value={sys.look.mood} onChange={(v) => editLook({ mood: v })} max={200} />
              </div>
              <Text label="Packaging and product" hint="How the product must look (shape, finish, label, what makes it recognisable)." value={sys.look.packaging} onChange={(v) => editLook({ packaging: v })} area max={800} />
              <div className="grid gap-3 @xl:grid-cols-2">
                <Text label="Text on images" value={sys.look.textOnImage} onChange={(v) => editLook({ textOnImage: v })} area max={400} />
                <Text label="How offers are shown" value={sys.look.offerStyle} onChange={(v) => editLook({ offerStyle: v })} area max={400} />
              </div>
            </Section>

            <Section title="Voice details" hint="Rules, words to use, signature lines and examples." count={countFilled([sys.voice.rules, sys.voice.use, sys.voice.signatureLines, sys.voice.examples, sys.voice.dos, sys.voice.donts])}>
              <ListField label="Rules" value={sys.voice.rules} onChange={(v) => editVoice({ rules: v })} rows={4} />
              <div className="grid gap-3 @xl:grid-cols-2">
                <ListField label="Words we use" value={sys.voice.use} onChange={(v) => editVoice({ use: v })} rows={4} />
                <ListField label="Signature lines" value={sys.voice.signatureLines} onChange={(v) => editVoice({ signatureLines: v })} rows={4} />
                <ListField label="Example copy" value={sys.voice.examples} onChange={(v) => editVoice({ examples: v })} />
                <ListField label="Do" value={sys.voice.dos} onChange={(v) => editVoice({ dos: v })} />
                <ListField label="Don't" value={sys.voice.donts} onChange={(v) => editVoice({ donts: v })} />
              </div>
            </Section>

            <Section title="Offer rules" hint="What's never offered, and how offers may be stacked and framed." count={countFilled([sys.notOffered, sys.offerRules])}>
              <div className="grid gap-3 @xl:grid-cols-2">
                <ListField label="We don't offer" hint="Never shown (a free trial, discount codes…)." value={sys.notOffered} onChange={(v) => edit({ notOffered: v })} />
                <ListField label="Stacking and framing rules" value={sys.offerRules} onChange={(v) => edit({ offerRules: v })} />
              </div>
            </Section>

            <Section title="Products" hint="Facts copy may cite word for word when a brief names the product, and how each looks." count={`${sys.products.length}`}>
              {sys.products.map((p: BrandProduct, i) => (
                <details key={p.slug + i} className="rounded-inner border border-line bg-raised">
                  <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm">
                    {p.accent && <span className="size-3.5 shrink-0 rounded-full border border-ink/10" style={{ background: p.accent }} />}
                    <span className="font-medium">{p.name || "Untitled"}</span>
                    <span className="truncate text-xs text-muted">{p.category}{p.assetIds.length ? ` · ${plural(p.assetIds.length, "image")}` : ""}</span>
                  </summary>
                  <div className="grid gap-2 border-t border-line p-3">
                    <div className="grid gap-2 @xl:grid-cols-3">
                      <Text label="Name" value={p.name} onChange={(v) => editAt("products", i, { name: v })} max={80} />
                      <Text label="Category" value={p.category} onChange={(v) => editAt("products", i, { category: v })} max={80} />
                      <Text label="Accent colour" value={p.accent} onChange={(v) => editAt("products", i, { accent: v })} max={9} />
                    </div>
                    <Text label="Description" value={p.description} onChange={(v) => editAt("products", i, { description: v })} area max={600} />
                    <ListField label="Claims (only these, as written)" value={p.claims} onChange={(v) => editAt("products", i, { claims: v })} />
                    <div className="grid gap-2 @xl:grid-cols-2">
                      <ListField label="For" value={p.uses} onChange={(v) => editAt("products", i, { uses: v })} />
                      <ListField label="Warnings" value={p.warnings} onChange={(v) => editAt("products", i, { warnings: v })} />
                    </div>
                    <div className="grid gap-2 @xl:grid-cols-3">
                      <Text label="Results" value={p.results} onChange={(v) => editAt("products", i, { results: v })} max={400} />
                      <Text label="Price" value={p.price} onChange={(v) => editAt("products", i, { price: v })} max={80} />
                      <Text label="Size" value={p.size} onChange={(v) => editAt("products", i, { size: v })} max={40} />
                    </div>
                    {p.price && <SourceField label="Where the price was checked" value={p.priceSource} onChange={(v) => editAt("products", i, { priceSource: v })} />}
                    <div className="flex justify-end"><Button size="sm" variant="ghost" onClick={() => removeAt("products", i)}>Remove this product</Button></div>
                  </div>
                </details>
              ))}
              <div><Button size="sm" variant="secondary" onClick={() => edit({ products: [...sys.products, { slug: `p${Date.now()}`, name: "", category: "", description: "", claims: [], uses: [], results: "", warnings: [], price: "", size: "", accent: "", assetIds: [] }] })}>Add a product</Button></div>
            </Section>

            <Section title="Positioning details" hint="What the brand stands for and against; Recreate and the format library use it for angles." count={countFilled([sys.positioning.counterPosition, sys.positioning.valueProposition, sys.positioning.standsAgainst])}>
              <Text label="Value proposition" value={sys.positioning.valueProposition} onChange={(v) => edit({ positioning: { ...sys.positioning, valueProposition: v } })} area max={600} />
              <Text label="Counter-position" value={sys.positioning.counterPosition} onChange={(v) => edit({ positioning: { ...sys.positioning, counterPosition: v } })} area max={600} />
              <Text label="Stands against" value={sys.positioning.standsAgainst} onChange={(v) => edit({ positioning: { ...sys.positioning, standsAgainst: v } })} area max={600} />
            </Section>
          </div>
        </details>
      </div>

      <Card className="grid gap-2 p-3 @4xl:sticky @4xl:top-14">
        <p className="text-sm font-medium">What every image prompt gets</p>
        <p className="text-xs text-muted">{summary.length ? `Using ${summary.join(", ")}.` : "Nothing yet."} Variant 1 shown; later variants speak to the next avatar.</p>
        <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-inner bg-raised p-3 font-mono text-xs leading-relaxed text-ink">{preview || "Fill the Look and Voice to see what prompts receive."}</pre>
        <p className="text-xs text-muted">
          Kit colours: {kitColors(sys.palette).join(", ") || "none"}. QA checks {plural(claims, "forbidden claim")}{hasProfile ? ", plus the AI profile's claims to avoid" : ""}.
        </p>
        {dirty && <p className="text-xs text-caution-ink">Unsaved changes.</p>}
      </Card>
    </div>
  );
}

/** "n/m" for a group of fields: how many have something in them. */
function countFilled(values: (string | string[])[]) {
  const filled = values.filter((v) => (Array.isArray(v) ? v.some((x) => x.trim()) : v.trim())).length;
  return `${filled}/${values.length}`;
}

/** How many of the fields under "More detail" have something in them (so a filled one isn't missed). */
function moreDetailCount(sys: BrandSystem) {
  const { look, voice, positioning } = sys;
  const values: (string | string[])[] = [
    look.lighting, look.grade, look.composition, look.surfaces, look.subjects, look.mood, look.packaging, look.textOnImage, look.offerStyle,
    voice.rules, voice.use, voice.signatureLines, voice.examples, voice.dos, voice.donts, sys.notOffered, sys.offerRules,
    positioning.counterPosition, positioning.valueProposition, positioning.standsAgainst,
  ];
  return values.filter((v) => (Array.isArray(v) ? v.some((x) => x.trim()) : v.trim())).length + (sys.products.length ? 1 : 0);
}

/** Name, one-line positioning and the logo (the app icon). The logo uploads at once and is kept on Save. */
function NameBlock({ productId, basics, placeholder, onChange, onError }: { productId: string; basics: BrandBasics; placeholder: string; onChange: (patch: Partial<BrandBasics>) => void; onError: (text: string) => void }) {
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  async function setLogo(file?: File) {
    if (!file) return;
    setBusy(true);
    try { onChange({ iconUrl: await uploadBrandImage(productId, "icon", file) }); } catch (error) { onError(error instanceof Error ? error.message : String(error)); }
    setBusy(false);
  }
  return (
    <Block title="Name and positioning" hint="How the app is named and described in ads.">
      <div className="grid gap-3 @xl:grid-cols-2">
        <Field label="Name"><input className={inputClass} value={basics.appName} maxLength={80} placeholder={placeholder} onChange={(e) => onChange({ appName: e.target.value })} /></Field>
        <Field label="One-line positioning" hint="What it does and for whom, as it would appear under the name."><input className={inputClass} value={basics.tagline} maxLength={160} placeholder="What the app does, in one line" onChange={(e) => onChange({ tagline: e.target.value })} /></Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <WorkspaceIcon name={basics.appName || placeholder} url={basics.iconUrl || undefined} className="size-10 text-base" />
        <div className="grid gap-1">
          <span className="text-xs text-muted">Logo (the app icon) · PNG, JPEG or WebP, up to 15 MB</span>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => input.current?.click()}>{busy && <Spinner />}{basics.iconUrl ? "Replace logo" : "Upload logo"}</Button>
            {basics.iconUrl && <Button size="sm" variant="ghost" disabled={busy} onClick={() => onChange({ iconUrl: "" })}>Remove</Button>}
          </div>
        </div>
        <input ref={input} type="file" accept={IMAGE_TYPES.join(",")} hidden onChange={(e) => { void setLogo(e.target.files?.[0]); e.target.value = ""; }} />
      </div>
    </Block>
  );
}

/** Colours read from the logo that aren't in the palette yet, one click to add. */
function IconColours({ iconUrl, palette, onAdd }: { iconUrl: string; palette: BrandColor[]; onAdd: (hex: string) => void }) {
  const have = new Set(palette.map((c) => c.hex.toUpperCase()));
  const suggested = useIconPalette(iconUrl || undefined).filter((c) => !have.has(c));
  if (!suggested.length || palette.length >= BRAND_SYSTEM_LIMITS.palette) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted">From the logo</span>
      {suggested.map((hex) => (
        <button key={hex} type="button" onClick={() => onAdd(hex)} className="flex items-center gap-1.5 rounded-full border border-dashed border-line px-1.5 py-0.5 text-xs transition hover:border-ink/40">
          <span className="size-4 rounded-full border border-ink/10" style={{ backgroundColor: hex }} /><span className="font-mono">+ {hex}</span>
        </button>
      ))}
    </div>
  );
}
