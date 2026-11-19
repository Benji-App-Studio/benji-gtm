-- Creative studio and QA. A batch turns a format card or a brief into creative jobs (Higgsfield UGC
-- videos and image ads, plus Reddit- and tweet-style ads rendered from templates). Jobs run on the
-- local runner (the Higgsfield CLI on the owner's Mac) or, for models the public API offers, inside
-- the `creatives` edge function. Every output becomes a creative; Jev checks it (QA) and a person
-- approves or rejects it. Only approved creatives go on to launch.
--
-- Rows belong to one user. Users can read their rows, queue and cancel jobs, and approve or reject
-- creatives; QA results and job outcomes are written only by the backend (service role), so the
-- QA verdict can't be set from the browser.

-- MARK: Tables

create table public.creative_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  format_card_id text,
  brief text not null default '' check (char_length(brief) <= 5000),
  -- What was asked for: kinds, variants, aspect ratios, model options.
  settings jsonb not null default '{}'::jsonb,
  -- What QA checks against, frozen at creation: app name, competitors, policy, forbidden claims.
  context jsonb not null default '{}'::jsonb,
  cost_estimate numeric(10, 2) not null default 0,
  created_at timestamptz not null default now()
);

create table public.creative_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  batch_id uuid references public.creative_batches (id) on delete cascade,
  format_card_id text,
  kind text not null check (kind in ('ugc_video', 'image', 'reddit', 'tweet')),
  model text not null,
  prompt text not null default '' check (char_length(prompt) <= 5000),
  params jsonb not null default '{}'::jsonb,
  aspect text not null default '9:16',
  variant integer not null default 1,
  -- Who runs it: the Mac runner (local), the edge function with HIGGSFIELD_API_KEY (api), whichever
  -- claims it first (auto), or the studio's own template renderer (template).
  backend text not null default 'auto' check (backend in ('auto', 'local', 'api', 'template')),
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'cancelled')),
  cost_estimate numeric(10, 2) not null default 0,
  cost_credits numeric(10, 2),
  attempts integer not null default 0,
  not_before timestamptz,
  lease_until timestamptz,
  runner_id text,
  external_id text,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.creatives (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  job_id uuid references public.creative_jobs (id) on delete set null,
  batch_id uuid references public.creative_batches (id) on delete set null,
  format_card_id text,
  kind text not null check (kind in ('video', 'image')),
  style text not null check (style in ('ugc_video', 'image', 'reddit', 'tweet')),
  aspect text not null,
  width integer,
  height integer,
  duration_sec numeric(8, 2),
  -- In the `creatives` bucket: <productId>/<yyyy-mm-dd>/<jobId>/<file>. `url` is its public https
  -- address (paths carry random ids); `thumbnail_url` is a poster frame, kept for every video because
  -- Meta doesn't always make one.
  storage_path text not null,
  poster_path text,
  url text not null check (url ~ '^https://'),
  thumbnail_url text check (thumbnail_url ~ '^https://'),
  mime text not null,
  size_bytes bigint,
  source_url text,
  model text,
  prompt text,
  -- Text we know is in the creative (template copy, hook), and what OCR read off it.
  copy jsonb not null default '{}'::jsonb,
  ocr jsonb,
  qa_status text not null default 'pending' check (qa_status in ('pending', 'running', 'pass', 'warn', 'fail', 'error')),
  qa jsonb,
  qa_at timestamptz,
  approval text not null default 'pending' check (approval in ('pending', 'approved', 'rejected')),
  approval_note text check (char_length(approval_note) <= 2000),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users (id) on delete set null,
  notes text check (char_length(notes) <= 4000),
  drive_file_id text,
  -- The ad copy Launch (radar/launch) uses, prefilled from the job and edited at review.
  title text check (char_length(title) <= 200),
  headline text check (char_length(headline) <= 255),
  primary_text text check (char_length(primary_text) <= 2200),
  cta text check (char_length(cta) <= 40),
  hook_type text check (char_length(hook_type) <= 60),
  format_slug text check (char_length(format_slug) <= 120),
  -- Launch reads `status = 'approved'` and `approved_at`.
  status text generated always as (approval) stored,
  approved_at timestamptz generated always as (case when approval = 'approved' then reviewed_at end) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Nothing ships without a passing (or warned-and-noted) QA.
  constraint creatives_approved_after_qa check (approval <> 'approved' or qa_status in ('pass', 'warn')),
  constraint creatives_warned_needs_note check (approval <> 'approved' or qa_status <> 'warn' or coalesce(char_length(approval_note), 0) > 0),
  constraint creatives_video_has_thumbnail check (approval <> 'approved' or kind <> 'video' or thumbnail_url is not null)
);

