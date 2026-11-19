"use client";
// Step 4 of "Send to Meta": the creatives and their ads. One ad per creative (single image or video),
// or, with two or more picked, one carousel or one ad with a version per placement (for example a 4:5
// for feeds and a 9:16 for Stories and Reels of the same concept). The Page and Instagram account,
// the copy, the button, the link, and the AI disclosure, which the person must pick (no default).
import type { ApprovedCreative } from "@/lib/creatives";
import { type AdFormat, type AdSpec, type AiDisclosure, CTA_LABEL, ctasFor, FEEDS_RULE, type MetaObjective, VERTICAL_RULE } from "@/lib/launch/rules";
import type { Connections } from "@/lib/launch/send";
import { cx, inputClass, Segmented, Toggle } from "../ui";
import { Choice, Group, Labeled, MoreOptions } from "./send-parts";

const URL_TAGS_HINT = (objective: MetaObjective) => objective === "OUTCOME_APP_PROMOTION"
  ? "Optional tags added to the link."
  : "Empty: Launch adds UTM tags with the campaign, ad set and ad names, so analytics see the naming convention.";

type Role = "fallback" | "feeds" | "vertical";
const ROLE_LABEL: Record<Role, string> = { fallback: "Everywhere else (fallback)", feeds: "Feeds (4:5 or 1:1)", vertical: "Stories and Reels (9:16)" };

export interface AdDraft {
  format: AdFormat;
  pageId: string;
  instagramId: string;
  primaryText: string;
  headline: string;
  description: string;
  cta: string;
  link: string;
  displayLink: string;
  urlTags: string;
  advantageCreative: boolean;
  aiDisclosure: AiDisclosure | null;
  /** Single format with several creatives: use each creative's own approved headline and text. */
  ownCopy: boolean;
  cards: Record<string, { headline?: string; description?: string; link?: string }>;
  placements: Record<string, Role>;
}

/** A creative's role when none was picked: the first is the fallback, then 9:16 → Stories and Reels, the rest → feeds. */
const roleOf = (ad: AdDraft, id: string, index: number, aspect?: string): Role => ad.placements[id] ?? (index === 0 ? "fallback" : aspect === "9:16" ? "vertical" : "feeds");

export function toAdSpec(ad: AdDraft, picked: string[], approved: ApprovedCreative[]): AdSpec {
  const byId = new Map(approved.map((c) => [c.id, c]));
  const creatives = picked.flatMap((id) => (byId.get(id) ? [{ id, kind: byId.get(id)!.kind, aspect: byId.get(id)!.aspect }] : []));
  return {
    format: ad.format, creatives, pageId: ad.pageId, instagramId: ad.instagramId || null,
    primaryText: ad.primaryText, headline: ad.headline, description: ad.description || null, cta: ad.cta, link: ad.link,
    displayLink: ad.displayLink || null, urlTags: ad.urlTags || null, advantageCreative: ad.advantageCreative, aiDisclosure: ad.aiDisclosure,
    cards: ad.format === "carousel" ? creatives.map((c) => ({ creativeId: c.id, ...ad.cards[c.id] })) : undefined,
    placements: ad.format === "placements"
      ? creatives.map((c, i) => { const role = roleOf(ad, c.id, i, c.aspect); return { creativeId: c.id, rule: role === "fallback" ? null : role === "feeds" ? FEEDS_RULE : VERTICAL_RULE }; })
      : undefined,
    perCreative: ad.format === "single" && ad.ownCopy
      ? Object.fromEntries(creatives.map((c) => [c.id, { primaryText: byId.get(c.id)?.primaryText || undefined, headline: byId.get(c.id)?.headline || undefined, description: byId.get(c.id)?.description || undefined }]))
      : undefined,
  };
}

