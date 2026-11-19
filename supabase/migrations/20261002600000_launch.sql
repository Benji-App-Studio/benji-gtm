-- Launch: per-workspace settings for putting approved creatives on Meta as PAUSED drafts, the drafts
-- themselves, and the upload jobs the `launch` edge function works through. A workspace is a product
-- (/app/w/[productId]). Every row belongs to one user; RLS keeps each user to their own rows.
-- The Meta system-user token is an edge function secret (META_SYSTEM_USER_TOKEN), never a column.

-- MARK: Settings (one row per workspace)

create table public.launch_settings (
  product_id uuid primary key references public.products (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- Short code that starts every name (BW, NOLA); defaults to the app name's initials.
  app_code text check (app_code is null or app_code ~ '^[A-Z0-9]{2,6}$'),
  objective text not null default 'website_traffic' check (objective in ('app_promotion', 'website_traffic')),
  -- A copy of the workspace's Meta connection and links, saved from the studio:
  -- { adAccountId, pageId, instagramId, pixelId, appId, appStoreUrl, websiteUrl, appName }.
  meta jsonb not null default '{}'::jsonb,
  countries text[] not null default '{US}',
  testing_campaign_id text check (testing_campaign_id is null or testing_campaign_id ~ '^\d{5,25}$'),
  testing_adset_id text check (testing_adset_id is null or testing_adset_id ~ '^\d{5,25}$'),
  scaling_campaign_id text check (scaling_campaign_id is null or scaling_campaign_id ~ '^\d{5,25}$'),
  scaling_adset_id text check (scaling_adset_id is null or scaling_adset_id ~ '^\d{5,25}$'),
  -- Budgets in the ad account's currency (major units, e.g. 500 = ₹500); only used by the setup step.
  testing_daily_budget numeric(12, 2) check (testing_daily_budget is null or testing_daily_budget > 0),
  scaling_daily_budget numeric(12, 2) check (scaling_daily_budget is null or scaling_daily_budget > 0),
  -- Guardrail: no setup step above it, and the daily automation won't add ads to an ad set above it.
  max_daily_budget numeric(12, 2) check (max_daily_budget is null or max_daily_budget > 0),
  -- Promotion and pause rules (studio/src/lib/launch/promotion.ts has the defaults).
  thresholds jsonb not null default '{}'::jsonb,
  default_cta text,
  -- Daily uploads: OFF until the user turns them on.
  automation_enabled boolean not null default false,
  automation_max_ads_per_day integer not null default 3 check (automation_max_ads_per_day between 1 and 20),
  automation_max_ads_in_adset integer not null default 20 check (automation_max_ads_in_adset between 1 and 50),
  automation_last_run_at timestamptz,
  automation_last_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index launch_settings_user_id_idx on public.launch_settings (user_id);
create index launch_settings_automation_idx on public.launch_settings (product_id) where automation_enabled;
create trigger launch_settings_touch before update on public.launch_settings for each row execute function public.touch_updated_at();

-- MARK: Upload jobs (the worker's; users can read their own)

create table public.launch_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  status text not null default 'running' check (status in ('running', 'done', 'error', 'cancelled')),
  lease_until timestamptz,
  wakes integer not null default 0,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index launch_jobs_running_idx on public.launch_jobs (lease_until) where status = 'running';
create index launch_jobs_user_id_idx on public.launch_jobs (user_id);
create index launch_jobs_product_id_idx on public.launch_jobs (product_id);
create trigger launch_jobs_touch before update on public.launch_jobs for each row execute function public.touch_updated_at();

-- MARK: Drafts (one per ad Launch made or is making)

create table public.launch_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  job_id uuid references public.launch_jobs (id) on delete set null,
  source text not null default 'manual' check (source in ('manual', 'automation', 'promotion')),
  stage text not null default 'TEST' check (stage in ('TEST', 'SCALE')),
  -- The studio creative's id, and a copy of what was launched (url, kind, format, hook…).
  creative_ref text not null,
  creative jsonb not null,
  ad_name text not null,
  primary_text text not null default '',
  headline text not null default '',
  cta text not null default '',
  link text not null default '',
  adset_id text not null,
  status text not null default 'queued' check (status in ('queued', 'processing', 'creating', 'draft', 'error', 'cancelled')),
  image_hash text,
  video_id text,
  thumbnail_url text,
  meta_creative_id text,
  ad_id text,
  promoted_from_ad_id text,
  reason text,
  attempts integer not null default 0,
  error text,
  next_check_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index launch_drafts_product_idx on public.launch_drafts (product_id, created_at desc);
create index launch_drafts_job_idx on public.launch_drafts (job_id) where status in ('queued', 'processing', 'creating');
create index launch_drafts_user_id_idx on public.launch_drafts (user_id);
create index launch_drafts_ad_id_idx on public.launch_drafts (ad_id);
create trigger launch_drafts_touch before update on public.launch_drafts for each row execute function public.touch_updated_at();

-- MARK: Row-level security (owner only)

alter table public.launch_settings enable row level security;
alter table public.launch_jobs enable row level security;
alter table public.launch_drafts enable row level security;

create policy "Users manage their launch settings" on public.launch_settings for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id and exists (
    select 1 from public.products p where p.id = product_id and p.user_id = (select auth.uid())));
-- Jobs and drafts are written by the edge function (service role); users read theirs.
create policy "Users read their launch jobs" on public.launch_jobs for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users read their launch drafts" on public.launch_drafts for select to authenticated using ((select auth.uid()) = user_id);

alter publication supabase_realtime add table public.launch_drafts;

-- MARK: Leases

create function public.launch_claim_job(p_job uuid, p_seconds integer) returns setof public.launch_jobs
language sql security definer set search_path = '' as $$
  update public.launch_jobs
     set lease_until = now() + make_interval(secs => p_seconds), wakes = wakes + 1
   where id = p_job and status = 'running' and (lease_until is null or lease_until < now())
  returning *;
$$;

create function public.launch_idle_jobs() returns setof uuid
language sql security definer set search_path = '' as $$
  select id from public.launch_jobs where status = 'running' and (lease_until is null or lease_until < now()) order by updated_at limit 20;
$$;

-- MARK: Secrets (Vault)

-- The worker secret shared by the launch function and its cron jobs, generated here so it never
-- leaves the database, and the function's address. META_SYSTEM_USER_TOKEN / META_APP_SECRET may
-- also live in Vault under those names (edge function secrets take precedence).
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'LAUNCH_WORKER_SECRET', 'Shared by the launch edge function and its cron jobs');
select vault.create_secret('https://hadmagbwpuqarmjvisci.supabase.co/functions/v1/launch', 'LAUNCH_URL', 'Where the launch cron jobs call the launch function');

create function public.launch_secrets() returns table (name text, value text)
language sql security definer set search_path = '' as $$
  select s.name, s.decrypted_secret from vault.decrypted_secrets s
   where s.name in ('LAUNCH_WORKER_SECRET', 'LAUNCH_URL', 'META_SYSTEM_USER_TOKEN', 'META_APP_SECRET');
$$;

-- Calls a launch route with the worker secret (the watchdog and the daily automation).
create function public.launch_call(p_route text) returns void
language plpgsql security definer set search_path = '' as $$
declare url text; secret text;
begin
  if p_route not in ('tick', 'daily') then raise exception 'Unknown route %', p_route; end if;
  select decrypted_secret into url from vault.decrypted_secrets where name = 'LAUNCH_URL';
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'LAUNCH_WORKER_SECRET';
  if url is null or secret is null then return; end if;
  perform net.http_post(
    url := url || '/' || p_route,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-launch-worker', secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
end;
$$;

-- Wakes upload jobs whose worker stopped (only calls out when one exists).
create function public.launch_watchdog() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.launch_jobs where status = 'running' and (lease_until is null or lease_until < now())) then
    perform public.launch_call('tick');
  end if;
end;
$$;

revoke execute on function public.launch_claim_job(uuid, integer) from public, anon, authenticated;
revoke execute on function public.launch_idle_jobs() from public, anon, authenticated;
revoke execute on function public.launch_secrets() from public, anon, authenticated;
revoke execute on function public.launch_call(text) from public, anon, authenticated;
revoke execute on function public.launch_watchdog() from public, anon, authenticated;
grant execute on function public.launch_claim_job(uuid, integer) to service_role;
grant execute on function public.launch_idle_jobs() to service_role;
grant execute on function public.launch_secrets() to service_role;

-- MARK: Schedules

-- The upload watchdog: every 30 seconds, cheap when idle (no HTTP call unless a job is stranded).
select cron.schedule('launch-watchdog', '30 seconds', 'select public.launch_watchdog()');

-- The daily automation, NOT scheduled by this migration. When a workspace is ready (testing ad set
-- chosen, max daily budget set, daily uploads switched on in Launch), schedule it once with:
--
--   select cron.schedule('launch-daily', '0 4 * * *', $$select public.launch_call('daily')$$);
--
-- 04:00 UTC = 09:30 IST, before the working day. Each run, for every workspace with
-- automation_enabled: takes the newest approved creatives without a draft, at most
-- automation_max_ads_per_day and never past automation_max_ads_in_adset, and only if the testing ad
-- set's daily budget is under max_daily_budget; queues them as PAUSED drafts in the testing ad set
-- and notes the outcome in automation_last_note. It creates no campaigns or ad sets and spends
-- nothing until someone publishes the drafts in Ads Manager. Stop it with:
--
--   select cron.unschedule('launch-daily');
