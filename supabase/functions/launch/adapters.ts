// The ad-platform seam. Launch's worker speaks to a platform through these few operations, so TikTok
// (later) is a second implementation, not a rewrite. Meta is implemented in meta.ts and draft.ts;
// the TikTok adapter below is documented but not wired up.
import type { Graph } from "./graph.ts";
import { adPayload, copyAd, createAd, createCreative, creativePayload, pauseAd, uploadImage, uploadVideo, videoState } from "./meta.ts";
import type { LaunchSettingsRow } from "./types.ts";

export type MediaState = { state: "processing" } | { state: "ready"; thumbnail: string | null } | { state: "error"; message: string };

export interface AdCopy { name: string; primaryText: string; headline: string; cta: string; link: string; description?: string | null; aiDisclosure?: "OPT_IN" | "OPT_OUT" | null }

/** Everything Launch needs from an ad platform. Every ad it creates must be paused / disabled. */
export interface AdPlatform {
  readonly id: "meta" | "tiktok";
  uploadImage(name: string, bytes: Uint8Array): Promise<string>;
  uploadVideo(name: string, url: string): Promise<string>;
  mediaState(videoId: string): Promise<MediaState>;
  /** Creates the ad (and its creative, where the platform separates them), paused. Returns the ad id. */
  createPausedAd(adGroupId: string, media: { imageId?: string | null; videoId?: string | null; thumbnail?: string | null }, copy: AdCopy): Promise<string>;
  /** Duplicates an ad into another ad group, paused. */
  copyPaused(adId: string, adGroupId: string, name: string): Promise<string>;
  pause(adId: string): Promise<void>;
}

export function metaPlatform(graph: Graph, settings: LaunchSettingsRow): AdPlatform {
  const account = settings.meta.adAccountId!;
  return {
    id: "meta",
    uploadImage: (name, bytes) => uploadImage(graph, account, name, bytes),
    uploadVideo: (name, url) => uploadVideo(graph, account, name, url),
    mediaState: async (videoId) => {
      const s = await videoState(graph, videoId);
      return s.state === "processing" ? { state: "processing" } : s;
    },
    createPausedAd: async (adSetId, media, copy) => {
      const creativeId = await createCreative(graph, account, creativePayload(settings, {
        ...copy, imageHash: media.imageId, videoId: media.videoId, thumbnailUrl: media.thumbnail,
      }));
      return createAd(graph, account, adPayload(copy.name, adSetId, creativeId));
    },
    copyPaused: (adId, adSetId, name) => copyAd(graph, adId, adSetId, name),
    pause: (adId) => pauseAd(graph, adId),
  };
}

/*
 * TikTok Marketing API (Business API v1.3) — the equivalent calls, for the adapter to come.
 * Base: https://business-api.tiktok.com/open_api/v1.3/  Header: Access-Token: <long-lived token>
 * (from a TikTok for Business developer app, advertiser-authorised; scopes: Ads Management,
 * Creative Management, Reporting). Every body carries advertiser_id.
 *
 *   Meta                                   TikTok
 *   POST act_/adimages (bytes)          →  POST file/image/ad/upload/   upload_type UPLOAD_BY_URL | UPLOAD_BY_FILE → image_id
 *   POST act_/advideos (file_url)       →  POST file/video/ad/upload/   upload_type UPLOAD_BY_URL, video_url → video_id
 *   GET  {video}?fields=status          →  GET  file/video/ad/info/     video_ids=[…] (poll until poster/ready; use video_cover_url)
 *   campaign OUTCOME_APP_PROMOTION      →  POST campaign/create/        objective_type APP_PROMOTION (app_promotion_type APP_INSTALL), operation_status DISABLE
 *   campaign OUTCOME_TRAFFIC            →  POST campaign/create/        objective_type TRAFFIC, operation_status DISABLE
 *   ad set (promoted_object app)        →  POST adgroup/create/         app_id (from app/list/, registered in TikTok's App Management with the
 *                                                                        App Store URL and an MMP/SKAN setup), optimization_goal INSTALL,
 *                                                                        billing_event OCPM, budget_mode BUDGET_MODE_DAY, operation_status DISABLE
 *   adcreatives + ads (PAUSED)          →  POST ad/create/              adgroup_id, creatives: [{ ad_name, ad_format SINGLE_VIDEO,
 *                                                                        video_id, image_ids (cover), ad_text, call_to_action
 *                                                                        (DOWNLOAD_NOW / LEARN_MORE / SIGN_UP), landing_page_url or app,
 *                                                                        identity_type + identity_id }], operation_status DISABLE
 *   POST {ad}/copies (status PAUSED)    →  no copy endpoint: ad/get/ the original, then ad/create/ in the scaling ad group, DISABLE
 *   POST {ad} status=PAUSED             →  POST ad/status/update/       ad_ids, operation_status DISABLE
 *
 * Differences to plan for: TikTok has no separate creative object (creatives live inside the ad);
 * ads need an identity (a TikTok account or a custom identity); images are covers only for video
 * ads in most placements; ad_text is limited to 100 characters (no headline); and Smart+ campaigns
 * are the automated counterpart of Advantage+. Names follow the same convention (naming.ts).
 */
export const TIKTOK_API = "https://business-api.tiktok.com/open_api/v1.3";
