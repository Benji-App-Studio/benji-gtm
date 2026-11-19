// Edited ads: a re-pull or re-import of an ad we already have (same Library ID) may carry new copy, a
// new link or new media files, because advertisers edit running ads. `creativeChanges` compares the
// stored row with the incoming one; the research function then keeps the replaced version in
// paid_ad_versions and stamps paid_ads.creative_changed_at (migration 20261003700000).
//
// Only real edits count, so the dashboard doesn't cry wolf:
// - text is compared after collapsing whitespace; links by host and path (tracking parameters and the
//   CDN's signed query strings change on every fetch);
// - media by the set of file names (Meta's CDN keeps a file's name across fetches; the order of a
//   carousel's or DCO ad's cards may shuffle);
// - a field either side lacks (empty) is not a change: sources differ (some carry no media or no
//   description), so an ad first saved from one source isn't "edited" when another fills it in;
// - dynamic creative (DCO) ads rotate their copy, and catalog (DPA) ads fill `{{product.*}}` templates,
//   so for those only media changes count, and catalog ads not at all.

export type ChangedPart = "body" | "headline" | "description" | "cta" | "link" | "media";

export interface CreativeFields {
  media_type: string;
  body: string;
  headline: string;
  description: string;
  cta: string;
  link_url: string | null;
  media: { type: string; url: string; thumb?: string | null }[] | null;
}

const text = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim();

function link(value: string | null | undefined): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return `${u.hostname.replace(/^www\./, "").toLowerCase()}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return raw.split("?")[0].toLowerCase();
  }
}

/** A media file's name on Meta's CDN (stable across fetches; the signed query string is not). */
function fileName(url: string): string {
  try { return new URL(url).pathname.split("/").pop() ?? url; } catch { return url.split("?")[0].split("/").pop() ?? url; }
}

const mediaSet = (media: CreativeFields["media"]) => [...new Set((media ?? []).map((m) => fileName(m.url)).filter(Boolean))].sort().join("|");

const TEMPLATE = /\{\{\s*product\./i;

/** What changed between the stored ad and the incoming one ([] when nothing real did). */
export function creativeChanges(stored: CreativeFields, incoming: CreativeFields): ChangedPart[] {
  const catalog = [stored.body, incoming.body, stored.headline, incoming.headline].some((t) => TEMPLATE.test(t ?? ""));
  if (catalog) return [];
  const changed: ChangedPart[] = [];
  const dynamic = stored.media_type === "dco" || incoming.media_type === "dco";
  if (!dynamic) {
    for (const part of ["body", "headline", "description", "cta"] as const) {
      const now = text(incoming[part]);
      const was = text(stored[part]);
      if (now && was && now !== was) changed.push(part);
    }
    const nowLink = link(incoming.link_url);
    const wasLink = link(stored.link_url);
    if (nowLink && wasLink && nowLink !== wasLink) changed.push("link");
  }
  const nowMedia = mediaSet(incoming.media);
  const wasMedia = mediaSet(stored.media);
  if (nowMedia && wasMedia && nowMedia !== wasMedia) changed.push("media");
  return changed;
}
