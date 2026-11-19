"use client";
// What Studio, Playground, Launch and Measure may do in this install: which features have their keys
// and, for the current app, its connections (lib/capabilities.ts). Pages ask `useFeatures(productId)` and
// draw a `Locked` or a `ConnectState` in place of a control that couldn't work.
//
// While the install is loading, or when it can't be read, nothing is locked: the page behaves as it
// always did and the backend's own message explains a missing key.
import Link from "next/link";
import { useMemo, type ReactNode } from "react";
import { featureState, type Feature, type FeatureState } from "@/lib/capabilities";
import { useCached } from "@/lib/client-cache";
import { hasKey, type InstallState } from "@/lib/install/types";
import { useInstall } from "@/lib/install/use-install";
import type { ImageProvider } from "@/lib/image-provider";
import { readConnections, type WorkspaceConnections } from "@/lib/workspace-schema";
import { Locked, StatusPill } from "../ui";

/** Settings > Desktop runner: where the runner's secret is made and the commands that start it are. */
export const RUNNER_HREF = "/app/settings/runner";
export const KEYS_HREF = "/app/settings/keys";

export interface Features {
  /** null while it loads and when it couldn't be read. */
  install: InstallState | null;
  /** The current app and its connections, once known. */
  app: { id: string; connections: WorkspaceConnections } | undefined;
  /** A feature's state (ready while nothing is known). */
  state: (feature: Feature) => FeatureState;
  /** The feature's state when it is locked, else null. */
  locked: (feature: Feature) => FeatureState | null;
  /** Whether the desktop runner has a secret (so jobs for it can be picked up). null when unknown. */
  runner: boolean | null;
  /** Who can make GPT Image pictures here. null when unknown: then both are offered. */
  imageProviders: Record<ImageProvider, boolean> | null;
}

export function useFeatures(productId: string): Features {
  const { install } = useInstall();
  const [workspace] = useCached<{ id?: string; connections?: unknown; error?: string }>(`/api/workspaces/${productId}`);
  const loaded = Boolean(workspace && !workspace.error && workspace.id);
  const connections = workspace?.connections;
  return useMemo(() => {
    const app = loaded ? { id: productId, connections: readConnections(connections) } : undefined;
    const state = (feature: Feature) => featureState(feature, install, app);
    const runner = install ? featureState("studio.runner", install).ok : null;
    return {
      install, app, state, runner,
      locked: (feature) => { const s = state(feature); return s.ok ? null : s; },
      imageProviders: imageProvidersOf(install),
    };
  }, [install, loaded, connections, productId]);
}

/**
 * Who can make GPT Image pictures in this install: Higgsfield with its API key (or through the desktop
 * runner's own sign-in), OpenAI with its key. null when the install isn't known.
 */
export function imageProvidersOf(install: InstallState | null | undefined): Record<ImageProvider, boolean> | null {
  if (!install) return null;
  return { higgsfield: hasKey(install, "HIGGSFIELD_API_KEY") || hasKey(install, "CREATIVES_RUNNER_SECRET"), openai: hasKey(install, "OPENAI_API_KEY") };
}

/** A locked feature, inline, in the registry's words: "Connect Higgsfield to generate images · Add the key". */
export function FeatureLock({ state, children, className }: { state: FeatureState; children?: ReactNode; className?: string }) {
  // Images can be made with either key; the registry's title names the first way only.
  const title = state.feature === "studio.images" && state.missingKeys.length ? "Connect Higgsfield or OpenAI to generate images" : state.title;
  return <Locked href={state.href} action={state.action} className={className}>{children ?? title}</Locked>;
}

/** Something only the desktop runner can make, where it isn't set up. */
export function RunnerLock({ children = "Needs the desktop runner", className }: { children?: ReactNode; className?: string }) {
  return <Locked href={RUNNER_HREF} action="Set it up" className={className}>{children}</Locked>;
}

/** The provider a generation will really use: the one asked for when it has a key (or nothing is known), else the other. */
export function availableProvider(wanted: ImageProvider, providers: Features["imageProviders"]): ImageProvider {
  if (!providers || providers[wanted]) return wanted;
  const other: ImageProvider = wanted === "openai" ? "higgsfield" : "openai";
  return providers[other] ? other : wanted;
}

/** What the creatives backend's health check says is set up, for installs whose own state can't be read. */
export interface BackendFlags { typesafe?: boolean; higgsfieldApi?: boolean; runner?: boolean; openaiImages?: boolean }

/**
 * A page header's row of small states: can this install make images, videos, check creatives, and is the
 * desktop runner (optional) set up. One that isn't ready links to where it is set.
 */
export function CapabilityPills({ features, backend }: { features: Features; backend: BackendFlags | null | undefined }) {
  const known = Boolean(features.install);
  if (!known && !backend) return backend === null ? <StatusPill tone="warn">Can&apos;t reach the backend</StatusPill> : null;
  const runner = known ? Boolean(features.runner) : Boolean(backend?.runner);
  const rows: { label: string; ok: boolean; href: string; optional?: boolean }[] = [
    { label: "Images", ok: runner || (known ? features.state("studio.images").ok : Boolean(backend?.higgsfieldApi || backend?.openaiImages)), href: KEYS_HREF },
    { label: "Videos", ok: runner || (known ? features.state("studio.video").ok : Boolean(backend?.higgsfieldApi)), href: KEYS_HREF },
    { label: "Checks", ok: known ? features.state("ai").ok : Boolean(backend?.typesafe), href: KEYS_HREF },
    { label: "Desktop runner", ok: runner, href: RUNNER_HREF, optional: true },
  ];
  return (
    <>
      {rows.map((row) => row.ok
        ? <StatusPill key={row.label} tone="win">{row.label}<span className="sr-only"> ready</span></StatusPill>
        : (
          <Link key={row.label} href={row.href} className="rounded-full" title={row.optional ? "Optional. Set it up in Settings." : "Not connected yet. Add the key in Settings."}>
            <StatusPill tone={row.optional ? "neutral" : "caution"} className="transition-colors hover:bg-hover">{row.label}<span className="font-normal text-muted">{row.optional ? "off" : "not connected"}</span></StatusPill>
          </Link>
        ))}
    </>
  );
}
