-- Each account's own storage (accounts mode): what it has stored, against its plan's storage, and a cap on
-- uploads straight from the browser.
--
-- An account's files are found by the folders every bucket already keeps (20261119160000_storage_usage.sql):
--   workspace, thumbs     <user>/...                    (the first folder is the account)
--   creatives, ad-media   <app>/...                     (the first folder is one of the account's apps)
-- storage.objects.name is collated "C", so each `like '<prefix>%'` is a range scan on (bucket_id, name).
--
-- The Supabase plan's own quota is still shared by every account; the edge functions check both
-- (_shared/storage.ts storageRoom with an account). Uploads from the browser are capped here by a
-- restrictive insert policy: an account at or over its plan's storage can't add files. A file that
-- starts below the cap may overshoot it by one file (at most the bucket's file size limit).

-- MARK: Measuring

create or replace function public.account_storage_used(p_user uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(size), 0)::bigint from (
    select coalesce((o.metadata->>'size')::bigint, 0) as size
      from storage.objects o
     where o.bucket_id in ('workspace', 'thumbs') and o.name like p_user::text || '/%'
    union all
    select coalesce((o.metadata->>'size')::bigint, 0)
      from public.products p
      join storage.objects o on o.bucket_id in ('creatives', 'ad-media') and o.name like p.id::text || '/%'
     where p.user_id = p_user
  ) mine;
$$;

-- storage_usage() for one account: the same rows (bucket, app folder, files, bytes), only its own files.
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
    select o.bucket_id::text, p.id::text, coalesce((o.metadata->>'size')::bigint, 0)
      from public.products p
      join storage.objects o on o.bucket_id in ('creatives', 'ad-media') and o.name like p.id::text || '/%'
     where p.user_id = p_user
  )
  select bucket,
         case when folder ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then lower(folder) end as app_id,
         count(*)::bigint as files,
         coalesce(sum(size), 0)::bigint as bytes
    from objects
   group by 1, 2;
$$;

-- MARK: Browser uploads

-- True outside accounts mode, and for an account below its plan's storage. Answers for the caller only.
create or replace function public.account_storage_allows() returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when not exists (select 1 from public.platform) then true
    when (select auth.uid()) is null then true
    else public.account_storage_used((select auth.uid()))
         < coalesce((public.account_limits((select auth.uid()))->>'storageGb')::numeric, 0) * 1e9
  end;
$$;

create policy "Account storage quota" on storage.objects as restrictive for insert to authenticated
  with check ((select public.account_storage_allows()));

-- MARK: Grants

revoke execute on function public.account_storage_used(uuid) from public, anon, authenticated;
revoke execute on function public.storage_usage_for(uuid) from public, anon, authenticated;
revoke execute on function public.account_storage_allows() from public, anon;
grant execute on function public.account_storage_used(uuid) to service_role;
grant execute on function public.storage_usage_for(uuid) to service_role;
-- The policy runs as `authenticated`, which must be able to call it.
grant execute on function public.account_storage_allows() to authenticated, service_role;