create index creative_batches_product_idx on public.creative_batches (product_id, created_at desc);
create index creative_batches_user_idx on public.creative_batches (user_id);
create index creative_jobs_queue_idx on public.creative_jobs (created_at) where status = 'queued';
create index creative_jobs_running_idx on public.creative_jobs (lease_until) where status = 'running';
create index creative_jobs_product_idx on public.creative_jobs (product_id, created_at desc);
create index creative_jobs_batch_idx on public.creative_jobs (batch_id);
create index creative_jobs_user_idx on public.creative_jobs (user_id);
create index creatives_product_idx on public.creatives (product_id, created_at desc);
create index creatives_approved_idx on public.creatives (product_id, approved_at desc) where approval = 'approved';
create index creatives_job_idx on public.creatives (job_id);
create index creatives_batch_idx on public.creatives (batch_id);
create index creatives_user_idx on public.creatives (user_id);
create index creatives_reviewed_by_idx on public.creatives (reviewed_by);

create trigger creative_jobs_touch before update on public.creative_jobs for each row execute function public.touch_updated_at();
create trigger creatives_touch before update on public.creatives for each row execute function public.touch_updated_at();

-- Higgsfield's Marketing Studio catalog (avatars, hooks, settings), synced by the local runner so the
-- studio can offer them. Shared by everyone signed in; written by the backend only.
create table public.creative_catalog (
  kind text primary key check (kind in ('avatars', 'hooks', 'settings')),
  items jsonb not null default '[]'::jsonb,
  synced_at timestamptz not null default now()
);

-- MARK: Row-level security

alter table public.creative_batches enable row level security;
alter table public.creative_jobs enable row level security;
alter table public.creatives enable row level security;
alter table public.creative_catalog enable row level security;

create policy "Users read their creative batches" on public.creative_batches for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Users add creative batches for their products" on public.creative_batches for insert to authenticated
  with check ((select auth.uid()) = user_id and exists (
    select 1 from public.products p where p.id = product_id and p.user_id = (select auth.uid())));
create policy "Users delete their creative batches" on public.creative_batches for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users read their creative jobs" on public.creative_jobs for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Users queue creative jobs for their products" on public.creative_jobs for insert to authenticated
  with check ((select auth.uid()) = user_id and exists (
    select 1 from public.products p where p.id = product_id and p.user_id = (select auth.uid())));
create policy "Users cancel or retry their creative jobs" on public.creative_jobs for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "Users read their creatives" on public.creatives for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Users add creatives for their products" on public.creatives for insert to authenticated
  with check ((select auth.uid()) = user_id and exists (
    select 1 from public.products p where p.id = product_id and p.user_id = (select auth.uid())));
create policy "Users review their creatives" on public.creatives for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users delete their creatives" on public.creatives for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy "Signed-in users read the creative catalog" on public.creative_catalog for select to authenticated using (true);

-- Column privileges: the browser may queue, cancel and retry jobs, review creatives and edit their ad
-- copy, but never write job outcomes, costs or QA results.
revoke insert, update on public.creative_jobs from anon, authenticated;
grant insert (user_id, product_id, batch_id, format_card_id, kind, model, prompt, params, aspect, variant, backend, cost_estimate)
  on public.creative_jobs to authenticated;
grant update (status, not_before, error) on public.creative_jobs to authenticated;

revoke insert, update on public.creatives from anon, authenticated;
-- Template creatives are rendered by the studio as the user; they start with QA pending.
grant insert (user_id, product_id, job_id, batch_id, format_card_id, kind, style, aspect, width, height, storage_path, url, mime, size_bytes, model, prompt, copy,
  title, headline, primary_text, cta, hook_type, format_slug)
  on public.creatives to authenticated;
grant update (approval, approval_note, reviewed_at, reviewed_by, notes, title, headline, primary_text, cta, hook_type, format_slug) on public.creatives to authenticated;

revoke insert, update, delete on public.creative_catalog from anon, authenticated;

-- A user can only move a job to cancelled (from queued) or back to queued (from failed/cancelled).
create function public.creative_jobs_user_transition() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (select auth.role()) = 'authenticated' and new.status is distinct from old.status then
    if not ((old.status = 'queued' and new.status = 'cancelled')
         or (old.status in ('failed', 'cancelled') and new.status = 'queued')) then
      raise exception 'A job can only be cancelled while queued, or retried after it failed or was cancelled';
    end if;
  end if;
  return new;
end;
$$;
create trigger creative_jobs_user_transition before update on public.creative_jobs for each row execute function public.creative_jobs_user_transition();
revoke execute on function public.creative_jobs_user_transition() from public, anon, authenticated;

-- Approvals record who and when; a re-run of QA resets an earlier decision.
create function public.creatives_review_stamp() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.approval is distinct from old.approval then
    new.reviewed_at := now();
    new.reviewed_by := coalesce((select auth.uid()), new.reviewed_by);
  end if;
  -- QA ran again: whatever was decided before needs a fresh look.
  if new.qa_status is distinct from old.qa_status and old.approval <> 'pending' and new.approval = old.approval then
    new.approval := 'pending';
    new.reviewed_at := null;
  end if;
  return new;
end;
$$;
create trigger creatives_review_stamp before update on public.creatives for each row execute function public.creatives_review_stamp();
revoke execute on function public.creatives_review_stamp() from public, anon, authenticated;

