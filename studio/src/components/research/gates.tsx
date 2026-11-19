"use client";
// "Connect X" states for the research side. A page asks `useLocked(feature)` and, when something is
// missing, shows one of these instead of starting the action and surfacing a backend error. While the
// install is loading, or can't be read, nothing is locked.
import Link from "next/link";
import { useSyncExternalStore, type ReactNode } from "react";
import { featureState, type Feature, type FeatureState } from "@/lib/capabilities";
import { useInstall } from "@/lib/install/use-install";
import type { WorkspaceConnections } from "@/lib/workspace-schema";
import { ConnectState, Locked } from "../ui";

type App = { id: string; connections?: WorkspaceConnections | null } | null;

/** What a feature still needs, or null when it's ready (or nothing is known yet). */
export function useLocked(feature: Feature, app?: App): FeatureState | null {
  const { install } = useInstall();
  const state = featureState(feature, install, app);
  return state.ok ? null : state;
}

/** The first of several features that isn't ready, or null. */
export function useFirstLocked(features: Feature[], app?: App): FeatureState | null {
  const { install } = useInstall();
  for (const feature of features) {
    const state = featureState(feature, install, app);
    if (!state.ok) return state;
  }
  return null;
}

const never = () => () => {};

/**
 * Several features a page can't start without. `locked` is the first that isn't ready and `also` the rest;
 * `checking` is true until the install has answered (and during the first render, which the server and the
 * browser must agree on): show a placeholder then, so a form never flashes before its locked state.
 */
export function useGate(features: Feature[], app?: App): { locked: FeatureState | null; also: FeatureState[]; checking: boolean } {
  const { install, loading } = useInstall();
  const hydrated = useSyncExternalStore(never, () => true, () => false);
  const missing = features.map((feature) => featureState(feature, install, app)).filter((state) => !state.ok);
  return { locked: missing[0] ?? null, also: missing.slice(1), checking: !hydrated || loading };
}

/** Inline: a small "needs X" with the link to where X is set. */
export function LockedNote({ state, children, className }: { state: FeatureState; children?: ReactNode; className?: string }) {
  return <Locked href={state.href} action={state.action} className={className}>{children ?? state.title}</Locked>;
}

/** Page-level: what to connect, where, and (optionally) another way to get there without it. */
export function ConnectFor({ state, also = [], otherwise, className }: { state: FeatureState; also?: FeatureState[]; otherwise?: ReactNode; className?: string }) {
  // The other keys the same page needs, so the second one isn't a surprise after the first is added.
  const more = also.filter((other) => other.missingKeys.length && other.title);
  return (
    <ConnectState className={className} title={state.title} href={state.href} action={state.action}
      body={<>
        {state.body}
        {more.map((other) => <span key={other.feature} className="mt-2 block">Also needed: {other.title.replace(/^Connect /, "")}.</span>)}
        {otherwise && <span className="mt-2 block">{otherwise}</span>}
      </>} />
  );
}

/** The free way to get ads in, as a sentence with its link: the Chrome extension's file, dropped on Research. */
export function FreeRoute({ productId }: { productId?: string | null }) {
  const where = productId
    ? <Link href={`/app/w/${productId}/research`} className="font-medium text-accent hover:underline">Research</Link>
    : "your app's Research page";
  return <>No key needed for paid ads: collect a competitor&apos;s ads with the Ad Library extension and import the file on {where}.</>;
}
