// Competitor discovery: candidates from the founder's own list, OpenAI with web search and Apify's
// Instagram and TikTok profile searches are merged across platforms (links in bios fill in other
// channels), then the judge (_shared/ai) rates each against the founder's product. The founder then picks.
import type { AiProvider, Judge } from "../../_shared/ai/judge.ts";
import { choice, score } from "../../_shared/ai/questions.ts";
import { thresholdsFor } from "../../_shared/ai/thresholds.ts";
import type { Candidate, DiscoveryProject, Platform } from "./types.ts";

export const SEARCH_LIMIT = 15;
export const MAX_JUDGED = 60;

export const KINDS = {
  direct_competitor: "Sells a product that competes for the same customers as the founder's product.",
  adjacent_brand: "A brand in the same space selling something related, not a direct substitute.",
  creator: "An individual creator or influencer in this niche, not a brand.",
  media_or_community: "A media page, meme page, community or news account about the niche.",
  retailer_or_marketplace: "A shop, retailer, reseller or marketplace that sells many brands.",
  unrelated: "Not related to the founder's product or niche.",
};

/** Comparable form of a handle or name, so "@Celsius.Official" and "celsius" match. */
export const norm = (value: string) => value.toLowerCase().replace(/^@/, "").replace(/[^a-z0-9]/g, "").replace(/(official|hq|app|brand|global|inc|co)$/g, "");

/** Handles for other channels, from the links in a bio or website field. */
export function linksIn(text: string): Partial<Record<Platform, string>> {
  const found: Partial<Record<Platform, string>> = {};
  const match = (pattern: RegExp) => text.match(pattern)?.[1];
  const youtube = match(/youtube\.com\/(?:@|c\/|channel\/)?([A-Za-z0-9_.-]+)/i);
  const x = match(/(?:twitter|x)\.com\/([A-Za-z0-9_]{2,15})/i);
  const linkedin = match(/linkedin\.com\/company\/([A-Za-z0-9_-]+)/i);
  const tiktok = match(/tiktok\.com\/@([A-Za-z0-9_.]+)/i);
  const instagram = match(/instagram\.com\/([A-Za-z0-9_.]+)/i);
  if (youtube) found.youtube = youtube;
  if (x && !["home", "intent", "share"].includes(x.toLowerCase())) found.x = x;
  if (linkedin) found.linkedin = linkedin;
  if (tiktok) found.tiktok = tiktok;
  if (instagram && !["p", "reel", "explore"].includes(instagram.toLowerCase())) found.instagram = instagram;
  return found;
}

export function blank(name: string, source: Candidate["source"]): Candidate {
  return { id: norm(name) || name, name, handles: {}, bio: "", followers: null, verified: false, website: null, kind: "unrelated", kindConfidence: 0, similarity: 0, source, foundBy: [], selected: false };
}

export const instagramSearchInput = (keywords: string[]) => ({ search: keywords.join(", "), searchType: "user", searchLimit: SEARCH_LIMIT });
export const tiktokSearchInput = (keywords: string[]) => ({ searchQueries: keywords, searchSection: "/user", resultsPerPage: SEARCH_LIMIT, shouldDownloadVideos: false });

export function instagramCandidates(items: any[]): Candidate[] {
  return items.flatMap((item) => {
    const user = item.user ?? item;
    const username: string | undefined = user.username ?? user.userName;
    if (!username) return [];
    const candidate = blank(user.fullName || user.full_name || username, "search");
    candidate.handles.instagram = username;
    candidate.bio = user.biography ?? user.bio ?? "";
    candidate.followers = user.followersCount ?? user.followers ?? user.follower_count ?? null;
    candidate.verified = Boolean(user.verified ?? user.isVerified ?? user.is_verified);
    candidate.website = user.externalUrl ?? user.external_url ?? null;
    candidate.foundBy = [item.searchTerm ?? item.query ?? item.search ?? "instagram"];
    Object.assign(candidate.handles, { ...linksIn(`${candidate.bio} ${candidate.website ?? ""}`), instagram: username });
    return [candidate];
  });
}

