import type { ProductRow, ProjectRow, ProjectSettings } from "@/lib/db";
import { APP_NAME } from "@/lib/brand-config";
import { isResponse, requireUser } from "@/lib/server/auth";
import { radar } from "@/lib/server/radar";
import { PLATFORMS, type Candidate, type Platform, type ProjectType } from "@/lib/types";

const TIMEFRAMES = [7, 14, 30, 60, 90, 180, 365];

/** Every project of the signed-in user (optionally one type), with its run history in brief. */
export async function GET(request: Request) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const type = new URL(request.url).searchParams.get("type");
  let query = session.supabase.from("projects").select("*").order("created_at", { ascending: false });
  if (type) query = query.eq("type", type);
  const { data: rows, error } = await query.returns<ProjectRow[]>();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const { data: runs } = await session.supabase.from("runs").select("project_id, status, posts, started_at").order("started_at", { ascending: false });
  return Response.json(rows.map((row) => {
    const mine = (runs ?? []).filter((r) => r.project_id === row.id);
    return {
      id: row.id, type: row.type, name: row.name, description: row.description, status: row.status, message: row.message, demo: row.demo,
      platforms: row.settings.platforms ?? [], sinceDays: row.settings.sinceDays, competitors: row.candidates.filter((c) => c.selected).length,
      runs: mine.length, lastRunAt: mine[0]?.started_at ?? null, posts: mine.find((r) => r.status === "done")?.posts ?? null, createdAt: row.created_at,
    };
  }));
}

/** Accounts typed in by the user: a name and handles per channel. */
function accountsFrom(list: unknown): Candidate[] {
  if (!Array.isArray(list)) return [];
  return list.flatMap((entry, i) => {
    const handles: Partial<Record<Platform, string>> = {};
    for (const platform of PLATFORMS) {
      const value = String(entry?.handles?.[platform] ?? "").trim().replace(/^@/, "").slice(0, 200);
      if (value) handles[platform] = value;
    }
    const name = String(entry?.name ?? "").trim().slice(0, 80) || (Object.values(handles)[0] ? `@${Object.values(handles)[0]}` : "");
    if (!name || !Object.keys(handles).length) return [];
    return [{ id: `acct-${i}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "")}`, name, handles, bio: "", followers: null, verified: false, website: null,
      kind: i === 0 ? "direct_competitor" : "adjacent_brand", kindConfidence: 1, similarity: 4, source: "you" as const, foundBy: ["you"], selected: true }];
  });
}

/** Creates a project. Competitor projects start finding competitors; account and campaign projects go straight to review. */
export async function POST(request: Request) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const body = await request.json().catch(() => ({}));
  const type: ProjectType = ["account", "campaign"].includes(body?.type) ? body.type : "competitors";
  const platforms: Platform[] = (body?.platforms ?? []).filter((p: string): p is Platform => PLATFORMS.includes(p as Platform));
  const sinceDays = TIMEFRAMES.includes(body?.sinceDays) ? body.sinceDays : type === "competitors" ? 30 : 90;
  const limitPerAccount = Math.min(60, Math.max(5, Number(body?.limitPerAccount) || (type === "competitors" ? 20 : 30)));
  const { supabase } = session;

  if (type === "competitors") {
    const { data: product } = await supabase.from("products").select("*").eq("id", body?.productId ?? "").maybeSingle<ProductRow>();
    if (!product) return Response.json({ error: "Choose one of your products." }, { status: 400 });
    if (!platforms.length) return Response.json({ error: "Pick at least one channel." }, { status: 400 });
    const keywords = (body?.keywords ?? []).map((k: unknown) => String(k).trim()).filter(Boolean).slice(0, 8);
    const settings: ProjectSettings = {
      platforms, sinceDays, limitPerAccount, keywords, includeNiche: Boolean(body?.includeNiche), readComments: body?.readComments !== false, partners: Boolean(body?.partners),
      audience: product.audience ?? undefined,
      category: product.category ?? "other", website: product.website ?? undefined,
      answers: { ...product.answers, kind: product.kind },
    };
    const { data: row, error } = await supabase.from("projects").insert({
      type, name: product.name, description: product.description, product_id: product.id, settings, status: "discovering", message: "Finding competitors…",
    }).select().single<ProjectRow>();
    if (error || !row) return Response.json({ error: error?.message ?? "Couldn't create the project." }, { status: 500 });
    // The search runs in the background; the project page follows it live.
    const started = await radar(session, "discover", { projectId: row.id });
    if (!started.ok) await supabase.from("projects").update({ status: "error", message: started.data.error ?? "Couldn't start the search." }).eq("id", row.id);
    return Response.json({ id: row.id });
  }

  const accounts = accountsFrom(body?.accounts);
  const name = String(body?.name ?? "").trim().slice(0, 80);
  const brandInstagram = String(body?.brandInstagram ?? "").trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//, "").split(/[/?]/)[0].slice(0, 60);
  const partners = type === "campaign" && Boolean(body?.partners) && Boolean(brandInstagram);
  if (!name) return Response.json({ error: type === "campaign" ? "Name the brand." : "Give the analysis a name." }, { status: 400 });
  if (type === "campaign" && body?.partners && !brandInstagram) return Response.json({ error: `Add the brand's Instagram handle so ${APP_NAME} can find its creators.` }, { status: 400 });
  if (!accounts.length && !partners) return Response.json({ error: type === "campaign" ? `Add at least one creator with a handle, or let ${APP_NAME} find the brand's creators.` : "Add the account's handle on at least one channel." }, { status: 400 });
  const mentions = (body?.mentions ?? []).map((m: unknown) => String(m).trim().toLowerCase()).filter(Boolean).slice(0, 12);
  if (brandInstagram && !mentions.includes(`@${brandInstagram.toLowerCase()}`)) mentions.push(`@${brandInstagram.toLowerCase()}`);
  if (type === "campaign" && !mentions.length) return Response.json({ error: "Add the words that mark a campaign post (the brand name, its @handle…)." }, { status: 400 });
  const used = PLATFORMS.filter((p) => accounts.some((a) => a.handles[p]));
  const description = String(body?.description ?? "").trim().slice(0, 2000) || (type === "campaign"
    ? (accounts.length ? `${accounts.length} creator${accounts.length === 1 ? "" : "s"} posting for ${name}` : `The creators posting for ${name}`) + `: the best UGC, who to rebook and how the brand shows up.`
    : `Every post from ${accounts[0].name} across its channels${accounts.length > 1 ? `, side by side with ${accounts.slice(1).map((a) => a.name).join(", ")}` : ""}.`);
  const chosen = platforms.length ? platforms.filter((p) => used.includes(p)) : used;
  const settings: ProjectSettings = {
    platforms: chosen.length ? chosen : ["instagram"], sinceDays, limitPerAccount, readComments: body?.readComments !== false,
    ...(type === "campaign" ? { brand: name, mentions, partners, ...(brandInstagram ? { brandInstagram } : {}) } : {}),
  };
  const { data: row, error } = await supabase.from("projects").insert({
    type, name, description, product_id: body?.productId ?? null, settings, candidates: accounts, status: "review",
  }).select().single<ProjectRow>();
  if (error || !row) return Response.json({ error: error?.message ?? "Couldn't create the project." }, { status: 500 });
  return Response.json({ id: row.id });
}
