-- The secret the radar edge function and the pg_cron watchdog share, generated here so it never
-- leaves the database, and the function's address. API keys are edge function secrets.
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'RADAR_WORKER_SECRET', 'Shared by the radar edge function and the radar-watchdog cron job');
select vault.create_secret('https://hadmagbwpuqarmjvisci.supabase.co/functions/v1/radar', 'RADAR_URL', 'Where the watchdog wakes the radar worker');
drop function public.radar_put_secret(text, text);
