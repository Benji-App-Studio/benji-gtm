"use client";
// Meta placements as small drawings of the ad in its slot: the creative (blue) inside Meta's own
// interface (grey), with the areas Meta covers hatched. Picking one sets the size and adds its specs to
// the prompts (lib/meta-formats.ts). The ad format (single or carousel) is its own picker, under the
// Studio's More options.
import { AD_FORMATS, CAROUSEL, CAROUSEL_PLACEMENTS, PLACEMENTS, SOURCES, SPECS_CHECKED, VOLUME_TIP, type AdFormatId, type Placement, type PlacementId } from "@/lib/meta-formats";
import { cx } from "../ui";

const MEDIA = "bg-accent/25 ring-1 ring-inset ring-accent/40";
const CHROME = "bg-ink/15";

/** Meta's interface lines: a name row, caption lines, a button. */
const Line = ({ w, className }: { w: string; className?: string }) => <span className={cx("block h-[3px] rounded-full", CHROME, className)} style={{ width: w }} />;

function FeedHeader() {
  return (
    <span className="flex items-center gap-1 px-1 py-[3px]">
      <span className={cx("size-[6px] shrink-0 rounded-full", CHROME)} />
      <Line w="45%" />
    </span>
  );
}

function FeedFooter() {
  return (
    <span className="grid gap-[3px] px-1 pt-[3px] pb-1">
      <Line w="80%" />
      <span className="mt-[1px] flex items-center justify-between gap-1"><Line w="35%" /><span className={cx("h-[6px] w-[34%] rounded-xs", CHROME)} /></span>
    </span>
  );
}

/** A drawing of one placement, about 70 px wide. Carousel draws square or 4:5 cards side by side. */
export function PlacementSketch({ placement, carousel = false, className }: { placement: Placement; carousel?: boolean; className?: string }) {
  const [w, h] = placement.size;
  if (placement.chrome === "fullscreen") {
    const safe = placement.safe!;
    return (
      <span aria-hidden className={cx("relative block w-[54px] overflow-hidden rounded-md border border-line bg-card", className)} style={{ aspectRatio: `${w} / ${h}` }}>
        <span className={cx("absolute inset-0", MEDIA)} />
        {/* Areas Meta covers: hatched. */}
        <span className="hatch absolute inset-x-0 top-0 text-ink/40" style={{ height: `${safe.top * 100}%` }} />
        <span className="hatch absolute inset-x-0 bottom-0 text-ink/40" style={{ height: `${safe.bottom * 100}%` }} />
        <span className="hatch absolute left-0 text-ink/30" style={{ top: `${safe.top * 100}%`, bottom: `${safe.bottom * 100}%`, width: `${safe.sides * 100}%` }} />
        <span className="hatch absolute right-0 text-ink/30" style={{ top: `${safe.top * 100}%`, bottom: `${safe.bottom * 100}%`, width: `${safe.sides * 100}%` }} />
        <span className="absolute top-[4%] left-[8%] flex items-center gap-[2px]"><span className="size-[5px] rounded-full bg-ink/50" /><span className="h-[2px] w-[14px] rounded-full bg-ink/50" /></span>
        <span className="absolute right-[8%] bottom-[38%] grid gap-[3px]">{[0, 1, 2].map((i) => <span key={i} className="size-[4px] rounded-full bg-ink/45" />)}</span>
        <span className="absolute inset-x-[10%] bottom-[8%] grid gap-[3px]">
          <span className="h-[2px] w-[70%] rounded-full bg-ink/50" />
          <span className="h-[6px] w-full rounded-xs bg-ink/50" />
        </span>
      </span>
    );
  }
  const media = (key?: number, extra?: string) => <span key={key} className={cx("block shrink-0", MEDIA, extra)} style={{ aspectRatio: `${w} / ${h}` }} />;
  return (
    <span aria-hidden className={cx("block overflow-hidden rounded-md border border-line bg-card", placement.chrome === "landscape" ? "w-[78px]" : "w-[62px]", className)}>
      <FeedHeader />
      {carousel ? (
        <span className="flex gap-[3px] overflow-hidden pl-1">{[0, 1, 2].map((i) => media(i, "w-[42%] rounded-xs"))}</span>
      ) : media(undefined, "w-full")}
      <FeedFooter />
    </span>
  );
}

const sizeLabel = (p: Placement) => `${p.size[0]} × ${p.size[1]}`;

/**
 * Where the ads run: one small tile per Meta placement (a drawing, its name and ratio). Each tile's
 * notes are in its tooltip; the picked ones' notes are listed underneath.
 */
