-- Accounts mode: closing the holes a review found in the quotas and caps of 20261120100000–140000.
-- Like those, everything here is a no-op until a platform row exists (each guard returns at once in an
-- install or a legacy database), except two things that change nothing visible there: a durable record of
-- which account an app belongs to (app_owners, also kept on install databases so it is complete when
-- accounts mode is turned on), and the creative_jobs.key_source column.
--
--   1. Storage is counted by owner, not through the current products. app_owners remembers each app's
--      account for good (an app that is deleted, or a product row whose id someone changes, still counts
--      against the account that made it, until its files are deleted). A product's id can't be changed,
--      and an id that belonged to another account's app can't be taken.
--   2. Generations are counted in account_usage (a counter per account and month that nothing cascades
--      away), bumped whenever a job is queued: on insert, and when a failed, cancelled or finished job is
--      queued again. The guard also runs on that update, takes one lock per account (no overshoot from
--      requests at the same time), refuses moving a job to the desktop runner for non-staff, and keeps
--      users from changing which key a job was sent with.
--   3. platform_disable() refuses to drop a database into legacy mode (no install row) or to leave active
--      non-staff accounts behind, unless p_force => true.
--   6. account_limits() always answers all five numbers: the plan's (with the platform's per-plan
--      overrides, platform.settings.plans.<plan>), else the free plan's, else built-in defaults, for any
--      key that is missing, null, negative or not a number. A numeric string counts as its number.
--   7. Browser uploads need room for one more file of that bucket's largest size, so one upload can no
--      longer overshoot the quota (several at the same moment still can: see the note at the policy).
--   8. In accounts mode, RLS lets in only confirmed, non-anonymous sessions (as the functions do).
--   9. creatives_set_file honours install_allows() (a suspended account can't change creatives).
--  11. platform.settings.plans.free.storageGb (or any plan's key) overrides that plan's number.

-- MARK: Limits that are always complete (6, 11)

create or replace function public.limit_number(p_value jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select case
    when jsonb_typeof(p_value) = 'number' and (p_value #>> '{}')::numeric >= 0 then p_value
    when jsonb_typeof(p_value) = 'string' and (p_value #>> '{}') ~ '^\s*[0-9]+(\.[0-9]+)?\s*$' then to_jsonb(btrim(p_value #>> '{}')::numeric)
  end;
$$;

create or replace function public.account_limits(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  builtin constant jsonb := '{"maxApps": 2, "storageGb": 5, "monthlyGenerations": 200, "jobConcurrency": 2, "maxOpenJobs": 100}';
  plan_id text; override jsonb; overrides jsonb; free jsonb; mine jsonb; merged jsonb; answer jsonb := '{}'; k text; v jsonb;
begin
  select coalesce(a.plan, 'free'), coalesce(a.limits_override, '{}'::jsonb) into plan_id, override
    from (select 1) one left join public.accounts a on a.user_id = p_user;
  select coalesce(settings->'plans', '{}'::jsonb) into overrides from public.platform limit 1;
  overrides := coalesce(overrides, '{}'::jsonb);
  free := coalesce((select limits from public.plans where id = 'free'), '{}'::jsonb)
          || case when jsonb_typeof(overrides->'free') = 'object' then overrides->'free' else '{}'::jsonb end;
  mine := coalesce((select limits from public.plans where id = plan_id), '{}'::jsonb)
          || case when jsonb_typeof(overrides->plan_id) = 'object' then overrides->plan_id else '{}'::jsonb end;
  merged := mine || case when jsonb_typeof(override) = 'object' then override else '{}'::jsonb end;
  for k in select jsonb_object_keys(builtin) loop
    v := coalesce(public.limit_number(merged->k), public.limit_number(free->k), builtin->k);
    answer := answer || jsonb_build_object(k, v);
  end loop;
  return answer;
end;
$$;

-- MARK: Who owns an app, for good (1)

create table public.app_owners (
  app_id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.app_owners enable row level security;
-- No permissive policy: closed to the browser.
create policy "Install members only" on public.app_owners as restrictive for all to authenticated
  using ((select public.install_allows())) with check ((select public.install_allows()));

insert into public.app_owners (app_id, user_id) select id, user_id from public.products on conflict (app_id) do nothing;

create or replace function public.app_owners_record() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.app_owners (app_id, user_id) values (new.id, new.user_id) on conflict (app_id) do nothing;
  return new;
end;
$$;
drop trigger if exists app_owners_record on public.products;
create trigger app_owners_record after insert on public.products for each row execute function public.app_owners_record();

-- An app's id is its folder in storage: it never changes, and an id another account's app once had is never reused.
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
  if exists (select 1 from public.app_owners o where o.app_id = new.id and o.user_id <> new.user_id) then
    raise exception 'That app id is taken.' using errcode = 'P0001', detail = 'app_identity';
  end if;
  return new;
end;
$$;
drop trigger if exists account_products_identity on public.products;
create trigger account_products_identity before insert or update of id, user_id on public.products
  for each row execute function public.account_products_identity();

-- Storage by owner: an account's own folders in workspace and thumbs, and the creatives and saved ad media
-- of every app it ever made (deleted ones too, until their files are gone).
create or replace function public.account_storage_used(p_user uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(size), 0)::bigint from (
    select coalesce((o.metadata->>'size')::bigint, 0) as size
      from storage.objects o
     where o.bucket_id in ('workspace', 'thumbs') and o.name like p_user::text || '/%'
    union all
    select coalesce((o.metadata->>'size')::bigint, 0)
      from public.app_owners a
      join storage.objects o on o.bucket_id in ('creatives', 'ad-media') and o.name like a.app_id::text || '/%'
     where a.user_id = p_user
  ) mine;
$$;

create or replace function public.storage_usage_for(p_user uuid)
returns table (bucket text, app_id text, files bigint, bytes bigint)
language sql stable security definer set search_path = '' as $$
  with objects as (
    select o.bucket_id::text as bucket, (storage.foldername(o.name))[2] as folder, coalesce((o.metadata->>'size')::bigint, 0) as size
      from storage.objects o
     where o.bucket_id = 'workspace' and o.name like p_user::text || '/%'
    union all
    select o.bucket_id::text, null, coalesce((o.metadata->>'size')::bigint, 0)
      from storage.objects o
     where o.bucket_id = 'thumbs' and o.name like p_user::text || '/%'
    union all
    select o.bucket_id::text, a.app_id::text, coalesce((o.metadata->>'size')::bigint, 0)
      from public.app_owners a
      join storage.objects o on o.bucket_id in ('creatives', 'ad-media') and o.name like a.app_id::text || '/%'
     where a.user_id = p_user
  )
  select bucket,
         case when folder ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then lower(folder) end as app_id,
         count(*)::bigint as files,
         coalesce(sum(size), 0)::bigint as bytes
    from objects
   group by 1, 2;
$$;

-- MARK: Browser uploads leave room for one more file (7)

-- True outside accounts mode; otherwise the account's files plus one file of this bucket's largest size
-- must fit its plan's storage. Requests at the same moment can still each pass and overshoot by up to one
-- file each (the policy can't see uploads still in flight): at most N x the bucket's limit for N uploads
-- started together, and the functions' own checks catch the account on its next save.
create or replace function public.account_storage_allows(p_bucket text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when not exists (select 1 from public.platform) then true
    when (select auth.uid()) is null then true
    else public.account_storage_used((select auth.uid()))
         + coalesce((select b.file_size_limit from storage.buckets b where b.id = p_bucket), 52428800)
         <= (public.account_limits((select auth.uid()))->>'storageGb')::numeric * 1e9
  end;
$$;

drop policy if exists "Account storage quota" on storage.objects;
create policy "Account storage quota" on storage.objects as restrictive for insert to authenticated
  with check (public.account_storage_allows(bucket_id));

-- MARK: Generations, counted for good (2, 5)

alter table public.creative_jobs add column if not exists key_source text check (key_source in ('account', 'platform'));

create table public.account_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  month date not null,
  generations integer not null default 0,
  primary key (user_id, month)
);
alter table public.account_usage enable row level security;
create policy "Install members only" on public.account_usage as restrictive for all to authenticated
  using ((select public.install_allows())) with check ((select public.install_allows()));

-- This month's jobs so far, so the counter starts from what is already there.
insert into public.account_usage (user_id, month, generations)
  select user_id, date_trunc('month', now())::date, count(*)::integer
    from public.creative_jobs
   where created_at >= date_trunc('month', now()) and backend <> 'template'
   group by user_id
on conflict (user_id, month) do update set generations = greatest(public.account_usage.generations, excluded.generations);

create or replace function public.account_jobs_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare lim jsonb; acct public.accounts; n integer; cap integer; this_month date := date_trunc('month', now())::date;
begin
  if public.platform_mode() <> 'accounts' then return new; end if;
  select * into acct from public.accounts where user_id = new.user_id;
  if tg_op = 'UPDATE' then
    -- Which key a job was sent with is the workers' to write, never the browser's.
    if (select auth.role()) = 'authenticated' and new.key_source is distinct from old.key_source then
      new.key_source := old.key_source;
    end if;
    if new.backend = 'local' and old.backend is distinct from 'local' and not coalesce(acct.staff, false) then
      raise exception 'The desktop runner isn''t available on this account.' using errcode = 'P0001', detail = 'runner_staff_only';
    end if;
    -- Only a job queued again (a retry) counts; the workers' own requeues (from running) don't.
    if not (new.status = 'queued' and old.status in ('failed', 'cancelled', 'done')) then return new; end if;
  end if;
  if acct.status = 'suspended' then
    raise exception 'This account is suspended.' using errcode = 'P0001', detail = 'account_suspended';
  end if;
  if tg_op = 'INSERT' and new.backend = 'local' and not coalesce(acct.staff, false) then
    raise exception 'The desktop runner isn''t available on this account.' using errcode = 'P0001', detail = 'runner_staff_only';
  end if;
  -- The studio's own template renderer spends nothing: it isn't counted.
  if new.backend = 'template' then return new; end if;
  -- One at a time per account, so requests at the same moment can't all slip under the caps.
  perform pg_advisory_xact_lock(hashtext('account_jobs_guard:' || new.user_id::text));
  lim := public.account_limits(new.user_id);
  cap := (lim->>'maxOpenJobs')::integer;
  select count(*) into n from public.creative_jobs
   where user_id = new.user_id and status in ('queued', 'running', 'finalizing') and backend <> 'template' and id <> new.id;
  if n >= cap then
    raise exception 'You have % generations waiting already. Let them finish (or cancel some), then try again.', n
      using errcode = 'P0001', detail = 'open_jobs_limit';
  end if;
  cap := (lim->>'monthlyGenerations')::integer;
  select coalesce((select generations from public.account_usage where user_id = new.user_id and month = this_month), 0) into n;
  if n >= cap then
    raise exception 'Your plan allows % generations a month, and this month''s are used up.', cap
      using errcode = 'P0001', detail = 'generation_limit';
  end if;
  insert into public.account_usage as u (user_id, month, generations) values (new.user_id, this_month, 1)
    on conflict (user_id, month) do update set generations = u.generations + 1;
  return new;
end;
$$;

drop trigger if exists account_jobs_guard on public.creative_jobs;
create trigger account_jobs_guard before insert or update of status, backend, key_source on public.creative_jobs
  for each row execute function public.account_jobs_guard();

-- MARK: Turning accounts mode off safely (3)

drop function if exists public.platform_disable();
-- Back to install mode. Refused (unless p_force => true) on a database with no install row, which would
-- drop to legacy mode where every account uses the platform's keys, and while any non-staff account is
-- active. Turn off sign-ups in Supabase Auth (Authentication > Sign In / Providers) and suspend non-staff
-- accounts first.
create function public.platform_disable(p_force boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if not coalesce(p_force, false) then
    if not exists (select 1 from public.install) then
      raise exception 'This database has no install row: without accounts mode it would be in legacy mode, where every account uses the platform''s keys. Turn off sign-ups in Supabase Auth and suspend every non-staff account, then call platform_disable(p_force => true).';
    end if;
    select count(*) into n from public.accounts where not staff and status = 'active';
    if n > 0 then
      raise exception '% non-staff accounts are still active. Turn off sign-ups in Supabase Auth and suspend them first (update public.accounts set status = ''suspended'' where not staff), or call platform_disable(p_force => true).', n;
    end if;
  end if;
  delete from public.platform;
end;
$$;

-- MARK: Who the database lets in (8)

-- As 20261120100000_platform_accounts.sql, the accounts branch now also refuses anonymous sessions and
-- accounts whose email (or phone) isn't confirmed, as the edge functions do. The two older branches are
-- kept exactly as 20261119130000_install_members_only.sql wrote them.
create or replace function public.install_allows() returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when exists (select 1 from public.platform) then
      coalesce(((select auth.jwt())->>'is_anonymous')::boolean, false) = false
      and exists (select 1 from auth.users u where u.id = (select auth.uid()) and (u.email_confirmed_at is not null or u.phone_confirmed_at is not null))
      and not exists (select 1 from public.accounts a where a.user_id = (select auth.uid()) and a.status = 'suspended')
    when not exists (select 1 from public.install) then true
    else exists (select 1 from public.install i where i.owner_user_id = (select auth.uid()))
      or exists (select 1 from public.install_members m where m.user_id = (select auth.uid()))
  end;
$$;

revoke execute on function public.install_allows() from public, anon;
grant execute on function public.install_allows() to authenticated, service_role;

-- MARK: creatives_set_file honours the install (9)

-- As 20261009120000_creatives_set_file_fix.sql, refused for anyone install_allows() refuses (a
-- suspended account, a non-member of an install).
create or replace function public.creatives_set_file(p_id uuid, p_patch jsonb) returns public.creatives
language plpgsql security definer set search_path = '' as $$
declare
  c public.creatives;
  path text;
  link text;
  file_mime text;
begin
  if not public.install_allows() then
    raise exception 'This account can''t change creatives.' using errcode = '42501';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or octet_length(p_patch::text) > 65536 then
    raise exception 'Send the changes as one JSON object (at most 64 KB).' using errcode = '22023';
  end if;
  select * into c from public.creatives where id = p_id and user_id = (select auth.uid()) for update;
  if not found then
    raise exception 'This creative doesn''t exist.' using errcode = 'P0002';
  end if;
  if c.kind <> 'image' then
    raise exception 'Only image creatives get a composed text or a placed logo.' using errcode = '22023';
  end if;

  path := coalesce(p_patch->>'storage_path', c.storage_path);
  if path not like c.product_id::text || '/%' or path like '%..%' then
    raise exception 'The file must be in this product''s folder of the creatives bucket.' using errcode = '22023';
  end if;
  link := coalesce(p_patch->>'url', c.url);
  if right(link, length('/storage/v1/object/public/creatives/' || path)) <> '/storage/v1/object/public/creatives/' || path then
    raise exception 'The url must be the public address of the file.' using errcode = '22023';
  end if;
  file_mime := coalesce(p_patch->>'mime', c.mime);
  if file_mime not in ('image/png', 'image/jpeg', 'image/webp') then
    raise exception 'The file must be a PNG, JPEG or WebP image.' using errcode = '22023';
  end if;
  if p_patch ? 'copy' and jsonb_typeof(p_patch->'copy') <> 'object' then
    raise exception 'copy must be a JSON object.' using errcode = '22023';
  end if;

  update public.creatives set
    storage_path = path,
    url = link,
    mime = file_mime,
    size_bytes = case when p_patch ? 'size_bytes' then (p_patch->>'size_bytes')::bigint else size_bytes end,
    width = case when p_patch ? 'width' then (p_patch->>'width')::integer else width end,
    height = case when p_patch ? 'height' then (p_patch->>'height')::integer else height end,
    copy = case when p_patch ? 'copy' then p_patch->'copy' else copy end,
    headline = case when p_patch ? 'headline' then left(p_patch->>'headline', 255) else headline end,
    primary_text = case when p_patch ? 'primary_text' then left(p_patch->>'primary_text', 2200) else primary_text end,
    cta = case when p_patch ? 'cta' then left(p_patch->>'cta', 40) else cta end,
    drive_file_id = case when path is distinct from c.storage_path then null else drive_file_id end
  where id = p_id
  returning * into c;
  return c;
end;
$$;

-- MARK: Grants

revoke execute on function public.account_limits(uuid) from public, anon, authenticated;
revoke execute on function public.app_owners_record() from public, anon, authenticated;
revoke execute on function public.account_products_identity() from public, anon, authenticated;
revoke execute on function public.account_storage_used(uuid) from public, anon, authenticated;
revoke execute on function public.storage_usage_for(uuid) from public, anon, authenticated;
revoke execute on function public.account_jobs_guard() from public, anon, authenticated;
revoke execute on function public.platform_disable(boolean) from public, anon, authenticated;
revoke execute on function public.account_storage_allows(text) from public, anon;
grant execute on function public.account_limits(uuid) to service_role;
grant execute on function public.account_storage_used(uuid) to service_role;
grant execute on function public.storage_usage_for(uuid) to service_role;
grant execute on function public.platform_disable(boolean) to service_role;
-- The policy runs as `authenticated`, which must be able to call it.
grant execute on function public.account_storage_allows(text) to authenticated, service_role;
-- creatives_set_file keeps its grants (the studio calls it as the signed-in person).
revoke execute on function public.creatives_set_file(uuid, jsonb) from public, anon;
grant execute on function public.creatives_set_file(uuid, jsonb) to authenticated, service_role;
