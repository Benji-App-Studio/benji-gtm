"use client";
// "Start from a format": the format library, inside the Studio. The app groups the winning ads and posts
// it found into formats (lib/server/formats.ts); picking one and an angle hands its recreate recipe
// (lib/formats/recreate.ts) to the form: brief, kind, placement and length. The angle that fits the
// format's winners best (pickAngle, by keyword overlap) is picked first. Cards are looked after here
// too: refresh them from the reports, see why one works and its examples, copy its prompt or CLI
// command, or remove it. Links open it with ?start=format (and &card=<id> for one format).
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useCached } from "@/lib/client-cache";
import { anglesFor, pickAngle } from "@/lib/formats/angles";
import { FAMILIES } from "@/lib/formats/families";
import { recreate } from "@/lib/formats/recreate";
import { CARD_PLATFORM_LABEL, type Angle, type AppContext, type CardPlatform, type FormatCardRow, type Recipe } from "@/lib/formats/types";
import { HOOK_LABEL } from "@/lib/types";
import { workspaceHref } from "@/lib/workspace-schema";
import { ask, notice } from "../dialog";
import { CopyButton, PolicyNote } from "../recreate-panel";
import { Badge, Button, ButtonLink, cx, fmt, inputClass, Spinner } from "../ui";
import { useT } from "@/lib/i18n/client";
import { m, type Translator } from "@/lib/i18n/translate";

interface Library { app?: AppContext; cards?: FormatCardRow[]; stored?: boolean; error?: string }

/** What a format start hands the form: the card (its id when stored) and its recipe at the chosen angle. */
export interface FormatPick { card: FormatCardRow; recipe: Recipe }

/** What a person has to confirm before running a recipe, in plain words (keyed by the recipe's rule ids). */
const HUMAN_CHECK: Record<string, string> = {
  "PR-2": m("The person on camera really is who the ad says (the real founder, never an AI presenter posing as one)."),
  "PR-3": m("Every review quote is real and you have it on file."),
  "NH-1": m("Nothing in it reads as a medical claim."),
  "NH-2": m("No result is promised."),
  "NH-4": m("It shows the product's own screens, never faces or bodies, and shames no one."),
};

type T = Translator["t"];
const hookName = (id: string | null, t: T) => (id ? t(HOOK_LABEL[id] ?? id.replace(/_/g, " ")) : t("Other"));
const platformName = (id: string, t: T) => t(CARD_PLATFORM_LABEL[id as CardPlatform] ?? id);
/** A card's recipe at an angle; without one, at the angle that fits its winners best. Its notes are in the reader's language. */
const pickOf = (card: FormatCardRow, app: AppContext, angles: Angle[], angleId: string | null, t: T): FormatPick =>
  ({ card, recipe: recreate(card, app, { angleId: angleId ?? (angles.length ? pickAngle(card, angles).id : undefined), t }) });
const cardLabel = (c: FormatCardRow, t: Translator) => [c.formatName, t.t("{hook} hook", { hook: hookName(c.hookType, t.t) }), t.tn(c.evidence.examples, "{n} example", "{n} examples")].join(" · ");

