// Key frames from a video, taken in the browser for the video scan (Recreate → "Scan with AI").
// Edge functions can't decode video, so the browser seeks the stored copy (bucket ad-media, which
// sends CORS headers) and draws a few frames to a canvas. An Ad Library link that isn't stored
// taints the canvas: then this gives up and the scan reads the poster frame instead.

export interface VideoFrame {
  /** The second the frame was taken at. */
  at: number;
  /** A JPEG data URL, at most FRAME_SIZE pixels on its long side. */
  data: string;
}

export const MAX_FRAMES = 8;
const FRAME_SIZE = 640;

/** When to look: the hook densely (it decides the ad), then the rest evenly. */
export function frameTimes(duration: number, max = MAX_FRAMES): number[] {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const end = Math.max(0, duration - 0.15);
  const hook = [0.2, 1.2, 2.6].filter((t) => t < end);
  const rest = Math.max(0, max - hook.length);
  const from = Math.min(end, 4);
  const even = Array.from({ length: rest }, (_, i) => from + ((end - from) * (i + 1)) / rest);
  const out: number[] = [];
  for (const t of [...hook, ...even].map((t) => Math.round(Math.min(end, t) * 10) / 10)) if (!out.some((o) => Math.abs(o - t) < 0.4)) out.push(t);
  return out.slice(0, max);
}

const once = (el: HTMLVideoElement, event: string, ms: number) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error(`${event} timed out`)); }, ms);
    const ok = () => { cleanup(); resolve(); };
    const bad = () => { cleanup(); reject(new Error("The video couldn't be loaded.")); };
    const cleanup = () => { clearTimeout(timer); el.removeEventListener(event, ok); el.removeEventListener("error", bad); };
    el.addEventListener(event, ok, { once: true });
    el.addEventListener("error", bad, { once: true });
  });

/**
 * Up to `max` frames of the video at `url`, with its length. Null when the video can't be read here
 * (not stored, so the browser may not draw it; or it doesn't load).
 */
export async function videoFrames(url: string, max = MAX_FRAMES): Promise<{ frames: VideoFrame[]; duration: number } | null> {
  if (typeof document === "undefined" || !/^https:\/\//.test(url)) return null;
  const video = document.createElement("video");
  video.crossOrigin = "anonymous";
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  try {
    const loaded = once(video, "loadeddata", 20_000);
    video.src = url;
    video.load();
    await loaded;
    const duration = video.duration;
    const times = frameTimes(duration, max);
    if (!times.length || !video.videoWidth) return null;
    const scale = Math.min(1, FRAME_SIZE / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const frames: VideoFrame[] = [];
    for (const at of times) {
      const seeked = once(video, "seeked", 10_000);
      video.currentTime = at;
      await seeked;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      // Throws a SecurityError when the video came without CORS headers (a tainted canvas).
      frames.push({ at, data: canvas.toDataURL("image/jpeg", 0.74) });
    }
    return { frames, duration };
  } catch {
    return null;
  } finally {
    video.removeAttribute("src");
    video.load();
  }
}
