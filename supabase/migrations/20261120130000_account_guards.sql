-- What a plan allows, enforced by the database (accounts mode only; every guard returns at once in an
-- install or a legacy database).
--
--   products       an account can't add more apps than its plan's maxApps (the studio's /api/products
--                  turns the error into a sentence); a suspended account can't add any.
--   creative_jobs  an account can't queue generations past its plan's monthlyGenerations this month or
--                  past maxOpenJobs waiting at once; a suspended account can't queue any; only staff may
--                  queue jobs for the desktop runner (backend 'local'). These cover rows the browser
--                  inserts straight into the table too.
--   account_rate   a small counter per account and action, for the edge functions' rate limits
--                  (account_rate_hit). Closed to the browser.
--
-- Errors carry a stable DETAIL (app_limit, generation_limit, open_jobs_limit, runner_staff_only,
-- account_suspended) so callers can tell them apart without parsing the message.

-- MARK: Apps

create or replace function public.account_products_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare lim jsonb; n integer; max_apps integer; acct_status text;
begin
  if public.platform_mode() <> 'accounts' then return new; end if;
  select status into acct_status from public.accounts where user_id = new.user_id;
  if acct_status = 'suspended' then
    raise exception 'This account is suspended.' using errcode = 'P0001', detail = 'account_suspended';
  end if;
  -- One insert at a time per account, so two at once can't both slip under the cap.
  perform pg_advisory_xact_lock(hashtext('account_products_guard:' || new.user_id::text));
  lim := public.account_limits(new.user_id);
  max_apps := coalesce((lim->>'maxApps')::integer, 2147483647);
  select count(*) into n from public.products where user_id = new.user_id;
  if n >= max_apps then
    raise exception 'Your plan allows % apps. Delete an app you no longer need to add another.', max_apps
      using errcode = 'P0001', detail = 'app_limit';
  end if;
  return new;
end;
$$;

drop trigger if exists account_products_guard on public.products;
create trigger account_products_guard before insert on public.products for each row execute function public.account_products_guard();

-- MARK: Generations

create index if not exists creative_jobs_user_created_idx on public.creative_jobs (user_id, created_at);

create or replace function public.account_jobs_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare lim jsonb; acct public.accounts; n integer; cap integer;
begin
  if public.platform_mode() <> 'accounts' then return new; end if;
  select * into acct from public.accounts where user_id = new.user_id;
  if acct.status = 'suspended' then
    raise exception 'This account is suspended.' using errcode = 'P0001', detail = 'account_suspended';
  end if;
  if new.backend = 'local' and not coalesce(acct.staff, false) then
    raise exception 'The desktop runner isn''t available on this account.' using errcode = 'P0001', detail = 'runner_staff_only';
  end if;
  -- The studio's own template renderer spends nothing: it isn't counted.
  if new.backend = 'template' then return new; end if;
  lim := public.account_limits(new.user_id);
  cap := coalesce((lim->>'maxOpenJobs')::integer, 2147483647);
  select count(*) into n from public.creative_jobs
   where user_id = new.user_id and status in ('queued', 'running', 'finalizing') and backend <> 'template';
  if n >= cap then
    raise exception 'You have % generations waiting already. Let them finish (or cancel some), then try again.', n
      using errcode = 'P0001', detail = 'open_jobs_limit';
  end if;
  cap := coalesce((lim->>'monthlyGenerations')::integer, 2147483647);
  select count(*) into n from public.creative_jobs
   where user_id = new.user_id and created_at >= date_trunc('month', now()) and backend <> 'template';
  if n >= cap then
    raise exception 'Your plan allows % generations a month, and this month''s are used up.', cap
      using errcode = 'P0001', detail = 'generation_limit';
  end if;
  return new;
end;
$$;

drop trigger if exists account_jobs_guard on public.creative_jobs;
create trigger account_jobs_guard before insert on public.creative_jobs for each row execute function public.account_jobs_guard();

-- MARK: Rate limits

create table public.account_rate (
  user_id uuid not null references auth.users (id) on delete cascade,
  bucket text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (user_id, bucket, window_start)
);
alter table public.account_rate enable row level security;
create policy "Install members only" on public.account_rate as restrictive for all to authenticated
  using ((select public.install_allows())) with check ((select public.install_allows()));

-- Counts one hit of `p_bucket` for the account in the current window of `p_window_sec` seconds and says
-- whether it is within `p_max`. Always true outside accounts mode.
create or replace function public.account_rate_hit(p_user uuid, p_bucket text, p_window_sec integer, p_max integer) returns boolean
language plpgsql security definer set search_path = '' as $$
declare started timestamptz; n integer;
begin
  if public.platform_mode() <> 'accounts' or p_user is null then return true; end if;
  started := to_timestamp(floor(extract(epoch from now()) / greatest(1, p_window_sec)) * greatest(1, p_window_sec));
  insert into public.account_rate as r (user_id, bucket, window_start, hits) values (p_user, left(p_bucket, 60), started, 1)
    on conflict (user_id, bucket, window_start) do update set hits = r.hits + 1
    returning hits into n;
  -- Now and then, forget windows older than two days.
  if random() < 0.01 then delete from public.account_rate where window_start < now() - interval '2 days'; end if;
  return n <= p_max;
end;
$$;

revoke execute on function public.account_products_guard() from public, anon, authenticated;
revoke execute on function public.account_jobs_guard() from public, anon, authenticated;
revoke execute on function public.account_rate_hit(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.account_rate_hit(uuid, text, integer, integer) to service_role;