export function FormatStart({ productId, initialCardId, onPick }: { productId: string; initialCardId?: string | null; onPick: (pick: FormatPick | null) => void }) {
  const tr = useT();
  const { t, tn } = tr;
  const url = `/api/w/${productId}/formats`;
  const [data, reload] = useCached<Library>(url);
  const [cardId, setCardId] = useState(initialCardId ?? "");
  const [angleId, setAngleId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const app = data?.app;
  const cards = useMemo(() => [...(data?.cards ?? [])].sort((a, b) => b.rank - a.rank), [data]);
  const angles = useMemo(() => (app ? anglesFor(app) : []), [app]);
  const card = cards.find((c) => c.id === cardId) ?? null;
  const best = useMemo(() => (card && angles.length ? pickAngle(card, angles) : null), [card, angles]);
  const recipe = useMemo(() => (card && app ? recreate(card, app, { angleId: angleId ?? best?.id, t }) : null), [card, app, angleId, best, t]);

  /** Picks a card (and an angle; none = the best fit) and hands its recipe to the form. */
  const choose = (nextCardId: string, nextAngleId: string | null) => {
    setCardId(nextCardId);
    setAngleId(nextAngleId);
    const next = cards.find((c) => c.id === nextCardId);
    onPick(next && app ? pickOf(next, app, angles, nextAngleId, t) : null);
  };
  // A link's card (?card=<id>, already shown as picked): its recipe goes to the form once, when the library arrives.
  const linked = useRef(false);
  useEffect(() => {
    if (linked.current || !initialCardId || !app || !cards.length) return;
    linked.current = true;
    const next = cards.find((c) => c.id === initialCardId);
    if (next) onPick(pickOf(next, app, angles, null, t));
  }, [initialCardId, app, cards, angles, onPick, t]);

  async function refresh() {
    setBusy(true);
    const response = await fetch(url, { method: "POST" }).catch(() => null);
    const body = await response?.json().catch(() => ({})) ?? {};
    setBusy(false);
    if (!response?.ok) return notice(body.error ?? t("Couldn't refresh the formats."));
    await reload();
  }

  async function remove(target: FormatCardRow) {
    if (!(await ask({ title: t("Remove this format?"), body: target.source === "paid" ? t("The card goes; the ads it came from stay in Research, where you can send them to the format library again.") : t("The card goes. Refreshing from reports won't bring it back."), confirm: t("Remove"), danger: true }))) return;
    const response = await fetch(`/api/w/${productId}/formats/${target.id}`, { method: "DELETE" }).catch(() => null);
    if (!response?.ok) return notice((await response?.json().catch(() => null))?.error ?? t("Couldn't remove it. Try again."), t("Not removed"));
    choose("", null);
    reload();
  }

  if (data?.error) return <p className="text-sm text-warn">{data.error}</p>;
  if (!data) return <div className="grid gap-2"><span className="skeleton h-7 w-full" /><span className="skeleton h-16 w-full" /></div>;
  const groups = (["paid", "organic"] as const).map((source) => ({ source, list: cards.filter((c) => c.source === source) })).filter((g) => g.list.length);

  return (
    <div className="grid gap-3">
      {cards.length === 0 ? (
        <div className="grid justify-items-start gap-2 text-sm text-muted">
          <p>{t("No formats yet. They come from your competitors' ads in Research (Send to format library) and from competitor analyses; add some, then refresh.")}</p>
          <div className="flex flex-wrap gap-2">
            <ButtonLink size="sm" variant="secondary" href={workspaceHref(productId, "research")}>{t("Open Research")}</ButtonLink>
            <Button size="sm" variant="ghost" onClick={refresh} disabled={busy}>{busy && <Spinner />}{t("Refresh from reports")}</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="text-xs font-medium text-muted">{t("Format")}</span>
            <select className={inputClass} value={cardId} onChange={(e) => choose(e.target.value, null)}>
              <option value="">{tn(cards.length, "Pick one of {n} format", "Pick one of {n} formats")}</option>
              {groups.map((g) => (
                <optgroup key={g.source} label={g.source === "paid" ? t("From paid ads") : t("From organic posts")}>
                  {g.list.map((c) => <option key={c.id} value={c.id}>{cardLabel(c, tr)}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
          <Button size="sm" variant="ghost" onClick={refresh} disabled={busy} title={t("Rebuild the formats from this product's latest reports")}>{busy && <Spinner />}{t("Refresh")}</Button>
        </div>
      )}
      {data.stored === false && <p className="text-xs text-caution-ink">{t("These formats aren't saved yet, so a batch can't point back to the one it came from. Open setup and run the update to save them.")} <Link href="/setup" className="font-medium underline underline-offset-2">{t("Open setup")}</Link></p>}

      {card && recipe && (
        <div className="grid gap-3 rounded-inner border border-line bg-raised p-3 text-sm">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={card.source === "paid" ? "warn" : "neutral"}>{card.source === "paid" ? t("Paid ad") : t("Organic")}</Badge>
            {card.platforms.map((p) => <Badge key={p}>{platformName(p, t)}</Badge>)}
            <span className="text-xs text-muted">{t(FAMILIES[card.family]?.label ?? card.family)} · {t("makes {model}", { model: recipe.duration ? `${recipe.modelLabel}, ${recipe.duration}s` : recipe.modelLabel })} · {recipe.aspectRatio}</span>
          </div>
          <p><span className="font-medium">{t("Hook:")} </span>{card.hookPattern}</p>
          {angles.length > 1 && (
            <div className="grid gap-1.5">
              <span className="text-xs text-muted">{t("Angle: who it speaks to and the problem it solves. Changing it rewrites the brief.")}</span>
              <div className="flex flex-wrap gap-1.5">
                {angles.map((a) => (
                  <button key={a.id} type="button" aria-pressed={recipe.angle.id === a.id} onClick={() => choose(card.id, a.id)}
                    className={cx("h-6 rounded-full border px-2.5 text-xs transition-colors", recipe.angle.id === a.id ? "border-hairline bg-control font-medium text-ink" : "border-transparent text-muted hover:bg-hover hover:text-ink")}>
                    {t(a.label)}{best?.id === a.id ? ` · ${t("best fit")}` : ""}
                  </button>
                ))}
              </div>
            </div>
          )}
          {!recipe.checks.ok && <div className="grid gap-1 text-xs text-warn"><Badge tone="warn">{t("Fix in the brief before you create")}</Badge>{recipe.checks.issues.map((i) => <p key={i}>{i}</p>)}</div>}
          {recipe.needsHuman.length > 0 && <div className="grid gap-1 text-xs text-muted"><p><Badge tone="caution">{t("Check it yourself")}</Badge> {t("Before you run it, make sure:")}</p><ul className="grid gap-0.5 pl-1">{recipe.needsHuman.map((rule) => <li key={rule}>· {HUMAN_CHECK[rule] ? t(HUMAN_CHECK[rule]) : t("It follows rule {rule}.", { rule })}</li>)}</ul></div>}
          {!card.persisted && <p className="text-xs text-muted">{t("This format isn't saved, so the batch won't point back to it.")}</p>}

          <details className="group text-xs">
            <summary className="w-fit cursor-pointer list-none text-muted hover:text-ink">{t("Why it works, examples and the recipe")} <span aria-hidden className="inline-block transition-transform group-open:rotate-90">›</span></summary>
            <div className="mt-2 grid gap-3">
              <ul className="grid gap-1">{card.why.map((w) => <li key={w} className="flex gap-2"><span className="mt-1.5 size-1 shrink-0 rounded-full bg-accent" />{w}</li>)}</ul>
              <div className="flex flex-wrap gap-1">
                {card.evidence.medianViews != null && <Badge>{t("{views} typical views", { views: fmt(card.evidence.medianViews) })}</Badge>}
                <Badge>{t("best score {score}", { score: card.evidence.bestScore })}</Badge>
                {card.evidence.maxOutlier != null && card.evidence.maxOutlier >= 1.5 && <Badge tone="accent">{t("{x}× outlier", { x: card.evidence.maxOutlier.toFixed(1) })}</Badge>}
                {card.evidence.daysRunning != null && <Badge tone="warn">{tn(card.evidence.daysRunning, "{n} day running", "{n} days running")}</Badge>}
              </div>
              <ul className="grid gap-1">
                {card.examples.slice(0, 5).map((ex) => (
                  <li key={ex.id}><a href={ex.url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">{ex.account} · {platformName(ex.platform, t)}</a> <span className="text-muted">“{ex.hook}”{ex.views != null ? ` · ${t("{views} views", { views: fmt(ex.views) })}` : ""}</span></li>
                ))}
              </ul>
              <p className="text-muted"><span className="font-medium text-ink">{t("Why this model:")} </span>{recipe.why}</p>
              {recipe.notes.map((n) => <p key={n} className="text-muted">{n}</p>)}
              <div className="flex flex-wrap items-center gap-1.5">
                <CopyButton text={recipe.prompt} label={t("Copy prompt")} />
                <CopyButton text={recipe.cli} label={t("Copy CLI command")} />
                {recipe.postCopy && <CopyButton text={recipe.postCopy} label={t("Copy post copy")} />}
                <CopyButton text={recipe.caption} label={t("Copy caption")} />
                {card.persisted && <Button size="sm" variant="ghost" onClick={() => remove(card)}>{t("Remove this format")}</Button>}
              </div>
              <PolicyNote />
            </div>
          </details>
        </div>
      )}
    </div>
  );
}
