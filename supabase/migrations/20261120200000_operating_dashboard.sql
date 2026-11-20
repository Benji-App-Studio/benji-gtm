-- The operating dashboard: Measure reads Mixpanel (the app's own funnel, retention and active users)
-- and Superwall (paywall views and purchases per paywall and placement) next to Meta, RevenueCat and
-- AppStack, and works out unit economics and a 12-month projection from them.
--
-- Additive only: two snapshot tables written by the `metrics` edge function (service role) and read
-- by their owner, wider checks on the two Measure tables that name sources, a saved projection
-- scenario per app, and the two new key names. Safe to run on any install (older ones included).

-- MARK: Mixpanel

-- One value per day per metric (and per segment): funnel_<step> and active are unique users that day,
-- retention / retention_size are birth cohorts (date = the cohort's day, segment 'D<N>'), and
-- ttc_seconds / ttc_conversions are a saved funnel's mean time to convert and its converters.
create table if not exists public.mixpanel_daily (
  product_id uuid not null references public.products (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  metric text not null,
  segment text not null default '',
  value numeric(18, 4) not null default 0,
  primary key (product_id, date, metric, segment)
);
create index if not exists mixpanel_daily_user_id_idx on public.mixpanel_daily (user_id);

-- MARK: Superwall

-- SDK events per day per paywall and placement (production only); revenue and refunds (USD) per day
-- sit on the day's row with an empty paywall and placement, since Superwall doesn't split them.
create table if not exists public.superwall_daily (
  product_id uuid not null references public.products (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  paywall text not null default '',
  placement text not null default '',
  opens integer not null default 0,
  conversions integer not null default 0,
  trials integer not null default 0,
  starts integer not null default 0,
  revenue_usd numeric(14, 2) not null default 0,
  refunds_usd numeric(14, 2) not null default 0,
  primary key (product_id, date, paywall, placement)
);
create index if not exists superwall_daily_user_id_idx on public.superwall_daily (user_id);

-- MARK: Row-level security (owner reads; only the sync writes)

alter table public.mixpanel_daily enable row level security;
alter table public.superwall_daily enable row level security;

drop policy if exists "Users read their Mixpanel metrics" on public.mixpanel_daily;
create policy "Users read their Mixpanel metrics" on public.mixpanel_daily for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Users read their Superwall metrics" on public.superwall_daily;
create policy "Users read their Superwall metrics" on public.superwall_daily for select to authenticated using ((select auth.uid()) = user_id);

-- The install's membership, as on every other table (20261119130000_install_members_only.sql).
drop policy if exists "Install members only" on public.mixpanel_daily;
create policy "Install members only" on public.mixpanel_daily as restrictive for all to authenticated
  using ((select public.install_allows())) with check ((select public.install_allows()));
drop policy if exists "Install members only" on public.superwall_daily;
create policy "Install members only" on public.superwall_daily as restrictive for all to authenticated
  using ((select public.install_allows())) with check ((select public.install_allows()));

revoke insert, update, delete on public.mixpanel_daily, public.superwall_daily from anon, authenticated;

-- MARK: Measure's source lists

alter table public.measure_sync drop constraint if exists measure_sync_source_check;
alter table public.measure_sync add constraint measure_sync_source_check
  check (source in ('meta', 'revenuecat', 'appstack', 'mixpanel', 'superwall'));

-- The headline CAC can also count Mixpanel's purchase event or Superwall's purchases (both blended,
-- like RevenueCat: they can't say which ad brought whom).
alter table public.measure_settings drop constraint if exists measure_settings_cac_source_check;
alter table public.measure_settings add constraint measure_settings_cac_source_check
  check (cac_source in ('auto', 'meta', 'appstack', 'revenuecat', 'mixpanel', 'superwall'));

-- The projection panel's saved scenario (daily spend, CPI, trial rate, trial to paid, plans, churn,
-- refunds, store fee), as the studio's lib/unit-economics.ts cleans it. Null: prefilled from the data.
alter table public.measure_settings add column if not exists scenario jsonb;

-- MARK: Key names

-- Every name the install_core migration allowed, plus the Mixpanel service account and Superwall key.
create or replace function public.install_secret_allowed(p_name text) returns boolean
language sql immutable set search_path = '' as $$
  select p_name in (
    'OPENAI_API_KEY', 'TYPESAFE_API_KEY', 'APIFY_TOKEN',
    'META_AD_LIBRARY_TOKEN', 'META_SYSTEM_USER_TOKEN', 'META_APP_SECRET',
    'REVENUECAT_API_KEY', 'APPSTACK_API_KEY', 'HIGGSFIELD_API_KEY',
    'GOOGLE_SERVICE_ACCOUNT_JSON', 'CREATIVES_RUNNER_SECRET',
    'TIKTOK_RESEARCH_CLIENT_KEY', 'TIKTOK_RESEARCH_CLIENT_SECRET',
    'MIXPANEL_SERVICE_ACCOUNT', 'SUPERWALL_API_KEY'
  ) or p_name ~ '^APPSTACK_API_KEY_[A-Za-z0-9_]{1,64}$';
$$;

comment on table public.mixpanel_daily is 'Measure: a product''s Mixpanel funnel, active users, retention and time to convert per day (written by the metrics edge function).';
comment on table public.superwall_daily is 'Measure: a product''s Superwall paywall views, purchases and trials per paywall and placement per day, and revenue per day.';
