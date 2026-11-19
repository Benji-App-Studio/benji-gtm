-- Creative jobs that loop, pay twice or wait forever.
--
-- retries: a counter that only grows. Every busy/rate-limited hand-back (and every failed look at a
--   submitted API job) adds one; at MAX_RETRIES (the creatives edge function) the job fails. Before,
--   `attempts` went up on claim and down on a busy hand-back, so a job that was always busy never ran
--   out of tries. `attempts` still counts claims; attempts - retries is how often a runner took the job
--   and never handed it back (the stale-lease rule below).
-- finalizing: a finished job is taken with a conditional update (running → finalizing) before its files
--   and creatives are saved, so two ticks (or a repeated runner/complete) can't save one result twice.
--   One that dies halfway goes back to running and is collected again, never submitted again.
-- Queued jobs no backend picks up fail after a limit that fits their backend, with a message that says
--   what to check, instead of waiting forever.
-- A person's retry (failed/cancelled → queued) starts the counters again.
-- The tick also wakes the edge function for creatives waiting for QA to run again
--   (20261005310000_creatives_review_reset.sql).

alter table public.creative_jobs add column retries integer not null default 0;

alter table public.creative_jobs drop constraint creative_jobs_status_check;
alter table public.creative_jobs add constraint creative_jobs_status_check
  check (status in ('queued', 'running', 'finalizing', 'done', 'failed', 'cancelled'));

-- MARK: Queue

create or replace function public.creatives_requeue_stale() returns integer
language plpgsql security definer set search_path = '' as $$
declare a integer; b integer; c integer;
begin
  -- A save that died halfway: back to running, so the same result is collected again.
  update public.creative_jobs set status = 'running', lease_until = now() + interval '5 minutes'
   where status = 'finalizing' and lease_until < now();
  get diagnostics a = row_count;

  -- Running jobs whose lease ran out go back to the queue (their runner died), or fail after the third
  -- time a runner took the job and never handed it back.
  update public.creative_jobs
     set status = case when attempts - retries >= 3 then 'failed' else 'queued' end,
         error = case when attempts - retries >= 3 then 'The runner stopped three times on this job.' else error end,
         finished_at = case when attempts - retries >= 3 then now() else finished_at end,
         lease_until = null, runner_id = null
   where status = 'running' and lease_until < now() and backend <> 'template';
  get diagnostics b = row_count;

  -- Queued too long for its backend (queued since its last update: a retry or a hand-back touches it).
  update public.creative_jobs
     set status = 'failed', finished_at = now(), lease_until = null, runner_id = null,
         error = case backend
           when 'template' then 'The post was never confirmed as rendered (the creatives backend didn''t answer). Start the batch again.'
           when 'api' then 'Higgsfield''s API didn''t pick this job up within 6 hours. Check that HIGGSFIELD_API_KEY is set in Supabase, then retry.'
           else 'No runner picked this job up within 2 days. Start the Mac runner (npm run creative-runner) or set HIGGSFIELD_API_KEY, then retry.'
         end
   where status = 'queued'
     and greatest(updated_at, coalesce(not_before, updated_at)) < now() - case backend
           when 'template' then interval '30 minutes'
           when 'api' then interval '6 hours'
           else interval '2 days'
         end;
  get diagnostics c = row_count;
  return a + b + c;
end;
$$;
revoke execute on function public.creatives_requeue_stale() from public, anon, authenticated;

-- A user can only move a job to cancelled (from queued) or back to queued (from failed/cancelled); a
-- retry starts its counters again.
create or replace function public.creative_jobs_user_transition() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (select auth.role()) = 'authenticated' and new.status is distinct from old.status then
    if not ((old.status = 'queued' and new.status = 'cancelled')
         or (old.status in ('failed', 'cancelled') and new.status = 'queued')) then
      raise exception 'A job can only be cancelled while queued, or retried after it failed or was cancelled';
    end if;
    if new.status = 'queued' then
      new.attempts := 0;
      new.retries := 0;
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.creative_jobs_user_transition() from public, anon, authenticated;

-- MARK: Tick

-- As in 20261004100000_creatives_tick_seedance.sql, and also when creatives wait for QA to run again.
create or replace function public.creatives_tick() returns void
language plpgsql security definer set search_path = '' as $$
declare url text; secret text;
begin
  perform public.creatives_requeue_stale();
  if not exists (
    select 1 from public.creative_jobs
     where (status = 'running' and backend = 'api')
        or (status = 'queued' and backend in ('api', 'auto') and model in ('gpt_image_2_5', 'marketing_studio_image', 'seedance_2_5')
            and (not_before is null or not_before <= now())))
     and not exists (
    select 1 from public.creatives
     where qa_status = 'pending' and (qa->>'rerun')::boolean and updated_at < now() - interval '1 minute') then
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
