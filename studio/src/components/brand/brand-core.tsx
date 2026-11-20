"use client";
// The Brand tab: the things people actually set (name and logo, one-line positioning, the look's
// prompt modifier, voice, words and claims to avoid, colours, fonts, offers with their sources, verified
// facts, wording, description disclaimers, avatars) open, and the rest of the brand system (look and
// voice details, offer rules, products, positioning) under "More detail".
// Edits go into the Brand page's draft (brand-view.tsx), saved with its Save button.
import { useMemo, useRef, useState } from "react";
import { kitColors, type BrandBasics } from "@/lib/brand";
import {
  BRAND_SYSTEM_LIMITS, cleanBrandSystem, lookBlock, copyBlock,
  type BrandAvatar, type BrandColor, type BrandFact, type BrandFont, type BrandOffer, type BrandProduct, type BrandSubstitution, type BrandSystem, type ColorRole, type FontRole, type RequiredPhrase,
} from "@/lib/brand-system";
import { brandRules, rulesBlock } from "@/lib/brand-rules";
import { hexColor } from "@/lib/workspace-schema";
import { WorkspaceIcon } from "../workspace/parts";
import { IconCheck } from "../icons";
import { Badge, Button, Card, cx, Field, inputClass, Spinner } from "../ui";
import { Block, IMAGE_TYPES, ListField, RemoveButton, Section, SourceField, Text, uploadBrandImage, uploadFont } from "./brand-fields";
import { useIconPalette } from "./icon-palette";
import { useT } from "@/lib/i18n/client";
import { m } from "@/lib/i18n/translate";

