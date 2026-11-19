-- Market: app-store research on a product's competitors (the Market page, the insight function's
-- `market-*` routes in supabase/functions/insight/market.ts).
--
--   market_apps        the competitors' apps a product tracks (App Store, or Google Play through Apify),
--                      with the listing as last read: rating, price, version, dates, release notes, and
--                      its rank when it was last seen in a top chart.
--   market_snapshots   one row per app per day it was read: rating, rating count, version, chart rank.
--   market_releases    versions seen: the store's current one (with its notes) and older ones named in
--                      reviews, dated by the first review written on them.
--   market_reviews     customer reviews, verbatim, one per store review id.
--   market_summaries   what OpenAI read: per app (kind 'app', scope = the app's id) and per top chart
--                      (kind 'category', scope '<kind>:<genre|all>:<country>').
--
-- The browser reads its own rows (and may stop tracking an app); every write goes through the edge
-- function with the service role, which checks the product is the caller's.

-- MARK: Tracked apps

create table public.market_apps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  store text not null check (store in ('app_store', 'google_play')),
  store_id text not null check (char_length(store_id) between 3 and 150),
  bundle_id text,
  name text not null check (char_length(name) <= 200),
  developer text,
  developer_id text,
  icon_url text,
  url text,
  category text,
  category_id text,
  price numeric,
  currency text,
  price_label text,
  -- Apple's API never says; null until something does.
  has_iap boolean,
  rating numeric check (rating is null or (rating >= 0 and rating <= 5)),
  rating_count integer,
  version text,
  released_at timestamptz,
  store_updated_at timestamptz,
  release_notes text,
  description text,
  -- The store country it was read in ("us", "gb").
  country text not null default 'us' check (country ~ '^[a-z]{2}$'),
  -- The competitor on the product's list it was tracked for, when it was.
  competitor_name text,
  chart_rank integer,
  chart_label text,
  chart_at timestamptz,
  refreshed_at timestamptz,
  refresh_message text,
  created_at timestamptz not null default now(),
  unique (product_id, store, store_id)
);

create index market_apps_product_idx on public.market_apps (product_id, created_at);

-- MARK: Snapshots

create table public.market_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  app_id uuid not null references public.market_apps (id) on delete cascade,
  day date not null,
  rating numeric,
  rating_count integer,
  version text,
  rank integer,
  chart text,
  created_at timestamptz not null default now(),
  unique (app_id, day)
);

create index market_snapshots_app_idx on public.market_snapshots (app_id, day desc);

-- MARK: Releases

create table public.market_releases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  app_id uuid not null references public.market_apps (id) on delete cascade,
  version text not null,
  released_at timestamptz,
  notes text,
  source text not null default 'store' check (source in ('store', 'reviews')),
  created_at timestamptz not null default now(),
  unique (app_id, version)
);

create index market_releases_app_idx on public.market_releases (app_id, released_at desc);

-- MARK: Reviews

create table public.market_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  app_id uuid not null references public.market_apps (id) on delete cascade,
  store_review_id text not null,
  rating smallint not null check (rating between 1 and 5),
  title text,
  body text not null,
  author text,
  version text,
  reviewed_at timestamptz,
  country text,
  created_at timestamptz not null default now(),
  unique (app_id, store_review_id)
);

create index market_reviews_app_idx on public.market_reviews (app_id, reviewed_at desc);

-- MARK: AI summaries

create table public.market_summaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  app_id uuid references public.market_apps (id) on delete cascade,
  kind text not null check (kind in ('app', 'category')),
  scope text not null check (char_length(scope) <= 120),
  summary jsonb not null default '{}'::jsonb check (jsonb_typeof(summary) = 'object'),
  review_count integer,
  model text,
  created_at timestamptz not null default now(),
  unique (product_id, kind, scope)
);

-- MARK: Row-level security

alter table public.market_apps enable row level security;
alter table public.market_snapshots enable row level security;
alter table public.market_releases enable row level security;
alter table public.market_reviews enable row level security;
alter table public.market_summaries enable row level security;

create policy "Users read their tracked apps" on public.market_apps for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Users stop tracking their apps" on public.market_apps for delete to authenticated
  using (user_id = (select auth.uid()));
create policy "Users read their app snapshots" on public.market_snapshots for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Users read their app releases" on public.market_releases for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Users read their app reviews" on public.market_reviews for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Users read their market summaries" on public.market_summaries for select to authenticated
  using (user_id = (select auth.uid()));

-- The install's membership, as on every other table (20261119130000_install_members_only.sql).
create policy "Install members only" on public.market_apps as restrictive for all to authenticated
  using ((select public.install_allows())) with check ((select public.install_allows()));
create policy "Install members only" on public.market_snapshots as restrictive for all to authenticated
  using ((select public.install_allows())) with check ((select public.install_allows()));
create policy "Install members only" on public.market_releases as restrictive for all to authenticated
  using ((select public.install_allows())) with check ((select public.install_allows()));
create policy "Install members only" on public.market_reviews as restrictive for all to authenticated
  using ((select public.install_allows())) with check ((select public.install_allows()));
create policy "Install members only" on public.market_summaries as restrictive for all to authenticated
  using ((select public.install_allows())) with check ((select public.install_allows()));

comment on table public.market_apps is 'Competitors'' apps a product tracks on the Market page (App Store, or Google Play through Apify), as last read.';
comment on table public.market_snapshots is 'A tracked app''s rating, rating count, version and chart rank, one row per day it was read.';
comment on table public.market_releases is 'Versions of a tracked app: the store''s current one, and older ones dated by the first review written on them.';
comment on table public.market_reviews is 'Customer reviews of tracked apps, verbatim.';
comment on table public.market_summaries is 'OpenAI''s reading of a tracked app''s reviews (kind app) or of a top chart (kind category).';
