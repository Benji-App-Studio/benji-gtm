"use client";
// Settings → Research sources: where competitors' ads are collected from when someone clicks Collect ads
// on the Research page. Each source says what it covers in one line, what 100 ads cost (from the Apify
// Store, with the date), which key it needs (with that key's guide), and can be left on Auto (on as soon
// as its key is saved, except the two paid TikTok sources), switched on or switched off. Meta's source
// also picks the actor: the cheaper community one or Apify's own. Owner only; stored in
// install.settings.research through the install function. A switch set on the server wins, and says so.
import Link from "next/link";
import { useState } from "react";
import { repoFileUrl } from "@/lib/brand-config";
import { prime } from "@/lib/client-cache";
import { useT } from "@/lib/i18n/client";
import { researchText } from "../research/research-source-words";
import { sentenceGap } from "../rich";
import { m } from "@/lib/i18n/translate";
import {
  COLLECTING_GUIDE, installSources, priceNote, PRICES_CHECKED, sourceKeys, SOURCES, usd, type MetaActor, type ResolvedSources, type SourceId, type SourceInfo,
} from "@/lib/ad-sources";
import type { InstallResearch, InstallState } from "@/lib/install/types";
import { INSTALL_URL } from "@/lib/install/use-install";
import { DEFAULT_RESEARCH, metaPrice, PRICES } from "@/lib/research-sources";
import { IconExternal } from "../icons";
import { Badge, Locked, Segmented, SettingsGroup, SettingsRow, Spinner, StatusPill } from "../ui";
import { api, ReadOnlyNote, SettingsPage, Status, WithInstall } from "./settings-ui";

