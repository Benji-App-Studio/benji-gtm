"use client";
// Composed ads (lib/composed-ads.ts): as each text-free plate arrives, the Studio asks
// /api/studio/creatives/[id]/compose to set its copy in the brand's fonts. One at a time; a failure is
// retried a little later, at most three times, and then shows on the creative's card (with a way to try
// again). Copy that doesn't fit isn't retried: the route records it on the creative (copy.composeError)
// and the card offers "Edit text". Updates arrive over Realtime.
import { pendingComposed } from "@/lib/composed-ads";
import type { CreativeJobRow, CreativeView } from "@/lib/creative-types";
import { useRetriedPosts } from "./use-retried-posts";

const composeUrl = (id: string) => `/api/studio/creatives/${id}/compose`;
// 422: the copy doesn't fit; recorded on the creative, so it isn't asked again.
const doesntFit = (status: number) => status === 422;

export function useComposedAds(jobs: CreativeJobRow[], creatives: CreativeView[], onComposed?: () => void) {
  return useRetriedPosts(pendingComposed(jobs, creatives), composeUrl, "The text wasn't set", onComposed, doesntFit);
}
