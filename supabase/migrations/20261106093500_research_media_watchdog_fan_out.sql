-- The once-a-minute watchdog also starts a worker while files wait and fewer than 48 downloads are running,
-- not only when none is: one worker busy with a long video used to hold up the whole queue for minutes.
create or replace function public.research_media_watchdog() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.paid_ad_media where status = 'downloading' and lease_until < now())
     or (exists (select 1 from public.paid_ad_media where status = 'queued' and (lease_until is null or lease_until < now()))
         and (select count(*) from public.paid_ad_media where status = 'downloading' and lease_until >= now()) < 48) then
    perform public.research_media_call();
  end if;
end;
$$;
