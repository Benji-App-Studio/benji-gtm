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
import {
  COLLECTING_GUIDE, installSources, priceNote, pricePer100, PRICES_CHECKED, sourceKeys, SOURCES, type MetaActor, type ResolvedSources, type SourceId, type SourceInfo,
} from "@/lib/ad-sources";
import type { InstallResearch, InstallState } from "@/lib/install/types";
import { INSTALL_URL } from "@/lib/install/use-install";
import { DEFAULT_RESEARCH } from "@/lib/research-sources";
import { IconExternal } from "../icons";
import { Badge, Locked, Segmented, SettingsGroup, SettingsRow, Spinner, StatusPill } from "../ui";
import { api, ReadOnlyNote, SettingsPage, Status, WithInstall } from "./settings-ui";

type Choice = "auto" | "on" | "off";
const CHOICES: { value: Choice; label: string }[] = [{ value: "auto", label: "Auto" }, { value: "on", label: "On" }, { value: "off", label: "Off" }];
const ACTORS: { value: MetaActor; label: string }[] = [{ value: "community", label: "Community" }, { value: "official", label: "Apify's own" }];
/** "the Apify key", "the TikTok research client secret" (a label that already names a key or secret isn't doubled). */
const keyName = (label: string) => `the ${label}${/\b(key|secret|token)$/i.test(label) ? "" : " key"}`;
const choiceOf = (value: boolean | null): Choice => (value === null ? "auto" : value ? "on" : "off");
const CHECKED = new Date(`${PRICES_CHECKED}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

export function ResearchSourcesSettings() {
  return (
    <SettingsPage page="research">
      <WithInstall>
        {(install, manage) => (
          <>
            <ReadOnlyNote install={install} what="research sources" />
            <SourcesBody install={install} manage={manage} />
          </>
        )}
      </WithInstall>
    </SettingsPage>
  );
}

function SourcesBody({ install, manage }: { install: InstallState; manage: boolean }) {
  const research: InstallResearch = install.research ?? DEFAULT_RESEARCH;
  const resolved = installSources(install)!;
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ error?: string; ok?: string }>({});

  async function save(field: keyof InstallResearch, value: boolean | null | MetaActor, done: string) {
    setBusy(field); setNote({});
    const result = await api<InstallState>("/api/install/settings", "PATCH", { research: { [field]: value } });
    setBusy(null);
    if (!result.ok) return setNote({ error: result.error });
    prime(INSTALL_URL, result.data);
    // An older backend answers without `research`: the choice wasn't kept.
    if (!result.data.research) return setNote({ error: "Saved, but this copy's server doesn't know research sources yet. Update it (Settings > Updates), then choose again." });
    setNote({ ok: done });
  }

  const paid = SOURCES.filter((s) => !s.free);
  const free = SOURCES.filter((s) => s.free);
  const row = (s: SourceInfo) => (
    <SourceRow key={s.id} source={s} choice={choiceOf(research[s.id])} resolved={resolved} actor={research.metaActor} manage={manage} busy={busy === s.id}
      onChoose={(choice) => { void save(s.id, choice === "auto" ? null : choice === "on", `${s.label}: ${choice === "auto" ? "automatic" : choice}.`); }} />
  );

  return (
    <>
      <p className="-mt-6 text-sm text-muted">
        The free way needs no key: the Chrome extension saves a competitor&apos;s Meta ads as a file you drop on the Research page.
        These sources collect for you instead, with your own keys.{" "}
        <a href={repoFileUrl(COLLECTING_GUIDE)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-accent hover:underline">Which to choose<IconExternal className="size-3.5" /></a>
      </p>

      <SettingsGroup title="Through your Apify key" description={<>Billed per ad by Apify, from your Apify credit (the free plan includes $5 a month). Prices are from each collector&apos;s page on the Apify Store, checked on {CHECKED}. You see the most a collection can cost before it starts.</>}>
        {paid.map((s) => s.id === "metaApify"
          ? (
            <div key={s.id}>
              {row(s)}
              <SettingsRow className="border-t border-line" label="Meta collector" description={resolved.metaActorFromEnv
                ? "Set on the server (RESEARCH_META_APIFY_ACTOR), which wins over this choice."
                : `Community: ${pricePer100("metaApify", "community")}, the default. Apify's own: ${pricePer100("metaApify", "official")}, maintained by Apify; use it if the community one stops working.`}>
                {manage && !resolved.metaActorFromEnv
                  ? <Segmented label="Meta collector" options={ACTORS} value={research.metaActor} onChange={(value) => { void save("metaActor", value, `Meta ads now use ${value === "official" ? "Apify's own collector" : "the community collector"}.`); }} />
                  : <span className="text-sm text-label">{resolved.metaActor === "official" ? "Apify's own" : "Community"}</span>}
                {busy === "metaActor" && <Spinner className="size-3.5" />}
              </SettingsRow>
            </div>
          )
          : row(s))}
      </SettingsGroup>

      <SettingsGroup title="Free official APIs" description="No cost per ad, but each covers only part of the world, and their keys take an identity check or an application.">
        {free.map(row)}
      </SettingsGroup>

      <Status error={note.error} ok={note.ok} className="-mt-6" />
      <p className="-mt-6 text-xs text-muted">
        Auto turns a source on as soon as its key is saved in <Link href="/app/settings/keys" className="font-medium text-accent hover:underline">API keys</Link>, except TikTok&apos;s two paid sources, which stay off until you switch them on.
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
  return (
    <SettingsRow
      label={<span className="flex flex-wrap items-center gap-2">{s.label}<Badge tone={s.free ? "win" : "neutral"}>{pricePer100(s.id, actor)}</Badge></span>}
      description={s.covers}
      below={(
        <div className="mt-2 grid gap-1.5 text-xs text-muted">
          <p>
            Needs {keys.map((k, i) => (
              <span key={k.name}>{i > 0 && (i === keys.length - 1 ? " and " : ", ")}{k.guide
                ? <a href={repoFileUrl(k.guide)} target="_blank" rel="noreferrer" className="font-medium text-accent hover:underline">{keyName(k.label)}</a>
                : <>{keyName(k.label)}</>}</span>
            ))}. Finds a competitor by: {s.finds}.{note ? ` ${note}` : ""}
          </p>
          {fromEnv && <p className="text-caution-ink">Set on the server (RESEARCH_TIKTOK), which wins over the choice here until it is removed from the Supabase project&apos;s edge function secrets.</p>}
          {state.reason === "needs_key" && missing.length > 0 && <Locked href="/app/settings/keys" action="Add the key" className="w-fit">{choice === "on" ? "Switched on, but needs" : "Turns on once you add"} {missing.map((k) => k.label).join(" and ")}</Locked>}
        </div>
      )}>
      <StatusPill tone={state.on ? "win" : "neutral"}>{state.on ? "On" : state.reason === "needs_key" ? "Needs key" : "Off"}</StatusPill>
      {manage && !fromEnv && <Segmented label={`${s.label}: automatic, on or off`} options={CHOICES} value={choice} onChange={onChoose} />}
      {busy && <Spinner className="size-3.5" />}
    </SettingsRow>
  );
}
