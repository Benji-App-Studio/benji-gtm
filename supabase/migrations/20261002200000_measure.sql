-- Measure: one dashboard for a workspace's paid growth instead of checking Meta, RevenueCat and
-- AppStack separately. The `metrics` edge function pulls each source into the snapshot tables below
-- (Meta Insights per ad per day, RevenueCat charts per day, AppStack attributed events per ad per
-- day); the studio reads them as the signed-in user and works out CAC, ROAS, LTV:CAC and payback.
-- Snapshots are written only by the edge function (service role). Users read their own rows and can
-- change three things: their Measure settings, a campaign's role (testing or scaling) and the Radar
-- format an ad's creative belongs to.

-- MARK: Settings (per workspace)

create table public.measure_settings (
  product_id uuid primary key references public.products (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- Whose paying customers the headline CAC counts: AppStack's attributed ones when it's connected
  -- (auto), Meta's, or every new payer RevenueCat saw (blended). Per-ad splits use AppStack or Meta.
  cac_source text not null default 'auto' check (cac_source in ('auto', 'meta', 'appstack', 'revenuecat')),
  -- LTV: RevenueCat proceeds per new paid subscription (the first purchase), or a number the team sets.
  ltv_basis text not null default 'first_purchase' check (ltv_basis in ('first_purchase', 'manual')),
  ltv_manual numeric(12, 2) check (ltv_manual is null or ltv_manual >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index measure_settings_user_id_idx on public.measure_settings (user_id);
create trigger measure_settings_touch before update on public.measure_settings for each row execute function public.touch_updated_at();

-- MARK: Sync state (one row per workspace and source)

create table public.measure_sync (
  product_id uuid not null references public.products (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  source text not null check (source in ('meta', 'revenuecat', 'appstack')),
  status text not null check (status in ('ok', 'error', 'not_connected')),
  message text,
  -- Meta: the ad account's currency and the rate used to turn it into the report currency (USD).
  currency text,
  fx_rate numeric(18, 8),
  -- RevenueCat: the overview metrics snapshot (active trials, active subscriptions, MRR...).
  details jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  primary key (product_id, source)
);
create index measure_sync_user_id_idx on public.measure_sync (user_id);

-- MARK: Meta

create table public.meta_campaigns (
  product_id uuid not null references public.products (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  campaign_id text not null,
  name text not null default '',
  objective text,
  status text,
  daily_budget numeric(14, 2),
  lifetime_budget numeric(14, 2),
  -- Testing (low budget, new creatives) or scaling (the winners). Guessed from the name until set.
  role text check (role in ('testing', 'scaling')),
  updated_at timestamptz not null default now(),
  primary key (product_id, campaign_id)
);
create index meta_campaigns_user_id_idx on public.meta_campaigns (user_id);

create table public.meta_ads (
  product_id uuid not null references public.products (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  ad_id text not null,
  name text not null default '',
  status text,
  campaign_id text,
  adset_id text,
  adset_name text,
  creative_id text,
  creative_name text,
  thumbnail_url text,
  -- The Radar format this creative was made from (set by the creative studio, or by hand).
  format_id text,
  updated_at timestamptz not null default now(),
  primary key (product_id, ad_id)
);
create index meta_ads_user_id_idx on public.meta_ads (user_id);
create index meta_ads_creative_idx on public.meta_ads (product_id, creative_id);

-- Insights per ad per day, in the ad account's currency. The raw action arrays are kept so a new
-- conversion type can be counted later without another sync.
create table public.meta_daily (
  product_id uuid not null references public.products (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  ad_id text not null,
  date date not null,
  campaign_id text,
  adset_id text,
  spend numeric(14, 2) not null default 0,
  impressions bigint not null default 0,
  reach bigint not null default 0,
  clicks bigint not null default 0,
  link_clicks bigint not null default 0,
  installs numeric(12, 2) not null default 0,
  trials numeric(12, 2) not null default 0,
  purchases numeric(12, 2) not null default 0,
  purchase_value numeric(14, 2) not null default 0,
  actions jsonb not null default '[]'::jsonb,
  action_values jsonb not null default '[]'::jsonb,
  primary key (product_id, ad_id, date)
);
create index meta_daily_user_id_idx on public.meta_daily (user_id);
create index meta_daily_date_idx on public.meta_daily (product_id, date);

-- MARK: RevenueCat

-- One value per chart measure per day (and per segment, e.g. product duration P1M / P1Y).
create table public.revenuecat_daily (
  product_id uuid not null references public.products (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  chart text not null,
  measure text not null,
  segment text not null default '',
  value numeric(16, 4) not null default 0,
  primary key (product_id, date, chart, measure, segment)
);
create index revenuecat_daily_user_id_idx on public.revenuecat_daily (user_id);

-- MARK: AppStack

-- Attributed events per ad per day, counted by kind. Organic and other networks keep their own rows.
create table public.appstack_daily (
  product_id uuid not null references public.products (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  media_source text not null default '',
  campaign_id text not null default '',
  adset_id text not null default '',
  ad_id text not null default '',
  campaign_name text,
  ad_name text,
  installs integer not null default 0,
  trials integer not null default 0,
  purchases integer not null default 0,
  revenue_usd numeric(14, 2) not null default 0,
  primary key (product_id, date, media_source, campaign_id, adset_id, ad_id)
);
create index appstack_daily_user_id_idx on public.appstack_daily (user_id);

-- MARK: Row-level security (owner only)

alter table public.measure_settings enable row level security;
alter table public.measure_sync enable row level security;
alter table public.meta_campaigns enable row level security;
alter table public.meta_ads enable row level security;
alter table public.meta_daily enable row level security;
alter table public.revenuecat_daily enable row level security;
alter table public.appstack_daily enable row level security;

create policy "Users manage their measure settings" on public.measure_settings for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id and exists (
    select 1 from public.products p where p.id = product_id and p.user_id = (select auth.uid())));
create policy "Users read their sync state" on public.measure_sync for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users read their campaigns" on public.meta_campaigns for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users tag their campaigns" on public.meta_campaigns for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users read their ads" on public.meta_ads for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users tag their ads" on public.meta_ads for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users read their Meta insights" on public.meta_daily for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users read their RevenueCat metrics" on public.revenuecat_daily for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users read their AppStack metrics" on public.appstack_daily for select to authenticated using ((select auth.uid()) = user_id);

-- Users may only change a campaign's role and an ad's format; everything else is the sync's.
revoke insert, update, delete on public.meta_campaigns, public.meta_ads, public.meta_daily, public.revenuecat_daily, public.appstack_daily, public.measure_sync from anon, authenticated;
grant update (role) on public.meta_campaigns to authenticated;
grant update (format_id) on public.meta_ads to authenticated;

-- MARK: Scheduled sync (not turned on)

-- Every six hours, ask the metrics function to sync every workspace that has a connection. It reuses
-- the worker secret the radar watchdog already shares with the edge functions (Vault). Turn it on
-- once the secrets are set and a manual "Sync now" has worked, by running:
--
--   select cron.schedule('measure-sync', '23 */6 * * *', $$
--     select net.http_post(
--       url := 'https://hadmagbwpuqarmjvisci.supabase.co/functions/v1/metrics/sync-all',
--       headers := jsonb_build_object('Content-Type', 'application/json', 'x-radar-worker',
--         (select decrypted_secret from vault.decrypted_secrets where name = 'RADAR_WORKER_SECRET')),
--       body := '{}'::jsonb,
--       timeout_milliseconds := 10000
--     )
--   $$);
--
-- and to turn it off again: select cron.unschedule('measure-sync');