export function PlacementPicker({ value, onChange, format, videoToo }: {
  value: PlacementId[];
  onChange: (next: PlacementId[]) => void;
  format: AdFormatId;
  /** Videos are in the batch: show the video lengths. */
  videoToo: boolean;
}) {
  const toggle = (id: PlacementId) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  const carousel = format === "carousel";
  const picked = PLACEMENTS.filter((p) => value.includes(p.id));
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-medium">Placements</span>
        <span className="text-xs text-faint">Meta&apos;s specs, checked {SPECS_CHECKED} · hatched = covered by Meta&apos;s interface</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {PLACEMENTS.map((p) => {
          const on = value.includes(p.id);
          const off = carousel && !CAROUSEL_PLACEMENTS.includes(p.id);
          return (
            <button key={p.id} type="button" aria-pressed={on} onClick={() => toggle(p.id)} title={[p.summary, p.where.join(" · "), ...p.notes].join("\n")}
              className={cx("flex items-center gap-2.5 rounded-inner border py-1.5 pr-3 pl-1.5 text-left transition", on ? "border-accent bg-accent-soft" : "border-hairline bg-card hover:bg-hover", off && "opacity-55")}>
              {/* The drawings at 60%: zoom (unlike a transform) shrinks the space they take too. */}
              <span className="grid w-[84px] shrink-0 place-items-center rounded-card bg-canvas py-2" style={{ zoom: 0.6 }}>
                <PlacementSketch placement={p} carousel={carousel && !off} />
              </span>
              <span className="grid gap-0.5">
                <span className="text-sm font-medium">{p.label}</span>
                <span className="text-xs tabular-nums text-muted">{p.aspect} · {sizeLabel(p)}</span>
              </span>
            </button>
          );
        })}
      </div>
      {picked.length > 0 && (
        <ul className="grid gap-0.5 text-xs text-muted">
          {picked.map((p) => (
            <li key={p.id}>
              <span className="text-ink">{p.label}:</span> {p.where.join(", ")}.{videoToo ? ` Video: ${p.videoSeconds.recommended}.` : ""}
              {carousel && !CAROUSEL_PLACEMENTS.includes(p.id) && <span className="text-warn"> Carousel cards are square or 4:5; images skip this one.</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Single ads or carousel sets (with how many cards), and the formats put together in Ads Manager. */
export function AdFormatPicker({ format, onFormat, cards, onCards }: {
  format: AdFormatId;
  onFormat: (next: AdFormatId) => void;
  cards: number;
  onCards: (n: number) => void;
}) {
  const carousel = format === "carousel";
  const madeHere = AD_FORMATS.filter((f) => f.makesHere);
  const elsewhere = AD_FORMATS.filter((f) => !f.makesHere);
  return (
    <div className="grid gap-2">
      <span className="text-sm font-medium">Ad format</span>
      <div className="flex flex-wrap items-center gap-2">
        {madeHere.map((f) => {
          const on = f.id === format;
          return (
            <button key={f.id} type="button" aria-pressed={on} onClick={() => onFormat(f.id as AdFormatId)}
              className={cx("grid max-w-[300px] gap-0.5 rounded-control border px-3 py-2 text-left transition", on ? "border-accent bg-accent-soft" : "border-hairline bg-card hover:bg-hover")}>
              <span className="text-sm font-medium">{f.label}</span>
              <span className="text-xs text-muted">{f.summary}</span>
            </button>
          );
        })}
        {carousel && (
          <label className="flex items-center gap-2 text-sm">
            Cards
            <select className="h-9 rounded-control border border-line bg-raised px-2.5 text-sm text-ink" value={cards} onChange={(e) => onCards(Number(e.target.value))}>
              {Array.from({ length: CAROUSEL.maxCards - CAROUSEL.minCards + 1 }, (_, i) => i + CAROUSEL.minCards).map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        )}
      </div>
      {carousel && <p className="text-xs text-muted">{AD_FORMATS.find((f) => f.id === "carousel")!.note} Each variant is one set of {cards} image cards.</p>}
      <div className="grid gap-1 text-xs text-faint">
        <p>Put together in Ads Manager from creatives made here: {elsewhere.map((f, i) => <span key={f.id}>{i ? " · " : ""}<span className="text-muted">{f.label}</span> ({f.note.replace(/\.$/, "")})</span>)}.</p>
        <p>{VOLUME_TIP} Sources: {SOURCES.map((src, i) => <span key={src.url}>{i ? ", " : ""}<a href={src.url} target="_blank" rel="noreferrer" className="underline decoration-faint underline-offset-2 hover:text-ink">{src.label}</a></span>)}.</p>
      </div>
    </div>
  );
}