export function AdStep({ value: ad, onChange, objective, approved, picked, onPicked, connections }: {
  value: AdDraft; onChange: (a: AdDraft) => void; objective: MetaObjective; approved: ApprovedCreative[]; picked: string[]; onPicked: (ids: string[]) => void; connections: Connections | null;
}) {
  const set = (patch: Partial<AdDraft>) => onChange({ ...ad, ...patch });
  const byId = new Map(approved.map((c) => [c.id, c]));
  const chosen = picked.map((id) => byId.get(id)).filter(Boolean) as ApprovedCreative[];
  const toggle = (c: ApprovedCreative) => {
    const next = picked.includes(c.id) ? picked.filter((x) => x !== c.id) : [...picked, c.id];
    onPicked(next);
    if (next.length < 2 && ad.format !== "single") set({ format: "single" });
    // The first pick fills empty copy from the creative's approved copy.
    // A model-made creative starts as "made with AI" (the person can still change it).
    if (!picked.length && next.length === 1) {
      set({
        primaryText: ad.primaryText || c.primaryText || "", headline: ad.headline || c.headline || "", description: ad.description || c.description || "", format: "single",
        ...(ad.aiDisclosure === null && c.aiGenerated ? { aiDisclosure: "OPT_IN" as const } : {}),
      });
    } else if (!picked.includes(c.id) && c.aiGenerated && ad.aiDisclosure === null) set({ aiDisclosure: "OPT_IN" });
  };
  const move = (id: string, by: number) => {
    const i = picked.indexOf(id);
    const j = i + by;
    if (j < 0 || j >= picked.length) return;
    const next = [...picked];
    [next[i], next[j]] = [next[j], next[i]];
    onPicked(next);
  };
  const pages = connections?.pages ?? (ad.pageId ? [{ id: ad.pageId, name: `Page ${ad.pageId}` }] : []);
  const instagram = connections?.instagram ?? (ad.instagramId ? [{ id: ad.instagramId, username: ad.instagramId, source: "account" as const }] : []);

  return (
    <div className="grid gap-4">
      <Group title="Creatives" hint={`${picked.length} picked · only approved creatives with a passing QA can be sent`}>
        {approved.length === 0 ? <p className="text-sm text-muted">No approved creatives yet. Approve some in the Studio first.</p> : (
          <ul className="grid max-h-80 grid-cols-3 gap-2 overflow-y-auto pr-1 @md:grid-cols-5 @2xl:grid-cols-6">
            {approved.map((c) => {
              const on = picked.includes(c.id);
              return (
                <li key={c.id}>
                  <button type="button" onClick={() => toggle(c)} aria-pressed={on} title={c.title ?? c.headline ?? c.id}
                    className={cx("relative block w-full overflow-hidden rounded-inner border bg-canvas text-left", on ? "border-accent ring-2 ring-accent/40" : "border-line hover:border-ink/40")}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={c.thumbnailUrl ?? c.url} alt="" loading="lazy" className="aspect-[4/5] w-full object-cover" />
                    <span className="absolute top-1 left-1 grid size-5 place-items-center rounded-full border border-line bg-card/90 text-[11px]">{on ? picked.indexOf(c.id) + 1 : ""}</span>
                    <span className="absolute right-1 bottom-1 rounded bg-scrim/60 px-1 text-[10px] text-white">{c.kind === "video" ? "▶ " : ""}{c.aspect}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Group>

      <Group title="Format">
        <Segmented label="Format" value={ad.format} onChange={(f) => picked.length >= 2 || f === "single" ? set({ format: f }) : undefined} options={[
          { value: "single", label: picked.length > 1 ? `${picked.length} single ads` : "Single image or video" },
          { value: "carousel", label: "Carousel" },
          { value: "placements", label: "One ad, a version per placement" },
        ]} />
        <p className="text-xs text-muted">
          {ad.format === "single" ? "Each creative becomes its own ad, so Meta can find the winner. Videos use Meta's thumbnail (or the creative's cover)."
            : ad.format === "carousel" ? "One ad with 2–10 cards people swipe through, each with its own headline and link. Good for showing several features."
            : "One ad, with the best-fitting version in each placement: for example a 4:5 for feeds and a 9:16 for Stories and Reels. Exactly one version is the fallback."}
          {picked.length < 2 && ad.format === "single" && " Pick two or more creatives for a carousel or placement versions."}
        </p>
        {ad.format === "single" && picked.length > 1 && (
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ad.ownCopy} onChange={(e) => set({ ownCopy: e.target.checked })} className="accent-[var(--color-accent)]" />Use each creative’s own approved headline and text (the copy below fills any gaps)</label>
        )}
        {ad.format === "carousel" && (
          <ol className="grid gap-2">
            {chosen.map((c, i) => (
              <li key={c.id} className="grid gap-2 rounded-inner border border-line p-2.5 @lg:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)_auto]">
                <span className="text-xs font-medium text-muted">Card {i + 1}</span>
                <input className={inputClass} aria-label={`Card ${i + 1} headline`} placeholder={`Headline (${ad.headline || "shared"})`} value={ad.cards[c.id]?.headline ?? ""} maxLength={255}
                  onChange={(e) => set({ cards: { ...ad.cards, [c.id]: { ...ad.cards[c.id], headline: e.target.value || undefined } } })} />
                <input className={inputClass} aria-label={`Card ${i + 1} link`} placeholder="Link (shared if empty)" value={ad.cards[c.id]?.link ?? ""}
                  onChange={(e) => set({ cards: { ...ad.cards, [c.id]: { ...ad.cards[c.id], link: e.target.value || undefined } } })} />
                <span className="flex gap-1">
                  <button type="button" className="rounded px-1.5 text-muted hover:bg-hover" aria-label="Move up" onClick={() => move(c.id, -1)}>↑</button>
                  <button type="button" className="rounded px-1.5 text-muted hover:bg-hover" aria-label="Move down" onClick={() => move(c.id, 1)}>↓</button>
                </span>
              </li>
            ))}
          </ol>
        )}
        {ad.format === "placements" && (
          <ul className="grid gap-2">
            {chosen.map((c, i) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 rounded-inner border border-line p-2.5 text-sm">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={c.thumbnailUrl ?? c.url} alt="" className="h-12 w-10 rounded object-cover" />
                <span className="min-w-0 flex-1 truncate">{c.title ?? c.headline ?? c.id} <span className="text-xs text-muted">· {c.aspect}</span></span>
                <select className={cx(inputClass, "max-w-fit")} value={roleOf(ad, c.id, i, c.aspect)} onChange={(e) => set({ placements: { ...ad.placements, [c.id]: e.target.value as Role } })}>
                  {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                </select>
              </li>
            ))}
          </ul>
        )}
      </Group>

      <Group title="Who it's from">
        <div className="grid gap-3 @lg:grid-cols-2">
          <Labeled label="Facebook Page" hint={connections?.errors.pages ?? "The ads run from this Page."}>
            <select className={inputClass} value={ad.pageId} onChange={(e) => {
              const page = connections?.pages.find((p) => p.id === e.target.value);
              set({ pageId: e.target.value, instagramId: ad.instagramId || page?.instagram?.id || "" });
            }}>
              <option value="">Pick…</option>
              {pages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Labeled>
          <Labeled label="Instagram account" hint={ad.instagramId ? "Instagram placements show this account." : "Without one, the ads don't run on Instagram."}>
            <select className={inputClass} value={ad.instagramId} onChange={(e) => set({ instagramId: e.target.value })}>
              <option value="">None (Facebook only)</option>
              {instagram.map((i) => <option key={i.id} value={i.id}>@{i.username}{i.source === "page" ? " (from the Page)" : ""}</option>)}
            </select>
          </Labeled>
        </div>
      </Group>

      <Group title="Copy">
        <Labeled label={<>Primary text <span className="font-normal text-muted">({ad.primaryText.length}/125 before “more”; Reels show about 40)</span></>}>
          <textarea rows={3} className={inputClass} maxLength={2000} value={ad.primaryText} onChange={(e) => set({ primaryText: e.target.value })} />
        </Labeled>
        <div className="grid gap-3 @lg:grid-cols-2">
          <Labeled label={<>Headline <span className="font-normal text-muted">({ad.headline.length}/40)</span></>}>
            <input className={inputClass} maxLength={255} value={ad.headline} onChange={(e) => set({ headline: e.target.value })} />
          </Labeled>
          <Labeled label="Button" hint="Only the buttons this campaign's objective allows.">
            <select className={inputClass} value={ad.cta} onChange={(e) => set({ cta: e.target.value })}>
              {ctasFor(objective).map((c) => <option key={c} value={c}>{CTA_LABEL[c] ?? c}</option>)}
            </select>
          </Labeled>
        </div>
        <Labeled label="Link" hint={objective === "OUTCOME_APP_PROMOTION" ? "The App Store page." : "Where the button sends people."}>
          <input className={inputClass} value={ad.link} onChange={(e) => set({ link: e.target.value })} placeholder="https://" />
        </Labeled>
        <Labeled label="Description" hint="Where disclaimers go (from the creative's copy). Instagram and single-media Facebook Feed ads don't show it.">
          <input className={inputClass} maxLength={255} value={ad.description} onChange={(e) => set({ description: e.target.value })} />
        </Labeled>
      </Group>

      <Group title="Made with AI?" hint="Meta asks advertisers to say whether the media was made or edited with AI; it may then show an “AI info” label where the law asks for it (the EU, India, Taiwan, California, New York).">
        <Choice name="ai" value={ad.aiDisclosure} onChange={(v) => set({ aiDisclosure: v })} options={[
          { value: "OPT_IN", label: "Yes, made or edited with AI", hint: chosen.some((c) => c.aiGenerated) ? "Preselected: a picked creative was made by a model (AI people or a generated scene)." : "Creatives made in the Studio are AI-generated, so this is usually the answer." },
          { value: "OPT_OUT", label: "No AI in this media" },
        ]} />
      </Group>

      <MoreOptions>
        <Labeled label="Display link" hint="A short domain shown on the ad, like acme.app. Not the destination.">
          <input className={inputClass} value={ad.displayLink} onChange={(e) => set({ displayLink: e.target.value })} placeholder="acme.app" />
        </Labeled>
        <Labeled label="URL parameters" hint={URL_TAGS_HINT(objective)}>
          <input className={inputClass} value={ad.urlTags} onChange={(e) => set({ urlTags: e.target.value })} placeholder="utm_source=meta&utm_medium=paid_social" />
        </Labeled>
        <label className="flex items-start gap-3 text-sm">
          <Toggle checked={ad.advantageCreative} onChange={(v) => set({ advantageCreative: v })} label="Advantage+ creative" />
          <span><span className="font-medium">Advantage+ creative</span><span className="block text-xs text-muted">Lets Meta touch up the media and rewrite text per person (brightness, animation, text variations). Off keeps each ad exactly as approved.</span></span>
        </label>
      </MoreOptions>
    </div>
  );
}
