-- Research → Ads: competitors' creative files kept for good. The Ad Library hands out signed fbcdn.net
-- links that expire after some days; an import of the local scraper queues every file of its ads
-- (videos, images, carousel/DCO card media, video poster frames) and the `research` edge function's
-- `media-tick` worker copies them into the public `ad-media` bucket. The studio shows the stored copy
-- wherever the ad's media appears, until the user deletes it ("Delete stored media", `media-clear`).
-- A file is identified by its link without the query string (`url_key`; the signature and expiry live
-- in the query), once per workspace.

-- MARK: Storage

-- Public so <img> and <video> load the files directly. Paths are
-- <product id>/<page id or "page">/<first 24 hex of sha256(url_key)>.<ext>: never guessable names.
-- Only the edge function (service role) writes or deletes; no user policies.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ad-media', 'ad-media', true, 314572800, array['image/*', 'video/*'])
on conflict (id) do nothing;

-- MARK: Files

create table public.paid_ad_media (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  page_id text,
  -- The source link without its query string: the dedupe key within a workspace.
  url_key text not null check (char_length(url_key) between 8 and 2000),
  -- The newest signed link seen for it (a re-import refreshes it).
  source_url text not null,
  kind text not null check (kind in ('video', 'image', 'poster')),
  status text not null default 'queued' check (status in ('queued', 'downloading', 'done', 'failed')),
  storage_path text,
  public_url text,
  bytes bigint check (bytes is null or bytes >= 0),
  mime text,
  attempts integer not null default 0,
  error text,
  -- While downloading: the worker's lease. While queued: not before (a retry's backoff).
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, url_key)
);
create index paid_ad_media_work_idx on public.paid_ad_media (status, lease_until) where status in ('queued', 'downloading');
create index paid_ad_media_product_idx on public.paid_ad_media (product_id, page_id);
create index paid_ad_media_user_idx on public.paid_ad_media (user_id);
create trigger paid_ad_media_touch before update on public.paid_ad_media for each row execute function public.touch_updated_at();

alter table public.paid_ad_media enable row level security;
-- Written by the edge function (service role); users read their own.
create policy "Users read their ad media" on public.paid_ad_media for select to authenticated using ((select auth.uid()) = user_id);

-- MARK: Worker

-- Claims up to p_limit files to download: queued ones past their backoff, and downloads whose worker
-- stopped (lease expired). Each claim counts as an attempt; a file whose worker stopped on each of
-- 3 attempts fails instead of being claimed again.
create function public.research_media_claim(p_limit integer, p_seconds integer) returns setof public.paid_ad_media
language sql security definer set search_path = '' as $$
  update public.paid_ad_media
     set status = 'failed', error = 'The download kept stopping before it finished.', lease_until = null
   where status = 'downloading' and lease_until < now() and attempts >= 3;
  update public.paid_ad_media m
     set status = 'downloading', lease_until = now() + make_interval(secs => p_seconds), attempts = m.attempts + 1
   where m.id in (
     select id from public.paid_ad_media
      where (status = 'queued' and (lease_until is null or lease_until < now()))
         or (status = 'downloading' and lease_until < now())
      order by created_at
      limit greatest(1, least(p_limit, 50))
      for update skip locked)
  returning m.*;
$$;

-- Queues an import's files: new ones are added; queued and failed ones get the fresh link and start
-- over (a re-scrape brings links that work again); stored and downloading ones are left alone.
-- p_files: [{ url_key, source_url, kind, page_id }]. Returns how many were queued and how many of
-- the files were already stored.
create function public.research_media_enqueue(p_user uuid, p_product uuid, p_files jsonb) returns table (queued integer, stored integer)
language plpgsql security definer set search_path = '' as $$
declare n_queued integer; n_stored integer;
begin
  with input as (
    select distinct on (f->>'url_key') f->>'url_key' as url_key, f->>'source_url' as source_url, f->>'kind' as kind, nullif(f->>'page_id', '') as page_id
      from jsonb_array_elements(coalesce(p_files, '[]'::jsonb)) f
     where coalesce(f->>'url_key', '') <> '' and f->>'source_url' like 'https://%' and f->>'kind' in ('video', 'image', 'poster')
     order by f->>'url_key'
  ), up as (
    insert into public.paid_ad_media as m (user_id, product_id, page_id, url_key, source_url, kind)
    select p_user, p_product, i.page_id, i.url_key, i.source_url, i.kind from input i
    on conflict (product_id, url_key) do update
      set source_url = excluded.source_url,
          page_id = coalesce(m.page_id, excluded.page_id),
          status = 'queued',
          attempts = case when m.status = 'failed' or m.source_url <> excluded.source_url then 0 else m.attempts end,
          error = null,
          lease_until = null
      where m.status in ('queued', 'failed')
    returning 1
  )
  select (select count(*) from up)::integer,
         (select count(*) from public.paid_ad_media m join input i on m.url_key = i.url_key where m.product_id = p_product and m.status = 'done')::integer
    into n_queued, n_stored;
  return query select n_queued, n_stored;
end;
$$;

-- Downloads running now (a live lease): the worker caps how many run at once.
create function public.research_media_active() returns integer
language sql security definer set search_path = '' as $$
  select count(*)::integer from public.paid_ad_media where status = 'downloading' and lease_until >= now();
$$;

-- A workspace's files by advertiser Page and status, with the bytes stored.
create function public.research_media_counts(p_product uuid) returns table (page_id text, status text, files bigint, bytes bigint)
language sql security definer set search_path = '' as $$
  select m.page_id, m.status, count(*), coalesce(sum(m.bytes), 0)::bigint
    from public.paid_ad_media m where m.product_id = p_product
   group by m.page_id, m.status;
$$;

-- MARK: Secrets (Vault)

-- The worker secret shared by the research function and its cron job, generated here so it never
-- leaves the database, and the function's address.
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'RESEARCH_WORKER_SECRET', 'Shared by the research edge function and its media cron job');
select vault.create_secret('https://hadmagbwpuqarmjvisci.supabase.co/functions/v1/research', 'RESEARCH_URL', 'Where the research media cron job calls the research function');

create function public.research_secrets() returns table (name text, value text)
language sql security definer set search_path = '' as $$
  select s.name, s.decrypted_secret from vault.decrypted_secrets s
   where s.name in ('RESEARCH_WORKER_SECRET', 'RESEARCH_URL');
$$;

-- Wakes the media worker (research/media-tick) with the worker secret.
create function public.research_media_call() returns void
language plpgsql security definer set search_path = '' as $$
declare url text; secret text;
begin
  select decrypted_secret into url from vault.decrypted_secrets where name = 'RESEARCH_URL';
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'RESEARCH_WORKER_SECRET';
  if url is null or secret is null then return; end if;
  perform net.http_post(
    url := url || '/media-tick',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-research-worker', secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
end;
$$;

-- Calls out only when there is work and no worker holds a live lease (a running worker chains itself),
-- or when a worker stopped mid-download (expired lease).
create function public.research_media_watchdog() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.paid_ad_media where status = 'downloading' and lease_until < now())
     or (exists (select 1 from public.paid_ad_media where status = 'queued' and (lease_until is null or lease_until < now()))
         and not exists (select 1 from public.paid_ad_media where status = 'downloading' and lease_until >= now())) then
    perform public.research_media_call();
  end if;
end;
$$;

revoke execute on function public.research_media_enqueue(uuid, uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.research_media_claim(integer, integer) from public, anon, authenticated;
revoke execute on function public.research_media_active() from public, anon, authenticated;
revoke execute on function public.research_media_counts(uuid) from public, anon, authenticated;
revoke execute on function public.research_secrets() from public, anon, authenticated;
revoke execute on function public.research_media_call() from public, anon, authenticated;
revoke execute on function public.research_media_watchdog() from public, anon, authenticated;
grant execute on function public.research_media_enqueue(uuid, uuid, jsonb) to service_role;
grant execute on function public.research_media_claim(integer, integer) to service_role;
grant execute on function public.research_media_active() to service_role;
grant execute on function public.research_media_counts(uuid) to service_role;
grant execute on function public.research_secrets() to service_role;

-- MARK: Schedule

-- Every minute; no HTTP call unless files are waiting and no worker is on them.
select cron.schedule('research-media', '* * * * *', 'select public.research_media_watchdog()');
