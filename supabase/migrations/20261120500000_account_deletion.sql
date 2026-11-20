-- Settings > Account > Delete my account (supabase/functions/install/account.ts): the records that make a
-- deletion resumable, keep files written late from surviving it, and keep a deleted app's id from being
-- taken again. Additive and safe in every mode: two new tables (empty until someone deletes their account),
-- a lease and a status function, one more refusal in the products identity guard, and a cron job that
-- calls out only when a deletion needs it.
--
--   account_deletions   one row per account being deleted, or deleted less than a day ago. No foreign key:
--                       it outlives auth.users, so the late sweeps (3 h and 24 h after, longer than a signed
--                       upload URL lives) know whose folders to look at again. The row is removed after the
--                       last sweep. finished_at null = still being deleted (the account is locked).
--   deleted_apps        every app of a deleted account, for good: its id can never be used again, so no
--                       other account can inherit a file written late under that folder. owner_user_id is
--                       cleared after the last sweep (no link to a deleted person is kept).
-- Both are for the service role only: row-level security is on with no permissive policy (closed to the
-- browser), plus the restrictive "Install members only" policy every table carries.

-- MARK: Tables

create table if not exists public.account_deletions (
  user_id uuid primary key,
  mode text not null check (mode in ('accounts', 'install')),
  started_at timestamptz not null default now(),
  -- The last time a call worked on it (the sweeper resumes one left alone for a few minutes).
  touched_at timestamptz not null default now(),
  -- One call at a time: a call holds the lease while it works (account_deletion_lease).
  lease_until timestamptz,
  finished_at timestamptz,
  -- Late sweeps done after finishing (0, 1 at 3 h, 2 at 24 h; the row goes after the second).
  sweeps integer not null default 0
);
alter table public.account_deletions enable row level security;
create policy "Install members only" on public.account_deletions as restrictive for all to authenticated
  using ((select public.install_allows())) with check ((select public.install_allows()));

create table if not exists public.deleted_apps (
  app_id uuid primary key,
  owner_user_id uuid,
  deleted_at timestamptz not null default now()
);
alter table public.deleted_apps enable row level security;
create policy "Install members only" on public.deleted_apps as restrictive for all to authenticated
  using ((select public.install_allows())) with check ((select public.install_allows()));

create index if not exists account_deletions_open_idx on public.account_deletions (touched_at) where finished_at is null;
create index if not exists account_deletions_done_idx on public.account_deletions (finished_at) where finished_at is not null;
create index if not exists deleted_apps_owner_idx on public.deleted_apps (owner_user_id) where owner_user_id is not null;

-- MARK: One call at a time

-- Takes the lease for p_seconds when nobody holds it (true), else false. The row must exist.
create or replace function public.account_deletion_lease(p_user uuid, p_seconds integer) returns boolean
language plpgsql security definer set search_path = '' as $$
declare got uuid;
begin
  update public.account_deletions
     set lease_until = now() + make_interval(secs => greatest(1, least(p_seconds, 900))), touched_at = now()
   where user_id = p_user and finished_at is null and (lease_until is null or lease_until < now())
  returning user_id into got;
  return got is not null;
end;
$$;

-- MARK: Is the caller's account being deleted? (the app sends them to /delete-account to finish)

-- Answers for the caller only. Their own rows are closed to them while the account is locked, so the app
-- can't read this any other way.
create or replace function public.account_deletion_pending() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.account_deletions d where d.user_id = (select auth.uid()) and d.finished_at is null);
$$;

-- MARK: A deleted app's id is never used again; ids are the database's to choose

-- Every mode: an app id that belonged to a deleted account stays retired (its folders may still get a late
-- file until the last sweep, and it must never count against anyone else).
create or replace function public.deleted_apps_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.deleted_apps d where d.app_id = new.id) then
    raise exception 'That app id is taken.' using errcode = 'P0001', detail = 'app_identity';
  end if;
  return new;
end;
$$;
drop trigger if exists deleted_apps_guard on public.products;
create trigger deleted_apps_guard before insert or update of id on public.products
  for each row execute function public.deleted_apps_guard();

create or replace function public.account_products_identity() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if public.platform_mode() <> 'accounts' then return new; end if;
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id or new.user_id is distinct from old.user_id then
      raise exception 'An app''s id and owner can''t be changed.' using errcode = 'P0001', detail = 'app_identity';
    end if;
    return new;
  end if;
  -- Accounts mode: an app made from the browser gets an id the database chooses (nothing in the app picks
  -- one), so nobody can aim at an id that is, or was, someone else's folder.
  if (select auth.role()) = 'authenticated' then new.id := gen_random_uuid(); end if;
  if exists (select 1 from public.app_owners o where o.app_id = new.id and o.user_id <> new.user_id) then
    raise exception 'That app id is taken.' using errcode = 'P0001', detail = 'app_identity';
  end if;
  return new;
end;
$$;

-- MARK: The sweeper

-- Wakes install/account/delete/sweep with the worker secret the radar watchdog uses, at the install
-- function's address (next to the metrics function's, which setup keeps in Vault). Calls out only when a
-- deletion was left alone for five minutes or a late sweep is due.
create or replace function public.account_deletions_sweep() returns void
language plpgsql security definer set search_path = '' as $$
declare url text; secret text;
begin
  if not exists (
    select 1 from public.account_deletions d
     where (d.finished_at is null and d.touched_at < now() - interval '5 minutes' and (d.lease_until is null or d.lease_until < now()))
        or (d.finished_at < now() - interval '3 hours' and d.sweeps = 0)
        or (d.finished_at < now() - interval '24 hours' and d.sweeps >= 1)
  ) then return; end if;
  select decrypted_secret into url from vault.decrypted_secrets where name = 'METRICS_URL';
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'RADAR_WORKER_SECRET';
  if url is null or secret is null or url !~ '/metrics$' then return; end if;
  perform net.http_post(
    url := regexp_replace(url, '/metrics$', '/install') || '/account/delete/sweep',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-radar-worker', secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
end;
$$;

-- MARK: Grants (service role only, except the caller's own status)

revoke all on table public.account_deletions from anon, authenticated;
revoke all on table public.deleted_apps from anon, authenticated;
revoke execute on function public.account_deletion_lease(uuid, integer) from public, anon, authenticated;
revoke execute on function public.account_deletions_sweep() from public, anon, authenticated;
revoke execute on function public.deleted_apps_guard() from public, anon, authenticated;
revoke execute on function public.account_products_identity() from public, anon, authenticated;
revoke execute on function public.account_deletion_pending() from public, anon;
grant execute on function public.account_deletion_lease(uuid, integer) to service_role;
grant execute on function public.account_deletions_sweep() to service_role;
grant execute on function public.account_deletion_pending() to authenticated, service_role;

-- MARK: Schedule (every ten minutes; cheap when there is nothing to do)

select cron.schedule('account-deletions-sweep', '*/10 * * * *', 'select public.account_deletions_sweep()');
