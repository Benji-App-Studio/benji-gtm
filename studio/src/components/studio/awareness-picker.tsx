"use client";
// The awareness ladder in the Studio (lib/awareness.ts): the batch form's level picker (the level's
// formula as its hint, and a near-duplicate warning), and the gallery's coverage strip (creatives per
// level, with a nudge toward the empty ones). Advice only: nothing here blocks a batch.
import { AWARENESS, AWARENESS_LEVELS, awarenessCoverage, awarenessInfo, awarenessLabel, cleanAwareness, type AwarenessLevel, type ExistingBatch } from "@/lib/awareness";
import { batchTitle } from "@/lib/creative-plan";
import { cx, Segmented } from "../ui";

export function AwarenessPicker({ value, onChange, duplicate }: { value: number | null | undefined; onChange: (level: AwarenessLevel | null) => void; duplicate?: (ExistingBatch & { hook: string }) | null }) {
  const level = cleanAwareness(value);
  const info = level ? awarenessInfo(level) : null;
  const options = [{ value: "0", label: "Not set" }, ...AWARENESS.map((a) => ({ value: String(a.level), label: <span title={a.label}>L{a.level}</span> }))];
  return (
    <div className="grid gap-2">
      <span className="text-sm font-medium">Awareness level <span className="font-normal text-muted">· optional</span></span>
      <Segmented label="Awareness level" options={options} value={String(level ?? 0)} onChange={(v) => onChange(cleanAwareness(Number(v)))} className="w-fit" />
      <p className="text-xs text-muted">
        {info
          ? <><span className="font-medium text-label">{awarenessLabel(info.level)}:</span> {info.knows.toLowerCase()}. Sells {info.sells}. <span className="text-label">{info.formula}</span></>
          : "Aim the batch at one rung of the ladder (unaware → most aware): its job goes into the prompt and the gallery counts creatives per level."}
      </p>
      {duplicate && (
        <p className="text-xs text-caution-ink" role="note">
          Looks like a near-duplicate of &ldquo;{batchTitle(duplicate.brief)}&rdquo; ({new Date(duplicate.created_at).toLocaleDateString()}): same level, format and hook (&ldquo;{duplicate.hook}&rdquo;). Meta treats near-duplicates as one ad; a new hook or another level tests something new.
        </p>
      )}
    </div>
  );
}

/** The gallery's strip: creatives per level (rejected ones left out) and a nudge toward the first empty level. */
export function AwarenessCoverage({ levels }: { levels: (number | null | undefined)[] }) {
  const c = awarenessCoverage(levels);
  if (!AWARENESS_LEVELS.some((l) => c.counts[l])) return null;
  return (
    <div className="mb-3 grid gap-1.5 text-xs">
      <div className="flex flex-wrap items-center gap-1" aria-label="Creatives per awareness level">
        <span className="mr-1 text-muted">Awareness</span>
        {AWARENESS_LEVELS.map((l) => (
          <span key={l} title={`${awarenessLabel(l)}: sells ${awarenessInfo(l).sells}`}
            className={cx("rounded-full border px-2 py-0.5 tabular-nums", c.counts[l] ? "border-line text-label" : "border-dashed border-caution/50 text-caution-ink")}>
            L{l} {awarenessInfo(l).label} <span className="opacity-70">{c.counts[l]}</span>
          </span>
        ))}
        {c.unset > 0 && <span className="ml-1 text-faint tabular-nums">{c.unset} without a level</span>}
      </div>
      {c.nudge && <p className="text-muted">{c.nudge}</p>}
    </div>
  );
}
