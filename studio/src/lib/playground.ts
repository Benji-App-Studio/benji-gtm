// Playground: free-form image and video experiments. Image mode: bring a reference creative, say what
// to change (and add your own images: product shots, app screens, a logo), and Higgsfield makes new
// versions in the reference's exact style. The Style Library (lib/ad-styles.ts) fills a request from a
// proven Meta ad format. Video mode: describe the shot and Seedance 2.5 makes a clip from it, with your
// images as references (one of them can be the opening frame).
// Runs on the creative pipeline (creative_batches / creative_jobs / creatives, tagged
// settings.source = "playground"), so outputs are stored like every other creative and the price is
// confirmed before anything is spent.
import type { Aspect } from "./meta-formats";

export type PlaygroundMode = "image" | "video";

/** Video mode's settings (Seedance 2.5): the clip's length, resolution and sound, and how the images are used. */
export interface PlaygroundVideo {
  /** Seconds, PLAYGROUND_VIDEO.minDuration–maxDuration. */
  duration: number;
  resolution: "720p" | "1080p";
  /** Seedance makes a soundtrack (voices, ambience) with the clip. */
  audio: boolean;
  /** One of `inputUrls` the video opens on (its first frame), or null: every image is a plain reference. */
  startFrame: string | null;
  /** Add the brand's look, name and rules to the prompt. Off: the prompt goes as written. */
  useBrand: boolean;
}

/** What a Playground generation needs; the page's form and the Style Library both produce one. */
export interface PlaygroundRequest {
  /** Image (GPT Image 2.5) or video (Seedance 2.5); image when unset (older batches). */
  mode?: PlaygroundMode;
  /** What to make or change, in the person's words (or a style's filled-in template). */
  prompt: string;
  /** The image whose exact style, layout and typography the output follows (public https URL), if any. */
  referenceUrl: string | null;
  /** The person's own images to use (product, packaging, app screens, logo, a face…), public https URLs. */
  inputUrls: string[];
  aspect: Aspect;
  /** How many versions to make (video: 1 or 2). */
  count: 1 | 2 | 3 | 4;
  /** Video mode's settings; null in image mode. */
  video?: PlaygroundVideo | null;
  /** Set when the request came from the Style Library. */
  styleId?: string | null;
  /** The style's filled-in fields, kept with the result so it can be re-opened and tweaked. */
  styleFields?: Record<string, string> | null;
  /** Names that must not appear in the output (e.g. the brand in a style's example image). */
  mustAvoid?: string[];
  /** App Store reviews quoted word for word in the style's fields (lib/reviews.ts); kept on each job as `review_ids`. */
  reviewIds?: string[];
}

export const PLAYGROUND_MAX_INPUTS = 8;
/** Video mode's limits and defaults. */
export const PLAYGROUND_VIDEO = { minDuration: 4, maxDuration: 15, maxCount: 2 } as const;
export const DEFAULT_PLAYGROUND_VIDEO: PlaygroundVideo = { duration: 7, resolution: "720p", audio: true, startFrame: null, useBrand: false };
export const PLAYGROUND_SOURCE = "playground";