export function tiktokCandidates(items: any[]): Candidate[] {
  return items.flatMap((item) => {
    const user = item.authorMeta ?? item.author ?? item;
    const handle: string | undefined = user.name ?? user.uniqueId ?? user.username;
    if (!handle) return [];
    const candidate = blank(user.nickName || user.nickname || handle, "search");
    candidate.handles.tiktok = handle;
    candidate.bio = user.signature ?? user.bio ?? "";
    candidate.followers = user.fans ?? user.followerCount ?? user.followers ?? null;
    candidate.verified = Boolean(user.verified);
    candidate.website = user.bioLink?.link ?? user.bioLink ?? null;
    candidate.foundBy = [item.searchQuery ?? item.input ?? "tiktok"];
    Object.assign(candidate.handles, { ...linksIn(`${candidate.bio} ${candidate.website ?? ""}`), tiktok: handle });
    return [candidate];
  });
}

/**
 * The OpenAI Responses request that names real competing brands and their social handles, using web
 * search. `background` lets a caller start it and collect the answer later.
 */
export function openAIRequest(project: DiscoveryProject, model: string, background = false) {
  const product = { name: project.name, description: project.description, website: project.website ?? null, category: project.category, ...project.answers };
  const handle = { type: ["string", "null"], description: "Handle or URL, or null when unknown" };
  return {
    model,
    ...(background ? { background: true, store: true } : {}),
    reasoning: { effort: "high" },
    tools: [{ type: "web_search" }],
    input: [
      { role: "system", content: "You research competitors for founders. Use web search thoroughly. Match on what the product does (its features, the job it does and who buys it), never on its name: a brand that shares the product's name but sells something else is not a competitor. Only list real, currently operating brands or products that compete for the same customers, with their official social accounts. Never invent handles: use null when unsure." },
      { role: "user", content: `Find up to 15 competitors of this product, closest first: direct competitors with the same core features first, then the strongest alternatives customers compare it with. Include each one's official Instagram, TikTok, YouTube, X and LinkedIn accounts and website.\n\n${JSON.stringify(product, null, 2)}` },
    ],
    text: {
      format: {
        type: "json_schema", name: "competitors", strict: true,
        schema: {
          type: "object", additionalProperties: false, required: ["competitors"],
          properties: {
            competitors: {
              type: "array",
              items: {
                type: "object", additionalProperties: false,
                required: ["name", "description", "website", "instagram", "tiktok", "youtube", "x", "linkedin"],
                properties: { name: { type: "string" }, description: { type: "string" }, website: handle, instagram: handle, tiktok: handle, youtube: handle, x: handle, linkedin: handle },
              },
            },
          },
        },
      },
    },
  };
}

/** Candidates from a finished OpenAI response. */
export function openAICandidates(data: any): Candidate[] {
  const text = data?.output_text ?? data?.output?.flatMap((item: any) => item.content ?? []).find((part: any) => part.type === "output_text")?.text;
  let parsed: { competitors?: any[] } = {};
  try { parsed = JSON.parse(text ?? "{}"); } catch { return []; }
  const tidy = (value: unknown, platform: Platform) => {
    if (typeof value !== "string" || !value.trim()) return undefined;
    const fromLink = linksIn(value)[platform];
    return (fromLink ?? value.trim().replace(/^@/, "").replace(/\/$/, "")).slice(0, 120);
  };
  return (parsed.competitors ?? []).filter((c) => c?.name).map((c) => {
    const candidate = blank(String(c.name), "ai");
    candidate.bio = String(c.description ?? "");
    candidate.website = c.website ?? null;
    for (const platform of ["instagram", "tiktok", "youtube", "x", "linkedin"] as Platform[]) {
      const value = tidy(c[platform], platform);
      if (value && !value.includes(" ")) candidate.handles[platform] = value;
    }
    candidate.foundBy = ["openai"];
    return candidate;
  });
}

/** The founder's own list: "@celsius", "Liquid Death", "monster.energy" … each becomes a candidate to complete. */
export function known(text: string | undefined): Candidate[] {
  return (text ?? "").split(/[\n,]/).map((part) => part.trim()).filter(Boolean).map((entry) => {
    const candidate = blank(entry.replace(/^@/, ""), "you");
    if (entry.startsWith("@") || /^[a-z0-9_.]+$/.test(entry)) candidate.handles.instagram = entry.replace(/^@/, "");
    Object.assign(candidate.handles, linksIn(entry));
    candidate.kind = "direct_competitor";
    candidate.kindConfidence = 1;
    candidate.similarity = 4;
    candidate.selected = true;
    return candidate;
  });
}

