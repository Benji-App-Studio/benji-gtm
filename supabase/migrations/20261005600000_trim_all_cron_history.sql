-- pg_cron keeps a row in cron.job_run_details for every run of every job, forever. The watchdogs run
-- every 10 to 60 seconds (radar-watchdog, creatives-tick, launch-watchdog, research-media), so the
-- table grows by tens of thousands of rows a day. 20261001152000 trimmed radar-watchdog only; this
-- trims every job, including ones added later, and replaces that narrower job.
--
-- Rule: a run is deleted once it is older than p_keep (one day by default), except that each job's
-- latest p_keep_runs runs (20 by default) are always kept, so a daily or six-hourly job still shows
-- its recent history. Runs of jobs that no longer exist simply age out.
--
-- Safe to run again, and safe next to other trim jobs (for example one a module adds for its own
-- cron job): deleting the same old rows twice is a no-op.

create or replace function public.cron_trim_history(p_keep interval default interval '1 day', p_keep_runs integer default 20)
returns integer
language plpgsql set search_path = '' as $$
declare removed integer;
begin
  delete from cron.job_run_details d
   where coalesce(d.end_time, d.start_time) < now() - p_keep
     and d.runid not in (
       select r.runid
         from (select runid, row_number() over (partition by jobid order by runid desc) as n
                 from cron.job_run_details
                where jobid in (select jobid from cron.job)) r
        where r.n <= p_keep_runs
     );
  get diagnostics removed = row_count;
  return removed;
end;
$$;

-- Only the cron job (running as the migration owner) calls it; never over the API.
revoke execute on function public.cron_trim_history(interval, integer) from public, anon, authenticated;

-- The generic job replaces the radar-only one.
select cron.unschedule(jobid) from cron.job where jobname = 'radar-trim-cron-history';

-- Hourly, so the table never holds much more than a day of the 10-second watchdog. cron.schedule
-- with a name updates the job when it already exists.
select cron.schedule('trim-cron-history', '17 * * * *', 'select public.cron_trim_history()');
