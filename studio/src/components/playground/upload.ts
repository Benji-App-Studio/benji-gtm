"use client";
// Uploads one Playground image (a reference or one of the person's images): a one-time ticket from the
// Playground API, then the file straight to Storage, as the Product page's upload does. Files land in
// the public `workspace` bucket under <user>/<product>/playground/inputs/; the public https link is what
// Higgsfield fetches.
import { createClient } from "@/lib/supabase/client";
import { ASSET_IMAGE_TYPES, ASSET_MAX_BYTES } from "../product/upload-asset";

export async function uploadPlaygroundImage(productId: string, file: File): Promise<string> {
  if (!ASSET_IMAGE_TYPES.includes(file.type)) throw new Error(`${file.name} isn't a PNG, JPEG or WebP image.`);
  if (file.size > ASSET_MAX_BYTES) throw new Error(`${file.name} is over 15 MB.`);
  const response = await fetch(`/api/playground/${productId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "ticket", contentType: file.type }) });
  const ticket = await response.json().catch(() => ({ error: "The server didn't answer. Try again." }));
  if (!response.ok) throw new Error(ticket.error ?? "Couldn't start the upload.");
  const { error } = await createClient().storage.from(ticket.bucket).uploadToSignedUrl(ticket.path, ticket.token, file, { contentType: file.type });
  if (error) throw new Error(`${file.name}: ${error.message}`);
  return ticket.url as string;
}

/** The image files in a drop or a file input. */
export function imageFiles(list: FileList | null | undefined): File[] {
  return Array.from(list ?? []).filter((f) => f.type.startsWith("image/"));
}

/**
 * One frame of a video as a JPEG file (to upload as an image: "Use as reference" on a video result).
 * From a playing <video> (its current frame; it must load with crossOrigin="anonymous"), or from a link
 * (the frame at `at` seconds). Storage serves the files with open CORS, so the canvas can be read.
 */
export async function videoFrame(source: HTMLVideoElement | string, at = 0.1): Promise<File> {
  let video: HTMLVideoElement;
  if (typeof source === "string") {
    video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    const ready = new Promise<void>((resolve, reject) => {
      video.addEventListener("loadeddata", () => resolve(), { once: true });
      video.addEventListener("error", () => reject(new Error("Couldn't load the video to take a frame.")), { once: true });
    });
    video.src = source;
    await ready;
    const seeked = new Promise<void>((resolve) => video.addEventListener("seeked", () => resolve(), { once: true }));
    video.currentTime = Math.min(at, Math.max(0, (video.duration || at) - 0.05));
    await seeked;
  } else {
    video = source;
  }
  if (!video.videoWidth || !video.videoHeight) throw new Error("The video isn't loaded yet. Try again in a moment.");
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d")!.drawImage(video, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => {
    try { canvas.toBlob(resolve, "image/jpeg", 0.92); } catch { resolve(null); }
  });
  if (!blob) throw new Error("Couldn't read a frame from this video (its storage doesn't allow it).");
  return new File([blob], `frame-${Date.now().toString(36)}.jpg`, { type: "image/jpeg" });
}
