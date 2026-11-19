// Where an ad runs, as the platforms' own small icons (Facebook, Instagram, Threads, Messenger,
// Audience Network) with the name on hover and for screen readers; any other placement as text.
import { PLACEMENT_LABEL } from "@/lib/research";
import { cx } from "../ui";

const ICONS: Record<string, string> = {
  facebook: "/platforms/facebook.png", instagram: "/platforms/instagram.png", threads: "/platforms/threads.png",
  messenger: "/platforms/messenger.png", audience_network: "/platforms/audience_network.png",
};
/** Meta's order, so every card lists them the same way. */
const ORDER = ["facebook", "instagram", "threads", "messenger", "audience_network"];

export function PlacementIcons({ placements, size = 14, className }: { placements: string[]; size?: number; className?: string }) {
  const sorted = [...new Set(placements)].sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99));
  const names = sorted.map((p) => PLACEMENT_LABEL[p] ?? p);
  return (
    <span className={cx("inline-flex min-w-0 items-center gap-1", className)} title={names.join(", ")}>
      <span className="sr-only">{names.join(", ")}</span>
      {sorted.map((p) => ICONS[p]
        // eslint-disable-next-line @next/next/no-img-element
        ? <img key={p} src={ICONS[p]} alt="" aria-hidden width={size} height={size} className="shrink-0 rounded-sm" style={{ width: size, height: size }} />
        : <span key={p} aria-hidden className="truncate text-xs text-muted">{PLACEMENT_LABEL[p] ?? p}</span>)}
    </span>
  );
}
