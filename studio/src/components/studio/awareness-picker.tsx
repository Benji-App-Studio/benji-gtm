"use client";
// The awareness ladder in the Studio (lib/awareness.ts): the batch form's level picker (the level's
// formula as its hint, and a near-duplicate warning), and the gallery's coverage strip (creatives per
// level, with a nudge toward the empty ones). Advice only: nothing here blocks a batch.
import { AWARENESS, AWARENESS_LEVELS, awarenessCoverage, awarenessInfo, cleanAwareness, type AwarenessLevel, type ExistingBatch } from "@/lib/awareness";
import { batchTitle } from "@/lib/creative-plan";
import { cx, Segmented } from "../ui";
import { useT } from "@/lib/i18n/client";

/** "L3 Solution-aware", in the reader's language. */
const levelLabel = (level: AwarenessLevel, t: (text: string) => string) => `L${level} ${t(awarenessInfo(level).label)}`;

export function AwarenessPicker({ value, onChange, duplicate }: { value: number | null | undefined; onChange: (level: AwarenessLevel | null) => void; duplicate?: (ExistingBatch & { hook: string }) | null }) {
  const { t, intl } = useT();
  const level = cleanAwareness(value);
  const info = level ? awarenessInfo(level) : null;
  const options = [{ value: "0", label: t("Not set") }, ...AWARENESS.map((a) => ({ value: String(a.level), label: <span title={t(a.label)}>L{a.level}</span> }))];
  return (
    <div className="grid gap-2">
      <span className="text-xs font-medium text-muted">{t("Awareness level")} <span className="font-book text-faint">· {t("optional")}</span></span>
      <Segmented label={t("Awareness level")} options={options} value={String(level ?? 0)} onChange={(v) => onChange(cleanAwareness(Number(v)))} className="w-fit" />
      <p className="text-xs text-muted">
        {info
          ? <><span className="font-medium text-label">{levelLabel(info.level, t)}:</span> {t("{knows}. Sells {sells}.", { knows: t(info.knows).toLowerCase(), sells: t(info.sells) })} <span className="text-label">{t(info.formula)}</span></>
          : t("Aim the batch at one rung of the ladder (unaware → most aware): its job goes into the prompt and the gallery counts creatives per level.")}
      </p>
      {duplicate && (
        <p className="text-xs text-caution-ink" role="note">
          {t("Looks like a near-duplicate of “{batch}” ({date}): same level, format and hook (“{hook}”). Meta treats near-duplicates as one ad; a new hook or another level tests something new.", { batch: batchTitle(duplicate.brief), date: new Date(duplicate.created_at).toLocaleDateString(intl), hook: duplicate.hook })}
        </p>
      )}
    </div>
  );
}

/** The gallery's strip: creatives per level (rejected ones left out) and a nudge toward the first empty level. */
export function AwarenessCoverage({ levels }: { levels: (number | null | undefined)[] }) {
  const { t } = useT();
  const c = awarenessCoverage(levels);
  if (!AWARENESS_LEVELS.some((l) => c.counts[l])) return null;
  // The nudge toward the first empty level, in the reader's words (lib/awareness.ts says it in English).
  const first = c.empty[0];
  const nudge = first ? (c.empty.length > 1
    ? t("Nothing at {level} yet (nor {others}): it sells {sells} ({formula}). One deliberate ad per level beats more variants at one level.", { level: levelLabel(first, t), others: c.empty.slice(1).map((l) => `L${l}`).join(", "), sells: t(awarenessInfo(first).sells), formula: t(awarenessInfo(first).formula).replace(/[.。]$/, "") })
    : t("Nothing at {level} yet: it sells {sells} ({formula}). One deliberate ad per level beats more variants at one level.", { level: levelLabel(first, t), sells: t(awarenessInfo(first).sells), formula: t(awarenessInfo(first).formula).replace(/[.。]$/, "") })) : null;
  return (
    <div className="mb-3 grid gap-1.5 text-xs">
      <div className="flex flex-wrap items-center gap-1" aria-label={t("Creatives per awareness level")}>
        <span className="mr-1 text-muted">{t("Awareness level")}</span>
        {AWARENESS_LEVELS.map((l) => (
          <span key={l} title={t("{level}: sells {sells}", { level: levelLabel(l, t), sells: t(awarenessInfo(l).sells) })}
            className={cx("inline-flex h-6 items-center gap-1 rounded-full border px-2 tabular-nums", c.counts[l] ? "border-line text-label" : "border-dashed border-caution/50 text-caution-ink")}>
            {levelLabel(l, t)} <span className="opacity-70">{c.counts[l]}</span>
          </span>
        ))}
        {c.unset > 0 && <span className="ml-1 text-faint tabular-nums">{t("{n} without a level", { n: c.unset })}</span>}
      </div>
      {nudge && <p className="text-muted">{nudge}</p>}
    </div>
  );
}
