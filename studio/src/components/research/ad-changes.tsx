"use client";
// Research → Ads: an edited ad's earlier versions (`paid_ad_versions`). A running ad can be edited under
// the same Library ID; each import that finds its copy, link or media changed keeps the version it
// replaced. The drawer's "Changes" section lists them newest first: when each ran, what changed, the
// earlier text against the next version (word-level highlights) and small tiles of the earlier media.
import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n/client";
import { AD_CHANGE_LABEL, type AdChange, type AdVersion, type PaidAdRow } from "@/lib/research";
import { Skeleton, SkeletonLine, SkeletonText } from "../skeleton";
import { Badge, cx } from "../ui";

type Text = Pick<AdVersion, "body" | "headline" | "description" | "cta" | "link_url" | "media">;
type Load = { state: "loading" } | { state: "done"; versions: AdVersion[] } | { state: "error" };

/** "Oct 3", with the year when it isn't this year's. `intl` is the translator's locale (useT().intl). */
export function shortDate(iso: string | null | undefined, intl = "en-US"): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear() === new Date().getFullYear() ? undefined : "numeric";
  return date.toLocaleDateString(intl, { month: "short", day: "numeric", year });
}

/** The "Changes" section: fetched when the drawer opens, quiet on errors. */
export function AdChanges({ productId, ad }: { productId: string; ad: PaidAdRow }) {
  const { t, tn, intl } = useT();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  useEffect(() => {
    let live = true;
    fetch(`/api/research/${productId}/ads/${ad.id}/versions`)
      .then(async (response) => {
        const data = await response.json().catch(() => null) as { versions?: AdVersion[] } | null;
        if (!live) return;
        setLoad(response.ok && Array.isArray(data?.versions) ? { state: "done", versions: data.versions } : { state: "error" });
      })
      .catch(() => { if (live) setLoad({ state: "error" }); });
    return () => { live = false; };
  }, [productId, ad.id]);

  const versions = load.state === "done" ? load.versions : [];
  return (
    <div className="grid gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <p className="eyebrow">{t("Changes")}</p>
        <p className="text-xs text-muted">
          {t("Edited {date}", { date: shortDate(ad.creative_changed_at, intl) })}
          {versions.length > 0 && ` · ${tn(versions.length, "{n} earlier version", "{n} earlier versions")}`}
        </p>
      </div>
      {load.state === "loading" && (
        <Skeleton label={t("Loading earlier versions")} className="grid gap-1.5 border-t border-line pt-3">
          <SkeletonLine size="xs" width="w-40" />
          <SkeletonText lines={2} />
        </Skeleton>
      )}
      {load.state === "error" && <p className="text-xs text-muted">{t("The earlier versions couldn't be loaded.")}</p>}
      {load.state === "done" && versions.length === 0 && <p className="text-xs text-muted">{t("No earlier version was saved.")}</p>}
      {versions.length > 0 && (
        <ol className="grid divide-y divide-line border-t border-line">
          {versions.map((version, i) => <VersionRow key={version.id} version={version} next={i === 0 ? ad : versions[i - 1]} current={i === 0} />)}
        </ol>
      )}
    </div>
  );
}

/** "Aug 2 – Sep 30", or "Until Oct 3" when the first sighting isn't known. */
function ranLine(v: AdVersion, t: (text: string, vars?: Record<string, string>) => string, intl: string): string {
  const until = shortDate(v.seen_until ?? v.replaced_at, intl);
  return v.seen_from ? `${shortDate(v.seen_from, intl)} – ${until}` : t("Until {date}", { date: until });
}

const TEXT_FIELDS: { key: "headline" | "body" | "description"; change: AdChange }[] = [
  { key: "headline", change: "headline" }, { key: "body", change: "body" }, { key: "description", change: "description" },
];

function VersionRow({ version, next, current }: { version: AdVersion; next: Text; current: boolean }) {
  const { t, intl } = useT();
  const [full, setFull] = useState(false);
  const changed = new Set(version.changed);
  const texts = TEXT_FIELDS.filter((f) => changed.has(f.change) && (version[f.key] || next[f.key]));
  const long = texts.some((f) => f.key === "body" && (version.body.length > 180 || next.body.length > 180));
  const after = current ? t("Now") : t("After");
  return (
    <li className="grid gap-2 py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="text-xs text-label tabular-nums">{ranLine(version, t, intl)}</span>
        <span className="flex flex-wrap gap-1">{version.changed.map((c) => <Badge key={c}>{AD_CHANGE_LABEL[c] ? t(AD_CHANGE_LABEL[c]) : c}</Badge>)}</span>
      </div>
      {texts.map((f) => (
        <div key={f.key} className="grid gap-1">
          <p className="text-xs text-faint">{t(AD_CHANGE_LABEL[f.change])}</p>
          <Compare before={version[f.key]} after={next[f.key]} afterLabel={after} clamp={f.key === "body" && !full} />
        </div>
      ))}
      {long && (
        <button type="button" onClick={() => setFull((v) => !v)} className="w-fit text-xs text-accent hover:underline">{full ? t("Show less") : t("Show all the text")}</button>
      )}
      {changed.has("cta") && <Swap label={t("Button")} before={version.cta} after={next.cta} />}
      {changed.has("link") && <Swap label={t("Link")} before={version.link_url ?? ""} after={next.link_url ?? ""} />}
      {changed.has("media") && version.media.length > 0 && (
        <div className="grid gap-1">
          <p className="text-xs text-faint">{t("Earlier media")}</p>
          <div className="flex flex-wrap gap-1.5">{version.media.slice(0, 10).map((m, i) => <VersionTile key={`${m.url}-${i}`} media={m} />)}</div>
        </div>
      )}
    </li>
  );
}