-- MARK: Storage

-- Public, like `thumbs`: Launch hands Meta a plain https URL, and every path carries a random job
-- id. Listing and writing still need the policies below.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('creatives', 'creatives', true, 52428800, array['image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/quicktime']);

create policy "Users read creatives of their products" on storage.objects for select to authenticated
  using (bucket_id = 'creatives' and exists (
    select 1 from public.products p where p.id::text = (storage.foldername(name))[1] and p.user_id = (select auth.uid())));
create policy "Users upload creatives for their products" on storage.objects for insert to authenticated
  with check (bucket_id = 'creatives' and exists (
    select 1 from public.products p where p.id::text = (storage.foldername(name))[1] and p.user_id = (select auth.uid())));
create policy "Users delete creatives of their products" on storage.objects for delete to authenticated
  using (bucket_id = 'creatives' and exists (
    select 1 from public.products p where p.id::text = (storage.foldername(name))[1] and p.user_id = (select auth.uid())));

-- MARK: Realtime

alter publication supabase_realtime add table public.creative_jobs, public.creatives;

-- MARK: Queue

-- Running jobs whose lease ran out go back to the queue (their runner died), or fail after 3 tries.
create function public.creatives_requeue_stale() returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  update public.creative_jobs
     set status = case when attempts >= 3 then 'failed' else 'queued' end,
         error = case when attempts >= 3 then 'The runner stopped three times on this job.' else error end,
         finished_at = case when attempts >= 3 then now() else finished_at end,
         lease_until = null, runner_id = null
   where status = 'running' and lease_until < now() and backend <> 'template';
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Claims up to `p_limit` queued jobs for one backend ('local' or 'api'), oldest first, for
-- `p_seconds`. `p_models` limits the claim to models that backend can run (null: any).
create function public.creatives_claim_jobs(p_runner text, p_backend text, p_models text[], p_limit integer, p_seconds integer)
returns setof public.creative_jobs
language plpgsql security definer set search_path = '' as $$
begin
  perform public.creatives_requeue_stale();
  return query
  update public.creative_jobs j
     set status = 'running', backend = p_backend, runner_id = p_runner, attempts = j.attempts + 1,
         lease_until = now() + make_interval(secs => p_seconds), started_at = coalesce(j.started_at, now()), error = null
   where j.id in (
     select q.id from public.creative_jobs q
      where q.status = 'queued' and q.backend in (p_backend, 'auto')
        and (q.not_before is null or q.not_before <= now())
        and (p_models is null or q.model = any (p_models))
      order by q.created_at
      limit greatest(0, least(p_limit, 20))
      for update skip locked)
  returning j.*;
end;
$$;

-- Keeps a runner's lease on jobs it's still working on.
create function public.creatives_extend_lease(p_runner text, p_jobs uuid[], p_seconds integer) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  update public.creative_jobs set lease_until = now() + make_interval(secs => p_seconds)
   where id = any (p_jobs) and runner_id = p_runner and status = 'running';
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function public.creatives_requeue_stale() from public, anon, authenticated;
revoke execute on function public.creatives_claim_jobs(text, text, text[], integer, integer) from public, anon, authenticated;
revoke execute on function public.creatives_extend_lease(text, uuid[], integer) from public, anon, authenticated;
grant execute on function public.creatives_requeue_stale() to service_role;
grant execute on function public.creatives_claim_jobs(text, text, text[], integer, integer) to service_role;
grant execute on function public.creatives_extend_lease(text, uuid[], integer) to service_role;

-- MARK: Tick (server-side Higgsfield API backend)

-- Every 30 seconds: requeue stale jobs, and when jobs could run on Higgsfield's public API (image
-- models; the edge function only acts when HIGGSFIELD_API_KEY is set), wake the creatives function.
-- It shares RADAR_WORKER_SECRET with the radar watchdog.
select vault.create_secret('https://hadmagbwpuqarmjvisci.supabase.co/functions/v1/creatives', 'CREATIVES_URL', 'Where the creatives tick wakes the creatives edge function');

create function public.creatives_tick() returns void
language plpgsql security definer set search_path = '' as $$
declare url text; secret text;
begin
  perform public.creatives_requeue_stale();
  if not exists (
    select 1 from public.creative_jobs
     where (status = 'running' and backend = 'api')
        or (status = 'queued' and backend in ('api', 'auto') and model in ('gpt_image_2_5', 'marketing_studio_image')
            and (not_before is null or not_before <= now()))) then
    return;
  end if;
  select decrypted_secret into url from vault.decrypted_secrets where name = 'CREATIVES_URL';
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'RADAR_WORKER_SECRET';
  if url is null or secret is null then
    return;
  end if;
  perform net.http_post(
    url := url || '/tick',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-radar-worker', secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
end;
$$;
revoke execute on function public.creatives_tick() from public, anon, authenticated;

select cron.schedule('creatives-tick', '30 seconds', 'select public.creatives_tick()');