/** Folds candidates for the same brand together: matching handles or names on any platform. */
export function merge(list: Candidate[]): Candidate[] {
  const merged: Candidate[] = [];
  for (const candidate of list) {
    const keys = new Set([candidate.name, ...Object.values(candidate.handles)].filter(Boolean).map((v) => norm(v!)).filter((k) => k.length >= 3));
    const twin = merged.find((m) => [m.name, ...Object.values(m.handles)].filter(Boolean).some((v) => keys.has(norm(v!))));
    if (!twin) { merged.push(candidate); continue; }
    for (const [platform, handle] of Object.entries(candidate.handles)) twin.handles[platform as Platform] ??= handle;
    twin.bio ||= candidate.bio;
    twin.followers = Math.max(twin.followers ?? 0, candidate.followers ?? 0) || null;
    twin.verified ||= candidate.verified;
    twin.website ??= candidate.website;
    twin.foundBy = [...new Set([...twin.foundBy, ...candidate.foundBy])];
    if (candidate.source === "you") Object.assign(twin, { source: "you", kind: candidate.kind, kindConfidence: 1, similarity: 4, selected: true });
    else if (candidate.source === "ai" && twin.source === "search") twin.source = "ai";
  }
  return merged.map((c) => ({ ...c, id: norm(Object.values(c.handles)[0] ?? c.name) || c.id }));
}

/** The founder's picks, then OpenAI's, then the most-followed search results; at most MAX_JUDGED. */
export const shortlist = (merged: Candidate[]) => [...merged]
  .sort((a, b) => ({ you: 0, ai: 1, search: 2 }[a.source] - { you: 0, ai: 1, search: 2 }[b.source]) || (b.followers ?? 0) - (a.followers ?? 0))
  .slice(0, MAX_JUDGED);

/** Jev judges each candidate (kind and closeness) a few at a time. Returns the input tokens used. */
export async function judge(client: Judge, project: DiscoveryProject, candidates: Candidate[], onJudged?: (done: number, total: number) => void) {
  const product = { name: project.name, description: project.description, category: project.category, ...project.answers };
  const queue = candidates.filter((c) => c.source !== "you");
  const total = queue.length;
  let tokens = 0, done = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    for (let candidate = queue.shift(); candidate; candidate = queue.shift()) {
      try {
        const { answers, usage } = await client.systemOne({
          state: { product, candidate: { name: candidate.name, handles: candidate.handles, bio: candidate.bio, followers: candidate.followers, website: candidate.website } },
          questions: {
            kind: choice("What is `candidate`, relative to the founder's `product`?", KINDS),
            similarity: score("How close is what `candidate` sells to the founder's `product` (same customers, same need)?", [
              "Nothing in common.",
              "Same broad space, different product and customer.",
              "Related product or overlapping customers.",
              "Close substitute for some customers.",
              "Direct competitor: same product type for the same customers.",
            ]),
          },
        });
        tokens += usage.input_tokens;
        candidate.kind = answers.kind.choice;
        candidate.kindConfidence = answers.kind.confidence;
        candidate.similarity = Math.round(answers.similarity.score * 10) / 10;
      } catch {
        // An unjudged candidate stays "unrelated" and unselected; the founder can still pick it.
      }
      onJudged?.(++done, total);
    }
  }));
  return tokens;
}

/**
 * Pre-selects the closest brands (the founder can change any of it) and orders the list for review.
 * `provider` is the judge that rated them (`judge.provider`): how close counts as close depends on it
 * (_shared/ai/thresholds.ts). Left out, the TypeSafe value applies, as before.
 */
export function preselect(judged: Candidate[], provider?: AiProvider) {
  const closeAt = thresholdsFor(provider).discover.preselectSimilarity;
  const brands = judged.filter((c) => c.kind === "direct_competitor" || c.kind === "adjacent_brand")
    .sort((a, b) => b.similarity - a.similarity || (b.followers ?? 0) - (a.followers ?? 0));
  brands.filter((c) => c.source !== "you").slice(0, 6).forEach((c) => { if (c.similarity >= closeAt) c.selected = true; });
  const ordered = [...judged].sort((a, b) => Number(b.selected) - Number(a.selected) || b.similarity - a.similarity);
  return { ordered, brands };
}