const ROLES: ColorRole[] = ["primary", "secondary", "accent", "neutral", "background"];
const FONT_ROLES: FontRole[] = ["headline", "body", "accent", "legal"];
const ROLE_LABEL: Record<ColorRole, string> = { primary: m("primary"), secondary: m("secondary"), accent: m("accent"), neutral: m("neutral"), background: m("background") };
const FONT_ROLE_LABEL: Record<FontRole, string> = { headline: m("headline"), body: m("body"), accent: m("accent"), legal: m("legal") };

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
  const { t, tn } = useT();
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
  // What the prompts use (lib/brand-system.ts brandSystemSummary), in the page's language.
  const summary = [
    sys.look.promptModifier ? t("look") : "",
    sys.voice.oneLine || sys.voice.rules.length ? t("voice") : "",
    sys.avatars.length ? tn(sys.avatars.length, "{n} avatar", "{n} avatars") : "",
    sys.offers.length ? tn(sys.offers.length, "{n} offer", "{n} offers") : "",
    sys.products.length ? tn(sys.products.length, "{n} product", "{n} products") : "",
    sys.fonts.length ? tn(sys.fonts.length, "{n} font", "{n} fonts") : "",
    sys.facts?.length ? tn(sys.facts.length, "{n} fact", "{n} facts") : "",
    sys.voice.substitutions?.length || sys.voice.requiredPhrases?.length ? t("wording") : "",
  ].filter(Boolean);
  const claims = sys.voice.forbiddenClaims.filter((c) => c.trim()).length;
  const detail = moreDetailCount(sys);

  return (
    <div className="grid items-start gap-6 @4xl:grid-cols-[minmax(0,1fr)_minmax(300px,360px)]">
      <div className="grid min-w-0 gap-3">
        <NameBlock productId={productId} basics={basics} placeholder={placeholder} onChange={editBasics} onError={onError} />

        <Block title={t("Look")} hint={t("One paragraph that opens every image prompt.")} count={sys.look.promptModifier ? t("{n} chars", { n: sys.look.promptModifier.length }) : t("empty")}>
          <Text label={t("Prompt modifier")} hint={t("50–75 words: exact hexes, light direction, colour grade, surfaces, mood, hard rules.")} value={sys.look.promptModifier} onChange={(v) => editLook({ promptModifier: v })} area rows={4} max={900} />
        </Block>

        <Block title={t("Voice")} hint={t("How copy sounds, and what it must never say: QA rejects a creative that makes a forbidden claim.")}>
          <Text label={t("Voice in one line")} hint={t("Who's talking, to whom, and how.")} value={sys.voice.oneLine} onChange={(v) => editVoice({ oneLine: v })} area max={400} />
          <div className="grid gap-3 @xl:grid-cols-2">
            <ListField label={t("Words we never use")} value={sys.voice.avoid} onChange={(v) => editVoice({ avoid: v })} rows={4} />
            <ListField label={t("Forbidden claims")} hint={t("One per line ({n}/{max}). Never said or implied.", { n: claims, max: BRAND_SYSTEM_LIMITS.claims })}
              value={sys.voice.forbiddenClaims} onChange={(v) => editVoice({ forbiddenClaims: v })} rows={4} />
          </div>
        </Block>

        <Block title={t("Colours")} hint={t("Named, with roles. Prompts name them by role; posts, Recreate and Formats use primary and accent first.")} count={`${sys.palette.length}`}>
          {sys.palette.map((c: BrandColor, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <input type="color" aria-label={t("Pick a colour")} value={hexColor(c.hex) ?? "#000000"} onChange={(e) => editAt("palette", i, { hex: e.target.value.toUpperCase() })} className="size-7 shrink-0 cursor-pointer rounded-full border border-ink/10 bg-card p-0" />
              <input className={cx(inputClass, "w-28!")} value={c.hex} aria-label={t("Hex")} onChange={(e) => editAt("palette", i, { hex: e.target.value })} />
              <input className={cx(inputClass, "w-36!")} value={c.name} aria-label={t("Name")} placeholder={t("Name")} onChange={(e) => editAt("palette", i, { name: e.target.value })} />
              <select className={cx(inputClass, "w-32!")} value={c.role} aria-label={t("Role")} onChange={(e) => editAt("palette", i, { role: e.target.value as ColorRole })}>{ROLES.map((r) => <option key={r} value={r}>{t(ROLE_LABEL[r])}</option>)}</select>
              <input className={cx(inputClass, "min-w-40 flex-1")} value={c.use} aria-label={t("Use")} placeholder={t("What it's for")} onChange={(e) => editAt("palette", i, { use: e.target.value })} />
              <RemoveButton label={t("Remove {name}", { name: c.hex })} onClick={() => removeAt("palette", i)} />
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => addColour("")}>{t("Add a colour")}</Button>
            <IconColours iconUrl={basics.iconUrl} palette={sys.palette} onAdd={addColour} />
          </div>
        </Block>

        <Block title={t("Fonts")} hint={t("Composed ads set every line in these files (TTF, OTF or WOFF).")} count={t("{n}/{max} with files", { n: sys.fonts.filter((f) => f.url).length, max: sys.fonts.length })}>
          {sys.fonts.map((f: BrandFont, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <select className={cx(inputClass, "w-28!")} value={f.role} aria-label={t("Role")} onChange={(e) => editAt("fonts", i, { role: e.target.value as FontRole })}>{FONT_ROLES.map((r) => <option key={r} value={r}>{t(FONT_ROLE_LABEL[r])}</option>)}</select>
              <input className={cx(inputClass, "w-40!")} value={f.family} aria-label={t("Family")} onChange={(e) => editAt("fonts", i, { family: e.target.value })} />
              <input className={cx(inputClass, "w-20!")} type="number" step={100} min={100} max={900} value={f.weight} aria-label={t("Weight")} onChange={(e) => editAt("fonts", i, { weight: Number(e.target.value) })} />
              {f.url ? <Badge tone="win"><IconCheck className="mr-1 size-3" />{t("file")}</Badge> : <Badge tone="caution">{t("no file")}</Badge>}
              <label className="cursor-pointer text-xs text-accent hover:underline">
                {f.url ? t("Replace file") : t("Upload file")}
                <input type="file" accept=".ttf,.otf,.woff" className="hidden" onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  try { editAt("fonts", i, { url: await uploadFont(productId, file, t) }); } catch (err) { onError(err instanceof Error ? err.message : String(err)); }
                }} />
              </label>
              <RemoveButton label={t("Remove {name}", { name: f.family })} onClick={() => removeAt("fonts", i)} />
            </div>
          ))}
          <div><Button size="sm" variant="secondary" onClick={() => edit({ fonts: [...sys.fonts, { role: "headline", family: "", weight: 600, description: "" }] })}>{t("Add a font")}</Button></div>
        </Block>

        <Block title={t("Offers")} hint={t("The closed list: no creative may show any other price, discount, trial or code, and QA fails one that does.")} count={`${sys.offers.length}`}>
          {sys.offers.map((o: BrandOffer, i) => (
            <div key={o.id + i} className="grid gap-2 rounded-inner border border-line bg-raised p-3">
              <div className="flex items-center gap-2">
                <input className={cx(inputClass, "w-16! font-medium")} value={o.id} aria-label={t("Id")} onChange={(e) => editAt("offers", i, { id: e.target.value })} />
                <input className={cx(inputClass, "flex-1")} value={o.name} aria-label={t("Name")} placeholder={t("Free 7-day trial")} onChange={(e) => editAt("offers", i, { name: e.target.value })} />
                <RemoveButton label={t("Remove {name}", { name: o.id })} onClick={() => removeAt("offers", i)} />
              </div>
              <Text label={t("Exact wording allowed on a creative")} hint={t("Shown word for word, e.g. From $9.99/month.")} value={o.wording} onChange={(v) => editAt("offers", i, { wording: v })} max={160} />
              <Text label={t("Terms")} value={o.terms} onChange={(v) => editAt("offers", i, { terms: v })} area max={600} />
              <SourceField label={t("Where the price and wording were checked")} value={o.source} onChange={(v) => editAt("offers", i, { source: v })} />
            </div>
          ))}
          <div><Button size="sm" variant="secondary" onClick={() => edit({ offers: [...sys.offers, { id: `O${sys.offers.length + 1}`, name: "", wording: "", terms: "" }] })}>{t("Add an offer")}</Button></div>
        </Block>

        <Block title={t("Verified facts")} hint={t("The numbers a creative may show (a rating, a count, a comparison price), word for word. QA fails any other number that isn't an offer's wording.")} count={`${facts.length}`}>
          {facts.map((f: BrandFact, i) => (
            <div key={f.id + i} className="grid gap-2 rounded-inner border border-line bg-raised p-3">
              <div className="flex flex-wrap items-center gap-2">
                <input className={cx(inputClass, "w-48! font-medium")} value={f.label} aria-label={t("What it is")} placeholder={t("App Store rating")} onChange={(e) => editFact(i, { label: e.target.value })} />
                <input className={cx(inputClass, "min-w-48 flex-1")} value={f.value} aria-label={t("Exact wording")} placeholder={t("4.8★ · 2,000+ ratings")} maxLength={160} onChange={(e) => editFact(i, { value: e.target.value })} />
                <RemoveButton label={f.label ? t("Remove {name}", { name: f.label }) : t("Remove this fact")} onClick={() => edit({ facts: facts.filter((_, j) => j !== i) })} />
              </div>
              <SourceField value={f.source} onChange={(v) => editFact(i, { source: v ?? { kind: "manual" } })} />
            </div>
          ))}
          <div><Button size="sm" variant="secondary" disabled={facts.length >= BRAND_SYSTEM_LIMITS.facts} onClick={() => edit({ facts: [...facts, { id: `f${Date.now()}`, label: "", value: "", source: { kind: "manual" } }] })}>{t("Add a fact")}</Button></div>
        </Block>

        <Block title={t("Wording")} hint={t("Every prompt says “Say X, never Y”, and QA fails a creative or its copy that says Y (a former name works the same way: say your product’s name, never the old one). Required phrases must come with their word.")} count={`${substitutions.length + required.length}`}>
          <div className="grid gap-2">
            <span className="text-xs font-medium text-label">{t("Say this, never that")}</span>
            {substitutions.map((x: BrandSubstitution, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <input className={cx(inputClass, "w-44!")} value={x.avoid} aria-label={t("Never say")} placeholder={t("cheap")} maxLength={80} onChange={(e) => editSubstitution(i, { avoid: e.target.value })} />
                <span className="text-xs text-muted">→ {t("say")}</span>
                <input className={cx(inputClass, "w-52!")} value={x.use} aria-label={t("Say instead")} placeholder={t("affordable")} maxLength={120} onChange={(e) => editSubstitution(i, { use: e.target.value })} />
                <input className={cx(inputClass, "min-w-40 flex-1")} value={x.note ?? ""} aria-label={t("Why")} placeholder={t("Why (optional)")} maxLength={200} onChange={(e) => editSubstitution(i, { note: e.target.value })} />
                <RemoveButton label={x.avoid ? t("Remove {name}", { name: x.avoid }) : t("Remove this rule")} onClick={() => editVoice({ substitutions: substitutions.filter((_, j) => j !== i) })} />
              </div>
            ))}
            <div><Button size="sm" variant="secondary" disabled={substitutions.length >= BRAND_SYSTEM_LIMITS.substitutions} onClick={() => editVoice({ substitutions: [...substitutions, { avoid: "", use: "" }] })}>{t("Add a substitution")}</Button></div>
          </div>
          <div className="grid gap-2">
            <span className="text-xs font-medium text-label">{t("Always say with it")}</span>
            {required.map((x: RequiredPhrase, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted">{t("When copy mentions")}</span>
                <input className={cx(inputClass, "w-44!")} value={x.when} aria-label={t("When copy mentions")} placeholder={t("free trial")} maxLength={80} onChange={(e) => editRequired(i, { when: e.target.value })} />
                <span className="text-xs text-muted">{t("also say")}</span>
                <input className={cx(inputClass, "min-w-48 flex-1")} value={x.phrase} aria-label={t("Also say")} placeholder={t("cancel anytime")} maxLength={200} onChange={(e) => editRequired(i, { phrase: e.target.value })} />
                <RemoveButton label={x.when ? t("Remove {name}", { name: x.when }) : t("Remove this rule")} onClick={() => editVoice({ requiredPhrases: required.filter((_, j) => j !== i) })} />
              </div>
            ))}
            <div><Button size="sm" variant="secondary" disabled={required.length >= BRAND_SYSTEM_LIMITS.requiredPhrases} onClick={() => editVoice({ requiredPhrases: [...required, { when: "", phrase: "" }] })}>{t("Add a required phrase")}</Button></div>
          </div>
        </Block>

        <Block title={t("Description disclaimers")} hint={t("What Meta's link description carries on every ad (written copy starts with these). Keep results disclaimers here, not on the image.")} count={`${(sys.descriptionDisclaimers ?? []).length}`}>
          <ListField label={t("Disclaimers")} hint={t("One per line, up to {n}. AI-made ads add \"AI-generated imagery.\" on their own.", { n: BRAND_SYSTEM_LIMITS.disclaimers })} value={sys.descriptionDisclaimers ?? []} onChange={(v) => edit({ descriptionDisclaimers: v })} />
        </Block>

        <Block title={t("Avatars")} hint={t("The people ads speak to. Variant 1 speaks to the first, variant 2 to the second, and so on.")} count={`${sys.avatars.length}`}>
          {sys.avatars.map((a: BrandAvatar, i) => (
            <details key={a.id + i} className="rounded-inner border border-line bg-raised" open={!a.name}>
              <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm">
                <span className="font-medium">{a.name || t("New avatar")}</span>
                <span className="min-w-0 truncate text-xs text-muted">{a.type}</span>
              </summary>
              <div className="grid gap-2 border-t border-line p-3">
                <div className="flex items-center gap-2">
                  <input className={cx(inputClass, "w-36! font-medium")} value={a.name} aria-label={t("Name")} placeholder={t("Name")} onChange={(e) => editAt("avatars", i, { name: e.target.value })} />
                  <input className={cx(inputClass, "flex-1")} value={a.type} aria-label={t("Type")} placeholder={t("The busy parent, 30–45")} onChange={(e) => editAt("avatars", i, { type: e.target.value })} />
                  <RemoveButton label={a.name ? t("Remove {name}", { name: a.name }) : t("Remove this avatar")} onClick={() => removeAt("avatars", i)} />
                </div>
                <Text label={t("A moment")} value={a.moment} onChange={(v) => editAt("avatars", i, { moment: v })} area max={600} />
                <ListField label={t("Their words (used verbatim)")} value={a.painWords} onChange={(v) => editAt("avatars", i, { painWords: v })} />
                <div className="grid gap-2 @xl:grid-cols-2">
                  <Text label={t("Wants")} value={a.wants} onChange={(v) => editAt("avatars", i, { wants: v })} area max={400} />
                  <Text label={t("Emotional driver")} value={a.driver} onChange={(v) => editAt("avatars", i, { driver: v })} area max={300} />
                </div>
                <Text label={t("Ad point of view")} hint={t("What an ad for them leads with and proves first.")} value={a.pov} onChange={(v) => editAt("avatars", i, { pov: v })} area max={400} />
                <ListField label={t("Objections")} hint={t("One per line: doubt → answer.")} value={a.objections.map((o) => `${o.doubt} → ${o.answer}`)}
                  onChange={(v) => editAt("avatars", i, { objections: v.map((l) => { const [doubt, ...rest] = l.split("→"); return { doubt: doubt.trim(), answer: rest.join("→").trim() }; }) })} />
              </div>
            </details>
          ))}
          <div><Button size="sm" variant="secondary" onClick={() => edit({ avatars: [...sys.avatars, { id: `a${Date.now()}`, name: "", type: "", moment: "", painWords: [], wants: "", objections: [], driver: "", pov: "" }] })}>{t("Add an avatar")}</Button></div>
        </Block>

        <details className="group/more mt-2">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-1 py-1 text-sm text-label hover:text-ink">
            <span className="transition group-open/more:rotate-90">›</span>
            <span className="font-medium">{t("More detail")}</span>
            <span className="text-xs text-muted">{detail ? `${tn(detail, "{n} field filled", "{n} fields filled")} · ` : ""}{t("look and voice details, offer rules, products, positioning")}</span>
          </summary>
          <div className="mt-3 grid gap-3">
            <Section title={t("Look details")} hint={t("Art direction beyond the prompt modifier.")} count={countFilled([sys.look.lighting, sys.look.grade, sys.look.composition, sys.look.surfaces, sys.look.subjects, sys.look.mood, sys.look.packaging, sys.look.textOnImage, sys.look.offerStyle])}>
              <div className="grid gap-3 @xl:grid-cols-2">
                <Text label={t("Lighting")} value={sys.look.lighting} onChange={(v) => editLook({ lighting: v })} max={400} />
                <Text label={t("Colour grade")} value={sys.look.grade} onChange={(v) => editLook({ grade: v })} max={400} />
                <Text label={t("Composition")} value={sys.look.composition} onChange={(v) => editLook({ composition: v })} max={400} />
                <Text label={t("Surfaces")} value={sys.look.surfaces} onChange={(v) => editLook({ surfaces: v })} max={400} />
                <Text label={t("In frame")} value={sys.look.subjects} onChange={(v) => editLook({ subjects: v })} max={400} />
                <Text label={t("Mood")} value={sys.look.mood} onChange={(v) => editLook({ mood: v })} max={200} />
              </div>
              <Text label={t("Packaging and product")} hint={t("How the product must look (shape, finish, label, what makes it recognisable).")} value={sys.look.packaging} onChange={(v) => editLook({ packaging: v })} area max={800} />
              <div className="grid gap-3 @xl:grid-cols-2">
                <Text label={t("Text on images")} value={sys.look.textOnImage} onChange={(v) => editLook({ textOnImage: v })} area max={400} />
                <Text label={t("How offers are shown")} value={sys.look.offerStyle} onChange={(v) => editLook({ offerStyle: v })} area max={400} />
              </div>
            </Section>

            <Section title={t("Voice details")} hint={t("Rules, words to use, signature lines and examples.")} count={countFilled([sys.voice.rules, sys.voice.use, sys.voice.signatureLines, sys.voice.examples, sys.voice.dos, sys.voice.donts])}>
              <ListField label={t("Rules")} value={sys.voice.rules} onChange={(v) => editVoice({ rules: v })} rows={4} />
              <div className="grid gap-3 @xl:grid-cols-2">
                <ListField label={t("Words we use")} value={sys.voice.use} onChange={(v) => editVoice({ use: v })} rows={4} />
                <ListField label={t("Signature lines")} value={sys.voice.signatureLines} onChange={(v) => editVoice({ signatureLines: v })} rows={4} />
                <ListField label={t("Example copy")} value={sys.voice.examples} onChange={(v) => editVoice({ examples: v })} />
                <ListField label={t("Do")} value={sys.voice.dos} onChange={(v) => editVoice({ dos: v })} />
                <ListField label={t("Don't")} value={sys.voice.donts} onChange={(v) => editVoice({ donts: v })} />
              </div>
            </Section>

            <Section title={t("Offer rules")} hint={t("What's never offered, and how offers may be stacked and framed.")} count={countFilled([sys.notOffered, sys.offerRules])}>
              <div className="grid gap-3 @xl:grid-cols-2">
                <ListField label={t("We don't offer")} hint={t("Never shown (a free trial, discount codes…).")} value={sys.notOffered} onChange={(v) => edit({ notOffered: v })} />
                <ListField label={t("Stacking and framing rules")} value={sys.offerRules} onChange={(v) => edit({ offerRules: v })} />
              </div>
            </Section>

            <Section title={t("Products")} hint={t("Facts copy may cite word for word when a brief names the product, and how each looks.")} count={`${sys.products.length}`}>
              {sys.products.map((p: BrandProduct, i) => (
                <details key={p.slug + i} className="rounded-inner border border-line bg-raised">
                  <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm">
                    {p.accent && <span className="size-3.5 shrink-0 rounded-full border border-ink/10" style={{ background: p.accent }} />}
                    <span className="font-medium">{p.name || t("Untitled")}</span>
                    <span className="truncate text-xs text-muted">{p.category}{p.assetIds.length ? ` · ${tn(p.assetIds.length, "{n} image", "{n} images")}` : ""}</span>
                  </summary>
                  <div className="grid gap-2 border-t border-line p-3">
                    <div className="grid gap-2 @xl:grid-cols-3">
                      <Text label={t("Name")} value={p.name} onChange={(v) => editAt("products", i, { name: v })} max={80} />
                      <Text label={t("Category")} value={p.category} onChange={(v) => editAt("products", i, { category: v })} max={80} />
                      <Text label={t("Accent colour")} value={p.accent} onChange={(v) => editAt("products", i, { accent: v })} max={9} />
                    </div>
                    <Text label={t("Description")} value={p.description} onChange={(v) => editAt("products", i, { description: v })} area max={600} />
                    <ListField label={t("Claims (only these, as written)")} value={p.claims} onChange={(v) => editAt("products", i, { claims: v })} />
                    <div className="grid gap-2 @xl:grid-cols-2">
                      <ListField label={t("For")} value={p.uses} onChange={(v) => editAt("products", i, { uses: v })} />
                      <ListField label={t("Warnings")} value={p.warnings} onChange={(v) => editAt("products", i, { warnings: v })} />
                    </div>
                    <div className="grid gap-2 @xl:grid-cols-3">
                      <Text label={t("Results")} value={p.results} onChange={(v) => editAt("products", i, { results: v })} max={400} />
                      <Text label={t("Price")} value={p.price} onChange={(v) => editAt("products", i, { price: v })} max={80} />
                      <Text label={t("Size")} value={p.size} onChange={(v) => editAt("products", i, { size: v })} max={40} />
                    </div>
                    {p.price && <SourceField label={t("Where the price was checked")} value={p.priceSource} onChange={(v) => editAt("products", i, { priceSource: v })} />}
                    <div className="flex justify-end"><Button size="sm" variant="ghost" onClick={() => removeAt("products", i)}>{t("Remove this product")}</Button></div>
                  </div>
                </details>
              ))}
              <div><Button size="sm" variant="secondary" onClick={() => edit({ products: [...sys.products, { slug: `p${Date.now()}`, name: "", category: "", description: "", claims: [], uses: [], results: "", warnings: [], price: "", size: "", accent: "", assetIds: [] }] })}>{t("Add a product")}</Button></div>
            </Section>

            <Section title={t("Positioning details")} hint={t("What the brand stands for and against; Recreate and the format library use it for angles.")} count={countFilled([sys.positioning.counterPosition, sys.positioning.valueProposition, sys.positioning.standsAgainst])}>
              <Text label={t("Value proposition")} value={sys.positioning.valueProposition} onChange={(v) => edit({ positioning: { ...sys.positioning, valueProposition: v } })} area max={600} />
              <Text label={t("Counter-position")} value={sys.positioning.counterPosition} onChange={(v) => edit({ positioning: { ...sys.positioning, counterPosition: v } })} area max={600} />
              <Text label={t("Stands against")} value={sys.positioning.standsAgainst} onChange={(v) => edit({ positioning: { ...sys.positioning, standsAgainst: v } })} area max={600} />
            </Section>
          </div>
        </details>
      </div>

      <Card className="grid gap-2 p-3 @4xl:sticky @4xl:top-14">
        <p className="text-sm font-medium">{t("What every image prompt gets")}</p>
        <p className="text-xs text-muted">{summary.length ? t("Using {list}.", { list: summary.join(", ") }) : t("Nothing yet.")} {t("Variant 1 shown; later variants speak to the next avatar.")}</p>
        <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-inner bg-raised p-3 font-mono text-xs leading-relaxed text-ink">{preview || t("Fill the Look and Voice to see what prompts receive.")}</pre>
        <p className="text-xs text-muted">
          {t("Kit colours: {list}.", { list: kitColors(sys.palette).join(", ") || t("none") })}{" "}
          {hasProfile
            ? tn(claims, "QA checks {n} forbidden claim, plus the AI profile's claims to avoid.", "QA checks {n} forbidden claims, plus the AI profile's claims to avoid.")
            : tn(claims, "QA checks {n} forbidden claim.", "QA checks {n} forbidden claims.")}
        </p>
        {dirty && <p className="text-xs text-caution-ink">{t("Unsaved changes.")}</p>}
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
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  async function setLogo(file?: File) {
    if (!file) return;
    setBusy(true);
    try { onChange({ iconUrl: await uploadBrandImage(productId, "icon", file, t) }); } catch (error) { onError(error instanceof Error ? error.message : String(error)); }
    setBusy(false);
  }
  return (
    <Block title={t("Name and positioning")} hint={t("How the app is named and described in ads.")}>
      <div className="grid gap-3 @xl:grid-cols-2">
        <Field label={t("Name")}><input className={inputClass} value={basics.appName} maxLength={80} placeholder={placeholder} onChange={(e) => onChange({ appName: e.target.value })} /></Field>
        <Field label={t("One-line positioning")} hint={t("What it does and for whom, as it would appear under the name.")}><input className={inputClass} value={basics.tagline} maxLength={160} placeholder={t("What the app does, in one line")} onChange={(e) => onChange({ tagline: e.target.value })} /></Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <WorkspaceIcon name={basics.appName || placeholder} url={basics.iconUrl || undefined} className="size-10 text-base" />
        <div className="grid gap-1">
          <span className="text-xs text-muted">{t("Logo (the app icon) · PNG, JPEG or WebP, up to 15 MB")}</span>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => input.current?.click()}>{busy && <Spinner />}{basics.iconUrl ? t("Replace logo") : t("Upload logo")}</Button>
            {basics.iconUrl && <Button size="sm" variant="ghost" disabled={busy} onClick={() => onChange({ iconUrl: "" })}>{t("Remove")}</Button>}
          </div>
        </div>
        <input ref={input} type="file" accept={IMAGE_TYPES.join(",")} hidden onChange={(e) => { void setLogo(e.target.files?.[0]); e.target.value = ""; }} />
      </div>
    </Block>
  );
}

/** Colours read from the logo that aren't in the palette yet, one click to add. */
function IconColours({ iconUrl, palette, onAdd }: { iconUrl: string; palette: BrandColor[]; onAdd: (hex: string) => void }) {
  const { t } = useT();
  const have = new Set(palette.map((c) => c.hex.toUpperCase()));
  const suggested = useIconPalette(iconUrl || undefined).filter((c) => !have.has(c));
  if (!suggested.length || palette.length >= BRAND_SYSTEM_LIMITS.palette) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted">{t("From the logo")}</span>
      {suggested.map((hex) => (
        <button key={hex} type="button" onClick={() => onAdd(hex)} className="flex items-center gap-1.5 rounded-full border border-dashed border-line px-1.5 py-0.5 text-xs transition hover:border-ink/40">
          <span className="size-4 rounded-full border border-ink/10" style={{ backgroundColor: hex }} /><span className="font-mono">+ {hex}</span>
        </button>
      ))}
    </div>
  );
}
