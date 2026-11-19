"use client";
// Our logo on image creatives whose batch asked for it (Recreate → "Place our logo"): as each one
// arrives, the Studio asks /api/studio/creatives/[id]/logo to place the real file on it. One at a time;
// a failure is retried a little later, at most three times, and then shows on the creative's card (with
// a way to try again). The updated row comes back over Realtime.
import type { CreativeJobRow, CreativeView } from "@/lib/creative-types";
import { pendingLogos } from "@/lib/logo-overlay";
import { useRetriedPosts } from "./use-retried-posts";

const logoUrl = (id: string) => `/api/studio/creatives/${id}/logo`;

export function useLogoOverlays(jobs: CreativeJobRow[], creatives: CreativeView[], onPlaced?: () => void) {
  return useRetriedPosts(pendingLogos(jobs, creatives), logoUrl, "Our logo wasn't placed", onPlaced);
}
