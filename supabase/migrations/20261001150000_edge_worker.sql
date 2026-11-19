-- Radar's work moves into the `radar` edge function. Discovery and analysis run as resumable jobs:
-- the worker advances a job in short steps, holding a lease so only one worker touches it at a time,
-- and a pg_cron watchdog wakes any job whose worker stopped. Progress reaches the browser through
-- Realtime (projects, runs and an activity feed); reports live in their own table so progress
-- updates stay small. API keys live in Vault, readable only by the service role.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- MARK: Reports

alter table public.runs drop column report;
alter table public.runs add column progress jsonb not null default '{}'::jsonb;

create table public.run_reports (
  run_id uuid primary key references public.runs (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  report jsonb not null,
  created_at timestamptz not null default now()
);
create index run_reports_user_id_idx on public.run_reports (user_id);
alter table public.run_reports enable row level security;
create policy "Users read their reports" on public.run_reports for select to authenticated using ((select auth.uid()) = user_id);
-- The demo report is written by the signed-in user; real reports by the worker (service role).
create policy "Users add reports to their runs" on public.run_reports for insert to authenticated
  with check ((select auth.uid()) = user_id and exists (
    select 1 from public.runs r where r.id = run_id and r.user_id = (select auth.uid())));

-- MARK: Jobs (worker only: RLS on, no policies)

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  run_id uuid references public.runs (id) on delete cascade,
  kind text not null check (kind in ('discover', 'run')),
  status text not null default 'running' check (status in ('running', 'done', 'error', 'cancelled')),
  state jsonb not null default '{}'::jsonb,
  lease_until timestamptz,
  wakes integer not null default 0,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index jobs_running_idx on public.jobs (lease_until) where status = 'running';
create index jobs_project_id_idx on public.jobs (project_id);
create index jobs_run_id_idx on public.jobs (run_id);
create index jobs_user_id_idx on public.jobs (user_id);
create trigger jobs_touch before update on public.jobs for each row execute function public.touch_updated_at();
alter table public.jobs enable row level security;

-- Large intermediate results (scraped posts, decoded answers), kept apart from the job row.
create table public.job_data (
  job_id uuid not null references public.jobs (id) on delete cascade,
  name text not null,
  data jsonb not null,
  primary key (job_id, name)
);
alter table public.job_data enable row level security;

-- MARK: Activity feed

create table public.activity (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  run_id uuid references public.runs (id) on delete cascade,
  level text not null default 'info' check (level in ('info', 'warn', 'error', 'done')),
  message text not null,
  created_at timestamptz not null default now()
);
create index activity_project_idx on public.activity (project_id, id desc);
create index activity_run_id_idx on public.activity (run_id);
create index activity_user_id_idx on public.activity (user_id);
alter table public.activity enable row level security;
create policy "Users read their activity" on public.activity for select to authenticated using ((select auth.uid()) = user_id);

-- MARK: Realtime

alter publication supabase_realtime add table public.projects, public.runs, public.activity;

-- MARK: Leases

-- Claims a running job for `seconds` if nobody holds it. Returns the job, or nothing.
create function public.radar_claim_job(p_job uuid, p_seconds integer) returns setof public.jobs
language sql security definer set search_path = '' as $$
  update public.jobs
     set lease_until = now() + make_interval(secs => p_seconds), wakes = wakes + 1
   where id = p_job and status = 'running' and (lease_until is null or lease_until < now())
  returning *;
$$;

-- Running jobs nobody holds (their worker stopped or handed over).
create function public.radar_idle_jobs() returns setof uuid
language sql security definer set search_path = '' as $$
  select id from public.jobs where status = 'running' and (lease_until is null or lease_until < now()) order by updated_at limit 20;
$$;

-- MARK: Secrets (Vault)

create function public.radar_put_secret(p_name text, p_value text) returns void
language plpgsql security definer set search_path = '' as $$
declare existing uuid;
begin
  if p_name not in ('TYPESAFE_API_KEY', 'APIFY_TOKEN', 'OPENAI_API_KEY', 'OPENAI_MODEL', 'RADAR_WORKER_SECRET', 'RADAR_URL') then
    raise exception 'Unknown secret %', p_name;
  end if;
  select id into existing from vault.secrets where name = p_name;
  if existing is null then
    perform vault.create_secret(p_value, p_name);
  else
    perform vault.update_secret(existing, p_value, p_name);
  end if;
end;
$$;

create function public.radar_secrets() returns table (name text, value text)
language sql security definer set search_path = '' as $$
  select s.name, s.decrypted_secret from vault.decrypted_secrets s
   where s.name in ('TYPESAFE_API_KEY', 'APIFY_TOKEN', 'OPENAI_API_KEY', 'OPENAI_MODEL', 'RADAR_WORKER_SECRET', 'RADAR_URL');
$$;

-- MARK: Watchdog

-- Every few seconds: if any running job has no worker, ask the edge function to pick it up.
create function public.radar_watchdog() returns void
language plpgsql security definer set search_path = '' as $$
declare url text; secret text;
begin
  if not exists (select 1 from public.jobs where status = 'running' and (lease_until is null or lease_until < now())) then
    return;
  end if;
  select decrypted_secret into url from vault.decrypted_secrets where name = 'RADAR_URL';
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

revoke execute on function public.radar_claim_job(uuid, integer) from public, anon, authenticated;
revoke execute on function public.radar_idle_jobs() from public, anon, authenticated;
revoke execute on function public.radar_put_secret(text, text) from public, anon, authenticated;
revoke execute on function public.radar_secrets() from public, anon, authenticated;
revoke execute on function public.radar_watchdog() from public, anon, authenticated;
grant execute on function public.radar_claim_job(uuid, integer) to service_role;
grant execute on function public.radar_idle_jobs() to service_role;
grant execute on function public.radar_put_secret(text, text) to service_role;
grant execute on function public.radar_secrets() to service_role;

select cron.schedule('radar-watchdog', '10 seconds', 'select public.radar_watchdog()');
