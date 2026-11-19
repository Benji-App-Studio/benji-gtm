import "server-only";
// The `insight` edge function (the AI reads a product's links), called as the signed-in user, like research().
import type { Session } from "./auth";
import { callFunction } from "./functions";
import type { RadarResult } from "./radar";

const READER = {
  badAnswer: (status: number) => `The AI reader answered ${status}. Try again in a moment.`,
  unreachable: "Couldn't reach the AI reader. Try again in a moment.",
};

/** Starts a background read of the product's links; it answers at once with `status: "running"`. */
export function startInsight(session: Session, productId: string): Promise<RadarResult<{ status?: string; links?: string[]; error?: string }>> {
  return callFunction("insight", session, "start", { body: { productId }, messages: { ...READER, notDeployed: "The AI reader isn't deployed yet." } });
}

/** The AI sorts the product's images (new ones, or `all`): kind, label, group, what each suits. Waits for it. */
export function sortProductAssets(session: Session, productId: string, all: boolean): Promise<RadarResult<{ sorted?: number; error?: string }>> {
  return callFunction("insight", session, "sort", {
    body: { productId, all },
    timeoutMs: 280_000,
    messages: {
      badAnswer: (status) => `The AI answered ${status}. Try again in a moment.`,
      unreachable: "Sorting took too long or couldn't reach the AI. Try again in a moment.",
    },
  });
}

/** Reads the product's links again only for their pictures (no new profile); runs in the background. */
export function findProductImages(session: Session, productId: string): Promise<RadarResult<{ status?: string; error?: string }>> {
  return callFunction("insight", session, "images", { body: { productId }, messages: READER });
}

/** Fetches the App Store reviews again, verbatim, into the profile (no new profile, no AI). Waits for it. */
export function fetchAppStoreReviews(session: Session, productId: string): Promise<RadarResult<{ reviews?: number; source?: string | null; error?: string }>> {
  return callFunction("insight", session, "reviews", {
    body: { productId },
    timeoutMs: 60_000,
    messages: { ...READER, notDeployed: "The AI reader's reviews route isn't deployed yet." },
  });
}