const rowLabel = "min-w-11 shrink-0 pt-px text-xs text-faint";

/** Before and after, each with the words the other doesn't have highlighted. */
function Compare({ before, after, afterLabel, clamp }: { before: string; after: string; afterLabel: string; clamp: boolean }) {
  const { t } = useT();
  const diff = wordDiff(before, after);
  const text = cx("min-w-0 flex-1 text-sm leading-[1.45] whitespace-pre-line [overflow-wrap:anywhere]", clamp && "line-clamp-3");
  return (
    <div className="grid gap-1">
      <div className="flex gap-2">
        <span className={rowLabel}>{t("Before")}</span>
        <p className={cx(text, "text-muted")}>{before ? <Marked parts={diff?.before} text={before} tone="removed" /> : <span className="text-faint">{t("None")}</span>}</p>
      </div>
      <div className="flex gap-2">
        <span className={rowLabel}>{afterLabel}</span>
        <p className={cx(text, "text-ink")}>{after ? <Marked parts={diff?.after} text={after} tone="added" /> : <span className="text-faint">{t("None")}</span>}</p>
      </div>
    </div>
  );
}

function Marked({ parts, text, tone }: { parts: Part[] | undefined; text: string; tone: "removed" | "added" }) {
  if (!parts) return <>{text}</>;
  const mark = tone === "removed" ? "bg-warn-soft text-warn" : "bg-win-soft text-win";
  return <>{parts.map((p, i) => {
    if (!p.changed) return <span key={i}>{p.text}</span>;
    // The space after a changed run stays unmarked.
    const text = p.text.trimEnd();
    return <span key={i}><mark className={cx("rounded-xs", mark)}>{text}</mark>{p.text.slice(text.length)}</span>;
  })}</>;
}

/** A one-line change: the button or the link. */
function Swap({ label, before, after }: { label: string; before: string; after: string }) {
  const { t } = useT();
  return (
    <p className="flex min-w-0 items-baseline gap-2 text-sm">
      <span className="min-w-11 shrink-0 text-xs text-faint">{label}</span>
      <span className="min-w-0 truncate text-muted" title={before}>{before || t("None")}</span>
      <span className="shrink-0 text-faint" aria-label={t("changed to")}>→</span>
      <span className="min-w-0 truncate" title={after}>{after || t("None")}</span>
    </p>
  );
}

/** A small tile of an earlier image or video: the stored copy, then the Ad Library link, then "Expired". */
function VersionTile({ media }: { media: AdVersion["media"][number] }) {
  const { t } = useT();
  const sources = [
    ...(media.type === "video" ? [media.thumb, media.thumb_source_url].map((url) => ({ url, video: false })) : []),
    ...[media.url, media.source_url].map((url) => ({ url, video: media.type === "video" })),
  ].filter((s, i, all): s is { url: string; video: boolean } => Boolean(s.url) && all.findIndex((o) => o.url === s.url) === i);
  const [tried, setTried] = useState(0);
  const src = sources[tried];
  const tile = "size-12 shrink-0 overflow-hidden rounded-sm bg-canvas";
  if (!src) return <span className={cx(tile, "grid place-items-center text-xs text-faint")} title={t("The Ad Library link expired before this file was saved")}>{t("Expired")}</span>;
  const fail = () => setTried((n) => n + 1);
  return src.video
    ? <video key={src.url} src={`${src.url}#t=0.1`} muted playsInline preload="metadata" onError={fail} className={cx(tile, "object-cover")} aria-label={t("Earlier video")} />
    // eslint-disable-next-line @next/next/no-img-element
    : <img key={src.url} src={src.url} alt={t("Earlier image")} loading="lazy" onError={fail} className={cx(tile, "object-cover")} />;
}

// MARK: Word diff

type Part = { text: string; changed: boolean };
const MAX_TOKENS = 800;

/**
 * Word-level highlights between two texts (a longest common subsequence of words; whitespace stays with
 * the word before it). Null when either text is too long to compare cheaply: the texts show unmarked.
 */
export function wordDiff(a: string, b: string): { before: Part[]; after: Part[] } | null {
  const ta = a.match(/\S+\s*|\s+/g) ?? [];
  const tb = b.match(/\S+\s*|\s+/g) ?? [];
  if (ta.length > MAX_TOKENS || tb.length > MAX_TOKENS) return null;
  // Words compare without case and edge punctuation ("you." is "you"); a whitespace run matches any other.
  const word = (t: string) => t.trim().toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "") || t.trim();
  const wa = ta.map(word), wb = tb.map(word);
  const n = ta.length, m = tb.length;
  // lcs[i][j]: the common words of ta[i..] and tb[j..].
  const lcs = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) lcs[i][j] = wa[i] === wb[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  }
  const before: Part[] = [], after: Part[] = [];
  const push = (list: Part[], text: string, changed: boolean) => {
    const last = list[list.length - 1];
    if (last && last.changed === changed) last.text += text;
    else list.push({ text, changed });
  };
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && wa[i] === wb[j]) { push(before, ta[i++], false); push(after, tb[j++], false); }
    else if (j < m && (i >= n || lcs[i][j + 1] >= lcs[i + 1][j])) push(after, tb[j++], true);
    else push(before, ta[i++], true);
  }
  return { before, after };
}
