-- Storage that never surprises: measuring what is stored, per bucket and per app, and listing an app's
-- files for cleanup (Settings > Storage, the warnings before anything adds files).
--
-- Every bucket keeps one folder per app (docs/SELF-HOSTING-DESIGN.md "Storage layout"):
--   creatives   <app>/<YYYY-MM-DD>/<job>/<file>
--   ad-media    <app>/<page>/<hash>.<ext>, <app>/scan-frames/<ad>/<n>.<ext>
--   workspace   <user>/<app>/assets|brand|fonts|playground/...
--   thumbs, app-assets   not an app's files
-- The app's folder is the first in `creatives` and `ad-media` and the second in `workspace`; studio's
-- lib/storage-usage.ts classifyPath is the twin of the rule below.
--
-- Both functions are for the service role only (the install function answers members with them). No new
-- table, so no new row-level security policy is needed.

-- Bytes and files by bucket and app folder (app_id null: files that are no app's). One install is one
-- Supabase project, so this is the whole install's storage, which is what the plan's quota counts.
create or replace function public.storage_usage()
returns table (bucket text, app_id text, files bigint, bytes bigint)
language sql stable security definer set search_path = '' as $$
  with objects as (
    select o.bucket_id::text as bucket,
           case
             when o.bucket_id in ('creatives', 'ad-media') then (storage.foldername(o.name))[1]
             when o.bucket_id = 'workspace' then (storage.foldername(o.name))[2]
           end as folder,
           coalesce((o.metadata->>'size')::bigint, 0) as size
      from storage.objects o
  )
  select bucket,
         case when folder ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then lower(folder) end as app_id,
         count(*)::bigint as files,
         coalesce(sum(size), 0)::bigint as bytes
    from objects
   group by 1, 2;
$$;

-- The files under one folder of a bucket (every level below it), with their size and when they were
-- saved, optionally only those saved before a time. The prefix must name an app's folder (it has to
-- hold a uuid), so this never lists a whole bucket. At most 20,000 rows per call.
create or replace function public.storage_objects_under(p_bucket text, p_prefix text, p_before timestamptz default null)
returns table (name text, bytes bigint, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select o.name, coalesce((o.metadata->>'size')::bigint, 0), o.created_at
    from storage.objects o
   where o.bucket_id = p_bucket
     and p_prefix ~* '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/$'
     and left(o.name, length(p_prefix)) = p_prefix
     and (p_before is null or o.created_at < p_before)
   order by o.created_at
   limit 20000;
$$;

revoke execute on function public.storage_usage() from public, anon, authenticated;
revoke execute on function public.storage_objects_under(text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.storage_usage() to service_role;
grant execute on function public.storage_objects_under(text, text, timestamptz) to service_role;
