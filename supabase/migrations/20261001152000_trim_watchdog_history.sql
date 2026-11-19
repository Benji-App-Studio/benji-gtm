-- The watchdog runs every 10 seconds; keep a day of its run history.
select cron.schedule('radar-trim-cron-history', '17 3 * * *', $$
  delete from cron.job_run_details
   where end_time < now() - interval '1 day'
     and jobid in (select jobid from cron.job where jobname in ('radar-watchdog', 'radar-trim-cron-history'))
$$);
