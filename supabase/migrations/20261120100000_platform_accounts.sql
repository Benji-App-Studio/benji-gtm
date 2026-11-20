-- Accounts mode: one database hosts many separate accounts (a public sign-up), each with its own keys,
-- settings, storage and plan. The same code keeps its two older modes:
--   * accounts   a `platform` row exists (this migration adds the table; platform_enable() adds the row)
--   * install    an `install` row exists (setup's owner and members, install-wide keys)
--   * legacy     neither (a database from before installs had owners)
-- A platform row wins: any install row stays inert while it exists. Nothing here changes an install or
-- a legacy database until platform_enable() is called; every new table is empty and every guard returns
-- early outside accounts mode.
--
--   platform        one row: platform settings (the Supabase plan's limits: wallClockSec, uploadLimitMb,
--                   storageQuotaGb, shared by every account)
--   plans           free, pro, staff: what each plan allows (maxApps, storageGb, monthlyGenerations,
--                   jobConcurrency, maxOpenJobs). Stripe later only points accounts at a plan.
--   accounts        one row per user: plan, staff (our own people: top limits, may fall back to the
--                   platform's keys), status (active / suspended), their own settings, a per-account
--                   override of the plan's limits (promo codes later), and the billing seam.

-- MARK: Tables

create table if not exists public.platform (
  id boolean primary key default true check (id),
  -- { limits?: { wallClockSec?, uploadLimitMb?, storageQuotaGb? } }
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.platform enable row level security;
create policy "Install members only" on public.platform as restrictive for all to authenticated
  using ((select public.install_allows())) with check ((select public.install_allows()));

create table if not exists public.plans (
  id text primary key check (id ~ '^[a-z0-9_]{1,40}$'),
  name text not null,
  -- { maxApps, storageGb, monthlyGenerations, jobConcurrency, maxOpenJobs }
  limits jsonb not null default '{}'::jsonb,
  stripe_price_id text,
  created_at timestamptz not null default now()
);
alter table public.plans enable row level security;
-- Anyone signed in may read what each plan allows (a pricing panel, the "Plan & usage" panel).
create policy plans_read on public.plans for select to authenticated using (true);
create policy "Install members only" on public.plans as restrictive for all to authenticated
  using ((select public.install_allows())) with check ((select public.install_allows()));

insert into public.plans (id, name, limits) values
  ('free',  'Free',  '{"maxApps": 2, "storageGb": 5, "monthlyGenerations": 200, "jobConcurrency": 2, "maxOpenJobs": 100}'),
  ('pro',   'Pro',   '{"maxApps": 10, "storageGb": 50, "monthlyGenerations": 2000, "jobConcurrency": 4, "maxOpenJobs": 400}'),
  ('staff', 'Staff', '{"maxApps": 1000, "storageGb": 1000, "monthlyGenerations": 100000, "jobConcurrency": 8, "maxOpenJobs": 5000}')
on conflict (id) do nothing;

create table if not exists public.accounts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  plan text not null default 'free' references public.plans (id),
  staff boolean not null default false,
  status text not null default 'active' check (status in ('active', 'suspended')),
  -- { name?, aiProvider?, models?, research? }: install.settings without limits.
  settings jsonb not null default '{}'::jsonb,
  -- Laid over the plan's limits key by key (account_limits).
  limits_override jsonb not null default '{}'::jsonb,
  stripe_customer_id text,
  stripe_subscription_id text,
  plan_renews_at timestamptz,
  promo_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.accounts enable row level security;
create trigger accounts_touch before update on public.accounts for each row execute function public.touch_updated_at();
create trigger platform_touch before update on public.platform for each row execute function public.touch_updated_at();
-- A person may read their own account (plan, status); every write goes through the service role.
create policy accounts_self on public.accounts for select to authenticated using (user_id = (select auth.uid()));
create policy "Install members only" on public.accounts as restrictive for all to authenticated
  using ((select public.install_allows())) with check ((select public.install_allows()));

-- MARK: Which mode

create or replace function public.platform_mode() returns text
language sql stable security definer set search_path = '' as $$
  select case
    when exists (select 1 from public.platform) then 'accounts'
    when exists (select 1 from public.install) then 'install'
    else 'legacy'
  end;
$$;

-- MARK: Accounts

-- The caller's account row, made on first use (free plan, active). Never changes an existing row.
create or replace function public.account_ensure(p_user uuid) returns public.accounts
language plpgsql security definer set search_path = '' as $$
declare row public.accounts;
begin
  if p_user is null then raise exception 'No user'; end if;
  insert into public.accounts (user_id) values (p_user) on conflict (user_id) do nothing;
  select * into row from public.accounts where user_id = p_user;
  return row;
end;
$$;

-- What the account may use: its plan's limits with its own override laid over them. An account with no
-- row yet reads as the free plan. The one source for the triggers, the claim and Tenant.plan.
create or replace function public.account_limits(p_user uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(p.limits, '{}'::jsonb) || coalesce(a.limits_override, '{}'::jsonb)
    from (select 1) one
    left join public.accounts a on a.user_id = p_user
    left join public.plans p on p.id = coalesce(a.plan, 'free');
$$;

-- The seam for billing: a webhook (later) calls only this. Unknown plans are refused.
create or replace function public.account_set_plan(
  p_user uuid, p_plan text, p_customer text default null, p_subscription text default null, p_renews_at timestamptz default null
) returns public.accounts
language plpgsql security definer set search_path = '' as $$
declare row public.accounts;
begin
  if not exists (select 1 from public.plans where id = p_plan) then raise exception 'Unknown plan %', p_plan; end if;
  perform public.account_ensure(p_user);
  update public.accounts
     set plan = p_plan,
         stripe_customer_id = coalesce(p_customer, stripe_customer_id),
         stripe_subscription_id = coalesce(p_subscription, stripe_subscription_id),
         plan_renews_at = coalesce(p_renews_at, plan_renews_at)
   where user_id = p_user
  returning * into row;
  return row;
end;
$$;

-- MARK: Who the database lets in

-- Accounts mode first: every signed-in account, unless it is suspended. The two older branches are
-- kept exactly as 20261119130000_install_members_only.sql wrote them.
create or replace function public.install_allows() returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when exists (select 1 from public.platform) then not exists (
      select 1 from public.accounts a where a.user_id = (select auth.uid()) and a.status = 'suspended')
    when not exists (select 1 from public.install) then true
    else exists (select 1 from public.install i where i.owner_user_id = (select auth.uid()))
      or exists (select 1 from public.install_members m where m.user_id = (select auth.uid()))
  end;
$$;

revoke execute on function public.install_allows() from public, anon;
grant execute on function public.install_allows() to authenticated, service_role;

-- MARK: Owner claim

-- As 20261119180000_reliability_guards.sql, refused on a database that hosts accounts: /setup can never
-- make anyone the owner of the accounts' keys and settings.
create or replace function public.install_claim_owner(p_user uuid, p_settings jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare owner uuid;
begin
  if p_user is null then raise exception 'No user to make the owner'; end if;
  if exists (select 1 from public.platform) then
    raise exception 'This database hosts separate accounts: it has no owner to claim';
  end if;
  -- One claim at a time, for the length of this transaction.
  perform pg_advisory_xact_lock(hashtext('public.install_claim_owner'));
  insert into public.install (id, owner_user_id, settings)
    values (true, p_user, coalesce(p_settings, '{}'::jsonb))
    on conflict (id) do update
      set owner_user_id = coalesce(public.install.owner_user_id, excluded.owner_user_id),
          -- Settings saved earlier win over these defaults.
          settings = excluded.settings || public.install.settings
    returning owner_user_id into owner;
  if owner = p_user then
    insert into public.install_members (user_id, role) values (p_user, 'owner')
      on conflict (user_id) do update set role = 'owner';
  end if;
  return owner;
end;
$$;

-- MARK: Turning accounts mode on and off

-- In one transaction: the platform row (the Supabase plan's limits; by default the numbers the functions
-- were written with, 400 s / 300 MB / 100 GB), and an account for every existing user, the given ids
-- marked staff on the staff plan. A staff account that already has a row keeps its settings. On a
-- database with an install row, its settings (without limits) become the staff accounts' settings, so
-- the owner's choice of AI and models carries over. Keys are not copied: the install-wide keys stay
-- where they are and are what staff fall back to (the platform's keys). Safe to call again.
create or replace function public.platform_enable(p_staff uuid[], p_settings jsonb default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer; carried jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('public.platform_enable'));
  insert into public.platform (id, settings)
    values (true, coalesce(p_settings, '{"limits": {"wallClockSec": 400, "uploadLimitMb": 300, "storageQuotaGb": 100}}'::jsonb))
    on conflict (id) do update set settings = coalesce(p_settings, public.platform.settings);
  select coalesce(i.settings, '{}'::jsonb) - 'limits' into carried from public.install i limit 1;
  insert into public.accounts (user_id, plan, staff, settings)
    select u.id,
           case when u.id = any (coalesce(p_staff, '{}')) then 'staff' else 'free' end,
           u.id = any (coalesce(p_staff, '{}')),
           case when u.id = any (coalesce(p_staff, '{}')) then coalesce(carried, '{}'::jsonb) else '{}'::jsonb end
      from auth.users u
    on conflict (user_id) do update
      set staff = public.accounts.staff or excluded.staff,
          plan = case when excluded.staff then 'staff' else public.accounts.plan end;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Back to install (or legacy) mode. The accounts rows and their keys stay, unused, for a later enable.
-- Before public sign-up only: afterwards suspend non-staff accounts and close sign-up first (legacy mode
-- would hand the platform's keys to every account).
create or replace function public.platform_disable() returns void
language sql security definer set search_path = '' as $$
  delete from public.platform;
$$;

-- MARK: Grants (service role only)

revoke execute on function public.platform_mode() from public, anon, authenticated;
revoke execute on function public.account_ensure(uuid) from public, anon, authenticated;
revoke execute on function public.account_limits(uuid) from public, anon, authenticated;
revoke execute on function public.account_set_plan(uuid, text, text, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.install_claim_owner(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.platform_enable(uuid[], jsonb) from public, anon, authenticated;
revoke execute on function public.platform_disable() from public, anon, authenticated;
grant execute on function public.platform_mode() to service_role;
grant execute on function public.account_ensure(uuid) to service_role;
grant execute on function public.account_limits(uuid) to service_role;
grant execute on function public.account_set_plan(uuid, text, text, text, timestamptz) to service_role;
grant execute on function public.install_claim_owner(uuid, jsonb) to service_role;
grant execute on function public.platform_enable(uuid[], jsonb) to service_role;
grant execute on function public.platform_disable() to service_role;
