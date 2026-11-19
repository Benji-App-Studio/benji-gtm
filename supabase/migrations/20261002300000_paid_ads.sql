-- Research → Ads: competitors' PAID ads per workspace (a product), next to the organic posts runs
-- collect. The watchlist says whose ads to pull (a Meta Page, a TikTok advertiser or search terms, in
-- chosen countries); each pull is logged; ads are kept per workspace and refreshed on every pull, so
-- "days running" and "live variants" stay current. The `research` edge function (service role)
-- writes ads and pulls; users read their own rows and edit their watchlist.

-- MARK: Watchlist

create table public.ad_watchlist (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  network text not null default 'meta' check (network in ('meta', 'tiktok')),
  -- Meta: a Page id (numeric) is the precise way; search terms find ads that mention the brand.
  page_id text check (page_id is null or page_id ~ '^[0-9]{3,30}$'),
  page_url text,
  search_terms text,
  -- TikTok: the advertiser's business id in the Commercial Content Library.
  tiktok_advertiser_id text,
  countries text[] not null default '{US}',
  -- The competitor candidate (in a competitor project) this entry came from, if any.
  candidate_id text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (page_id is not null or search_terms is not null or tiktok_advertiser_id is not null or page_url is not null)
);
create index ad_watchlist_product_idx on public.ad_watchlist (product_id);
create index ad_watchlist_user_idx on public.ad_watchlist (user_id);
create trigger ad_watchlist_touch before update on public.ad_watchlist for each row execute function public.touch_updated_at();

-- MARK: Pulls (one per source per request; Apify pulls stay "running" until polled)

create table public.ad_pulls (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  source text not null check (source in ('meta_api', 'meta_apify', 'meta_mcp', 'tiktok_library', 'tiktok_creative_center', 'tiktok_apify')),
  status text not null default 'running' check (status in ('running', 'done', 'error')),
  apify_run_id text,
  input jsonb not null default '{}'::jsonb,
  ads integer not null default 0,
  usd numeric(10, 4) not null default 0,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index ad_pulls_product_idx on public.ad_pulls (product_id, started_at desc);
create index ad_pulls_user_idx on public.ad_pulls (user_id);

-- MARK: Ads

create table public.paid_ads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  watch_id uuid references public.ad_watchlist (id) on delete set null,
  network text not null check (network in ('meta', 'tiktok')),
  source text not null,
  ad_id text not null,
  page_id text,
  page_name text not null,
  competitor text,
  started_at timestamptz,
  stopped_at timestamptz,
  active boolean not null default true,
  placements text[] not null default '{}',
  media_type text not null default 'unknown' check (media_type in ('video', 'image', 'carousel', 'dco', 'text', 'unknown')),
  body text not null default '',
  headline text not null default '',
  description text not null default '',
  cta text not null default '',
  link_url text,
  media jsonb not null default '[]'::jsonb,
  thumb text,
  snapshot_url text,
  countries text[] not null default '{}',
  languages text[] not null default '{}',
  collation_id text,
  variants integer not null default 1,
  creative_key text,
  reach bigint,
  metrics jsonb,
  -- Jev's read of the ad (format, hook type, each line's role), and when it ran.
  decoded jsonb,
  decoded_at timestamptz,
  -- Handed to the format library (the formats package reads `library_seed`).
  library_seed jsonb,
  sent_to_library_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, network, ad_id)
);
create index paid_ads_product_idx on public.paid_ads (product_id, active, started_at);
create index paid_ads_user_idx on public.paid_ads (user_id);
create index paid_ads_watch_idx on public.paid_ads (watch_id);
create index paid_ads_creative_idx on public.paid_ads (product_id, creative_key);
create trigger paid_ads_touch before update on public.paid_ads for each row execute function public.touch_updated_at();

-- MARK: Row-level security

alter table public.ad_watchlist enable row level security;
alter table public.ad_pulls enable row level security;
alter table public.paid_ads enable row level security;

create policy "Users manage their ad watchlist" on public.ad_watchlist for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id and exists (
    select 1 from public.products p where p.id = product_id and p.user_id = (select auth.uid())));

create policy "Users read their ad pulls" on public.ad_pulls for select to authenticated using ((select auth.uid()) = user_id);

create policy "Users read their paid ads" on public.paid_ads for select to authenticated using ((select auth.uid()) = user_id);
-- Users may mark an ad (send to the format library) or remove it; ads themselves come from the edge function.
create policy "Users update their paid ads" on public.paid_ads for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users delete their paid ads" on public.paid_ads for delete to authenticated using ((select auth.uid()) = user_id);

-- Pull status streams to the Research page.
alter publication supabase_realtime add table public.ad_pulls;