type Choice = "auto" | "on" | "off";
type T = ReturnType<typeof useT>["t"];
const CHOICES: { value: Choice; label: string }[] = [{ value: "auto", label: m("Auto") }, { value: "on", label: m("On") }, { value: "off", label: m("Off") }];
const ACTORS: { value: MetaActor; label: string }[] = [{ value: "community", label: m("Community") }, { value: "official", label: m("Apify's own") }];
// The price notes kept in lib/research-sources.ts (twinned with the edge function, so said here), with
// their amounts formatted like every other amount on the page ("US$0.20" in Chinese, not "0.20 美元").
const NOTES: Record<string, { text: string; prices: Record<string, number> }> = {
  "$0.34 per 100 on Apify's Business plan.": { text: m("{price} per 100 on Apify's Business plan."), prices: { price: 0.34 } },
  "$0.20 per 100 ads, plus $0.20 per 100 text ads for their words.": { text: m("{price} per 100 ads, plus {extra} per 100 text ads for their words."), prices: { price: 0.2, extra: 0.2 } },
  "Plus $0.005 per search.": { text: m("Plus {price} per search."), prices: { price: 0.005 } },
};
const sayNote = (note: string, t: T, intl: string) => {
  const known = NOTES[note];
  return known ? t(known.text, Object.fromEntries(Object.entries(known.prices).map(([k, v]) => [k, usd(v, t, intl)]))) : t(note);
};
/** "the Apify key", "the TikTok research client secret" (a label that already names a key or secret isn't doubled). */
const keyName = (label: string, t: T) => (/\b(key|secret|token)$/i.test(label) ? t("the {key}", { key: t(label) }) : t("the {name} key", { name: t(label) }));
const choiceOf = (value: boolean | null): Choice => (value === null ? "auto" : value ? "on" : "off");
const checkedOn = (intl: string) => new Date(`${PRICES_CHECKED}T12:00:00Z`).toLocaleDateString(intl, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
/** What 100 ads cost on a source ("$0.08 per 100 ads", "Free"). */
const per100 = (id: SourceId, actor: MetaActor, t: T, intl: string) => {
  const price = id === "metaApify" ? metaPrice(actor) : PRICES[id];
  return price.per100 ? t("{price} per 100 ads", { price: usd(price.per100, t, intl) }) : t("Free");
};

export function ResearchSourcesSettings() {
  const { t } = useT();
  return (
    <SettingsPage page="research">
      <WithInstall>
        {(install, manage) => (
          <>
            <ReadOnlyNote install={install} what={t("research sources")} />
            <SourcesBody install={install} manage={manage} />
          </>
        )}
      </WithInstall>
    </SettingsPage>
  );
}

function SourcesBody({ install, manage }: { install: InstallState; manage: boolean }) {
  const tr = useT();
  const { t, intl, locale } = tr;
  const gap = sentenceGap(locale);
  const research: InstallResearch = install.research ?? DEFAULT_RESEARCH;
  const resolved = installSources(install)!;
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ error?: string; ok?: string }>({});

  async function save(field: keyof InstallResearch, value: boolean | null | MetaActor, done: string) {
    setBusy(field); setNote({});
    const result = await api<InstallState>("/api/install/settings", "PATCH", { research: { [field]: value } });
    setBusy(null);
    if (!result.ok) return setNote({ error: researchText(result.error, tr) });
    prime(INSTALL_URL, result.data);
    // An older backend answers without `research`: the choice wasn't kept.
    if (!result.data.research) return setNote({ error: t("Saved, but this copy's server doesn't know research sources yet. Update it (Settings › Updates), then choose again.") });
    setNote({ ok: done });
  }

  const paid = SOURCES.filter((s) => !s.free);
  const free = SOURCES.filter((s) => s.free);
  const row = (s: SourceInfo) => (
    <SourceRow key={s.id} source={s} choice={choiceOf(research[s.id])} resolved={resolved} actor={research.metaActor} manage={manage} busy={busy === s.id}
      onChoose={(choice) => { void save(s.id, choice === "auto" ? null : choice === "on", choice === "auto" ? t("{source}: automatic.", { source: t(s.label) }) : choice === "on" ? t("{source}: on.", { source: t(s.label) }) : t("{source}: off.", { source: t(s.label) })); }} />
  );

  return (
    <>
      <p className="-mt-6 text-sm text-muted">
        {t("The free way needs no key: the Chrome extension saves a competitor's Meta ads as a file you drop on the Research page.")}{gap}
        {t("These sources collect for you instead, with your own keys.")}{gap}
        <a href={repoFileUrl(COLLECTING_GUIDE)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-accent hover:underline">{t("Which to choose")}<IconExternal className="size-3.5" /></a>
      </p>

      <SettingsGroup title={t("Through your Apify key")} description={t("Billed per ad by Apify, from your Apify credit (the free plan includes $5 a month). Prices are from each collector's page on the Apify Store, checked on {date}. You see the most a collection can cost before it starts.", { date: checkedOn(intl) })}>
        {paid.map((s) => s.id === "metaApify"
          ? (
            <div key={s.id}>
              {row(s)}
              <SettingsRow className="border-t border-line" label={t("Meta collector")} description={resolved.metaActorFromEnv
                ? t("Set on the server (RESEARCH_META_APIFY_ACTOR), which wins over this choice.")
                : t("Community: {community}, the default. Apify's own: {official}, maintained by Apify; use it if the community one stops working.", { community: per100("metaApify", "community", t, intl), official: per100("metaApify", "official", t, intl) })}>
                {manage && !resolved.metaActorFromEnv
                  ? <Segmented label={t("Meta collector")} options={ACTORS.map((a) => ({ value: a.value, label: t(a.label) }))} value={research.metaActor} onChange={(value) => { void save("metaActor", value, value === "official" ? t("Meta ads now use Apify's own collector.") : t("Meta ads now use the community collector.")); }} />
                  : <span className="text-sm text-label">{resolved.metaActor === "official" ? t("Apify's own") : t("Community")}</span>}
                {busy === "metaActor" && <Spinner className="size-3.5" />}
              </SettingsRow>
            </div>
          )
          : row(s))}
      </SettingsGroup>

      <SettingsGroup title={t("Free official APIs")} description={t("No cost per ad, but each covers only part of the world, and their keys take an identity check or an application.")}>
        {free.map(row)}
      </SettingsGroup>

      <Status error={note.error} ok={note.ok} className="-mt-6" />
      <p className="-mt-6 text-xs text-muted">
        {t("Auto turns a source on as soon as its key is saved in Your keys, except TikTok's two paid sources, which stay off until you switch them on.")}{gap}
        <Link href="/app/settings/keys" className="font-medium text-accent hover:underline">{t("Open your keys")}</Link>
      </p>
    </>
  );
}

function SourceRow({ source: s, choice, resolved, actor, manage, busy, onChoose }: {
  source: SourceInfo; choice: Choice; resolved: ResolvedSources; actor: MetaActor; manage: boolean; busy: boolean; onChoose: (choice: Choice) => void;
}) {
  const state = resolved.sources[s.id as SourceId];
  const keys = sourceKeys(s.id);
  const missing = keys.filter((k) => state.missingKeys.includes(k.name));
  const note = priceNote(s.id, actor);
  const fromEnv = state.reason === "environment";
  const { t, intl, locale } = useT();
  const gap = sentenceGap(locale);
  const list = (items: string[]) => new Intl.ListFormat(intl, { type: "conjunction" }).format(items);
  return (
    <SettingsRow
      label={<span className="flex flex-wrap items-center gap-2">{t(s.label)}<Badge tone={s.free ? "win" : "neutral"}>{per100(s.id, actor, t, intl)}</Badge></span>}
      description={t(s.covers)}
      below={(
        <div className="mt-2 grid gap-1.5 text-xs text-muted">
          <p>
            {t("Needs {keys}.", { keys: list(keys.map((k) => keyName(k.label, t))) })}{gap}{t("Finds a competitor by: {how}.", { how: t(s.finds) })}{note ? `${gap}${sayNote(note, t, intl)}` : ""}
            {keys.some((k) => k.guide) && <>{" "}{keys.filter((k) => k.guide).map((k) => (
              <a key={k.name} href={repoFileUrl(k.guide!)} target="_blank" rel="noreferrer" className="mr-2 inline-flex items-center gap-1 font-medium text-accent hover:underline">{t("{key} guide", { key: t(k.label) })}<IconExternal className="size-3" /></a>
            ))}</>}
          </p>
          {fromEnv && <p className="text-caution-ink">{t("Set on the server (RESEARCH_TIKTOK), which wins over the choice here until it is removed from the Supabase project's edge function secrets.")}</p>}
          {state.reason === "needs_key" && missing.length > 0 && <Locked href="/app/settings/keys" action={t("Add the key")} className="w-fit">{choice === "on" ? t("Switched on, but needs {keys}", { keys: list(missing.map((k) => t(k.label))) }) : t("Turns on once you add {keys}", { keys: list(missing.map((k) => t(k.label))) })}</Locked>}
        </div>
      )}>
      <StatusPill tone={state.on ? "win" : "neutral"}>{state.on ? t("On") : state.reason === "needs_key" ? t("Needs key") : t("Off")}</StatusPill>
      {manage && !fromEnv && <Segmented label={t("{source}: automatic, on or off", { source: t(s.label) })} options={CHOICES.map((c) => ({ value: c.value, label: t(c.label) }))} value={choice} onChange={onChoose} />}
      {busy && <Spinner className="size-3.5" />}
    </SettingsRow>
  );
}
