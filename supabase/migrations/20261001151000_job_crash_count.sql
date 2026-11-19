-- A job whose lease ran out while still held means its worker died mid-step. Count those in a row,
-- so a step that keeps killing its worker fails the job instead of retrying forever.
alter table public.jobs add column crashes integer not null default 0;

create or replace function public.radar_claim_job(p_job uuid, p_seconds integer) returns setof public.jobs
language sql security definer set search_path = '' as $$
  update public.jobs
     set crashes = case when lease_until is not null then crashes + 1 else 0 end,
         lease_until = now() + make_interval(secs => p_seconds),
         wakes = wakes + 1
   where id = p_job and status = 'running' and (lease_until is null or lease_until < now())
  returning *;
$$;
revoke execute on function public.radar_claim_job(uuid, integer) from public, anon, authenticated;
grant execute on function public.radar_claim_job(uuid, integer) to service_role;
