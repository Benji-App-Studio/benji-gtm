-- The import pop-up's storage check (Nov 6 2026). Before a scraper file is imported, the research function's
-- `media-preview` measures each new file and the storage left, and the Research page says how many files are
-- already stored, how many videos are over the 50 MB upload limit (skipped) and how many won't fit (left
-- behind). Its decisions are kept here by hold id and applied when the same import queues its files; a
-- re-import of the file later picks up only what's missing and checks the room again.

create table if not exists public.research_media_holds (
  hold_id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  product_id uuid not null,
  -- { url_key: "too_big" | "no_room" }
  holds jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.research_media_holds enable row level security;
-- Only the research function (service role) reads and writes it.

-- Bytes stored across every bucket (the plan's storage is shared by all of them).
create or replace function public.research_storage_used() returns bigint
language sql security definer set search_path = '' as $$
  select coalesce(sum((o.metadata->>'size')::bigint), 0)::bigint from storage.objects o;
$$;

-- Files an import won't store now: recorded as failed with the reason (a stored file is left alone), so the
-- page can say why and a later import of the same file queues them again.
-- p_files: [{ url_key, source_url, kind, page_id, error }]
create or replace function public.research_media_hold(p_user uuid, p_product uuid, p_files jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  with input as (
    select distinct on (f->>'url_key') f->>'url_key' as url_key, f->>'source_url' as source_url, f->>'kind' as kind,
           nullif(f->>'page_id', '') as page_id, left(coalesce(f->>'error', ''), 400) as error
      from jsonb_array_elements(coalesce(p_files, '[]'::jsonb)) f
     where coalesce(f->>'url_key', '') <> '' and f->>'source_url' like 'https://%' and f->>'kind' in ('video', 'image', 'poster')
     order by f->>'url_key'
  ), up as (
    insert into public.paid_ad_media as m (user_id, product_id, page_id, url_key, source_url, kind, status, error)
    select p_user, p_product, i.page_id, i.url_key, i.source_url, i.kind, 'failed', i.error from input i
    on conflict (product_id, url_key) do update
      set source_url = excluded.source_url, page_id = coalesce(m.page_id, excluded.page_id),
          status = 'failed', error = excluded.error, lease_until = null
      where m.status in ('queued', 'failed')
    returning 1
  )
  select count(*)::integer from up into n;
  return n;
end;
$$;

revoke execute on function public.research_storage_used() from public, anon, authenticated;
revoke execute on function public.research_media_hold(uuid, uuid, jsonb) from public, anon, authenticated;
