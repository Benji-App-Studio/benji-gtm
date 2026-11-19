-- Research → Ads: Apify pulls finish without the Research page open. A paid pull (Apify scrape) stays
-- "running" in ad_pulls until something asks the research function to read its finished run; until
-- now only the open page did. This watchdog asks every two minutes while a pull is running: it calls
-- the function's `poll-tick` route with the worker secret, which saves the finished runs' ads, queues
-- their media files, and gives up on pulls running for more than two days.
--
-- The function's address and the worker secret are the Vault entries the media watchdog uses
-- (RESEARCH_URL, RESEARCH_WORKER_SECRET; migration 20261003200000_ad_media).
-- Also: the research cron jobs keep a day of run history, like the radar watchdog.

create index if not exists ad_pulls_running_idx on public.ad_pulls (started_at)
  where status = 'running' and apify_run_id is not null;

-- Wakes the pull poller (research/poll-tick) with the worker secret.
create function public.research_pulls_call() returns void
language plpgsql security definer set search_path = '' as $$
declare url text; secret text;
begin
  select decrypted_secret into url from vault.decrypted_secrets where name = 'RESEARCH_URL';
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'RESEARCH_WORKER_SECRET';
  if url is null or secret is null then return; end if;
  perform net.http_post(
    url := url || '/poll-tick',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-research-worker', secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
end;
$$;

-- Calls out only while an Apify pull has been running for over a minute (the page's own poll usually
-- catches a quick one).
create function public.research_pulls_watchdog() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.ad_pulls
              where status = 'running' and apify_run_id is not null and started_at < now() - interval '1 minute') then
    perform public.research_pulls_call();
  end if;
end;
$$;

revoke execute on function public.research_pulls_call() from public, anon, authenticated;
revoke execute on function public.research_pulls_watchdog() from public, anon, authenticated;

-- MARK: Schedule

select cron.schedule('research-pulls', '*/2 * * * *', 'select public.research_pulls_watchdog()');

-- research-media runs every minute and research-pulls every two: keep a day of their run history.
select cron.schedule('research-trim-cron-history', '27 3 * * *', $$
  delete from cron.job_run_details
   where end_time < now() - interval '1 day'
     and jobid in (select jobid from cron.job where jobname in ('research-media', 'research-pulls', 'research-trim-cron-history'))
$$);
