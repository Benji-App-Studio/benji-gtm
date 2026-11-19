-- The creatives tick wakes the edge function's Higgsfield API worker only for jobs it can run. It knew
-- the image models alone, so a queued AI video (Seedance 2.5, backend 'api' or 'auto') never woke it.
-- Same function, with seedance_2_5 in the list (the edge function's API_MODELS).
create or replace function public.creatives_tick() returns void
language plpgsql security definer set search_path = '' as $$
declare url text; secret text;
begin
  perform public.creatives_requeue_stale();
  if not exists (
    select 1 from public.creative_jobs
     where (status = 'running' and backend = 'api')
        or (status = 'queued' and backend in ('api', 'auto') and model in ('gpt_image_2_5', 'marketing_studio_image', 'seedance_2_5')
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
