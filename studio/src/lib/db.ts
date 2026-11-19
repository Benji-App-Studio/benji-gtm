// Database rows (Supabase) and how they map to the shapes the pages use.
import type { Candidate, Platform, Project, ProjectStatus, ProjectType, RunProgress } from "./types";

export type ProductKind = "saas" | "mobile_app" | "physical_product" | "clothing" | "food_beverage" | "restaurant" | "local_service" | "creator_education" | "other";
export type Stage = "idea" | "pre_launch" | "launched" | "established";
export type Socials = Partial<Record<Platform | "facebook" | "website", string>>;

export interface ProductRow {
  id: string;
  user_id: string;
  name: string;
  kind: ProductKind;
  description: string;
  website: string | null;
  stage: Stage | null;
  audience: string | null;
  price_tier: string | null;
  sales_channel: string | null;
  region: string | null;
  socials: Socials;
  known_competitors: string[];
  answers: Record<string, string>;
  category: string | null;
  category_label: string | null;
  platform_scores: Record<Platform, number> | null;
  keywords: string[];
  is_primary: boolean;
  created_at: string;
  updated_at: string;
  /** The workspace's brand kit JSON (lib/workspace-schema.ts readBrandKit). */
  brand_kit?: unknown;
  /** Extra links the AI reads with the website: App Store / Google Play listings, other sites. */
  links?: string[];
  /** The AI product profile (lib/product-insight.ts) and its run. */
  insight?: import("./product-insight").ProductInsight | null;
  insight_status?: "running" | "done" | "failed" | null;
  insight_message?: string | null;
  insight_started_at?: string | null;
  insight_at?: string | null;
  insight_applied_at?: string | null;
  insight_backup?: unknown;
}

/** Per-project choices, stored as JSON so each project type can keep what it needs. */
export interface ProjectSettings {
  platforms: Platform[];
  sinceDays: number;
  limitPerAccount: number;
  keywords?: string[];
  /** Also analyse the top content around the keywords (always on when no competitors are picked). */
  includeNiche?: boolean;
  /** Fetch more comments for each channel's most-viewed posts (better buyer and audience insights). On unless turned off. */
  readComments?: boolean;
  /** Who buys the product, so niche posts aimed at them count as on-topic. */
  audience?: string;
  /** Partnership detection: find the creators who post for the brand (campaigns) or each competitor. */
  partners?: boolean;
  /** Campaigns: the brand's Instagram handle, whose tagged feed and collab posts find its creators. */
  brandInstagram?: string;
  brand?: string;
  mentions?: string[];
  category?: string;
  answers?: Record<string, string>;
  website?: string;
}

export interface ProjectRow {
  id: string;
  user_id: string;
  product_id: string | null;
  type: ProjectType;
  name: string;
  description: string;
  settings: ProjectSettings;
  candidates: Candidate[];
  status: ProjectStatus;
  message: string | null;
  demo: boolean;
  created_at: string;
  updated_at: string;
}

export interface RunRow {
  id: string;
  project_id: string;
  user_id: string;
  status: "running" | "done" | "error";
  phase: string | null;
  message: string | null;
  settings: ProjectSettings;
  competitors: { name: string }[];
  posts: number | null;
  apify_usd: number;
  jev_tokens: number;
  /** Live progress while the run goes: each scrape, how many posts Jev has decoded. */
  progress: RunProgress;
  started_at: string;
  finished_at: string | null;
}

/** Runs keep their (large) reports in run_reports, so a run row is already a summary. */
export type RunSummary = RunRow;
export const RUN_SUMMARY_COLUMNS = "id, project_id, user_id, status, phase, message, settings, competitors, posts, apify_usd, jev_tokens, progress, started_at, finished_at";

/** A line in a project's activity feed, written by the backend as work happens. */
export interface ActivityRow { id: number; run_id: string | null; level: "info" | "warn" | "error" | "done"; message: string; created_at: string }

export function toProject(row: ProjectRow): Project & { productId: string | null; includeNiche: boolean; readComments: boolean; partners: boolean; brandInstagram?: string } {
  const s = row.settings;
  return {
    id: row.id, type: row.type, name: row.name, description: row.description,
    category: s.category ?? "other", answers: s.answers ?? {}, keywords: s.keywords ?? [], website: s.website,
    platforms: s.platforms ?? ["instagram"], sinceDays: s.sinceDays ?? 30, limitPerAccount: s.limitPerAccount ?? 20,
    brand: s.brand, mentions: s.mentions, includeNiche: s.includeNiche ?? false, readComments: s.readComments ?? true, partners: s.partners ?? false, brandInstagram: s.brandInstagram,
    status: row.status, message: row.message ?? undefined, candidates: row.candidates ?? [],
    createdAt: row.created_at, updatedAt: row.updated_at, demo: row.demo, productId: row.product_id,
  };
}

export const KIND_LABEL: Record<ProductKind, string> = {
  saas: "SaaS / software", mobile_app: "Mobile app", physical_product: "Physical product", clothing: "Clothing brand",
  food_beverage: "Food & drink brand", restaurant: "Restaurant or food chain", local_service: "Local service / logistics",
  creator_education: "Creator, course or community", other: "Something else",
};

export const STAGE_LABEL: Record<Stage, string> = {
  idea: "Just an idea", pre_launch: "Building, not launched", launched: "Launched, early customers", established: "Established, growing",
};
