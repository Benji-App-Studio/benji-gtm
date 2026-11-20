-- Fair job claims between accounts (accounts mode).
--
-- The older claims (20261005900000_image_provider.sql) take the oldest queued jobs of anyone: one
-- account that queues a hundred jobs would hold every worker slot. This overload takes them round-robin
-- (each account's oldest first, then each account's second, ...), and never more of one account's jobs
-- than its plan's jobConcurrency minus the jobs it has running already (and `p_per_user` when given).
--   p_user        only this account's jobs (null: anyone's)
--   p_per_user    at most this many per account in one claim (null: the plan's concurrency only)
--   p_staff_only  only staff accounts' jobs (the platform's desktop runner, phase 1)
-- Suspended accounts' jobs are never claimed. Install and legacy databases keep calling the older
-- signatures, which are unchanged.

create or replace function public.creatives_claim_jobs(
  p_runner text, p_backend text, p_models text[], p_limit integer, p_seconds integer, p_provider text,
  p_user uuid, p_per_user integer, p_staff_only boolean
)
returns setof public.creative_jobs
language plpgsql security definer set search_path = '' as $$
begin
  perform public.creatives_requeue_stale();
  return query
  with busy as (
    select r.user_id, count(*)::integer as n
      from public.creative_jobs r
     where r.status in ('running', 'finalizing') and r.backend <> 'template'
     group by r.user_id
  ), candidates as (
    select q.id, q.user_id, q.created_at,
           row_number() over (partition by q.user_id order by q.created_at) as turn
      from public.creative_jobs q
      left join public.accounts a on a.user_id = q.user_id
     where q.status = 'queued' and q.backend in (p_backend, 'auto')
       and (q.not_before is null or q.not_before <= now())
       and (p_models is null or q.model = any (p_models))
       and (p_provider is null or coalesce(q.params->>'provider', 'higgsfield') = p_provider)
       and (p_user is null or q.user_id = p_user)
       and (not coalesce(p_staff_only, false) or coalesce(a.staff, false))
       and coalesce(a.status, 'active') <> 'suspended'
  ), allowed as (
    select c.id, c.turn, c.created_at
      from candidates c
      left join busy b on b.user_id = c.user_id
     where c.turn <= greatest(0,
             least(coalesce(p_per_user, 2147483647),
                   coalesce((public.account_limits(c.user_id)->>'jobConcurrency')::integer, 2))
             - coalesce(b.n, 0))
     order by c.turn, c.created_at
     limit greatest(0, least(p_limit, 20))
  )
  update public.creative_jobs j
     set status = 'running', backend = p_backend, runner_id = p_runner, attempts = j.attempts + 1,
         lease_until = now() + make_interval(secs => p_seconds), started_at = coalesce(j.started_at, now()), error = null
   where j.id in (
     select l.id from public.creative_jobs l
      where l.id in (select id from allowed) and l.status = 'queued'
      for update skip locked)
  returning j.*;
end;
$$;

revoke execute on function public.creatives_claim_jobs(text, text, text[], integer, integer, text, uuid, integer, boolean) from public, anon, authenticated;
grant execute on function public.creatives_claim_jobs(text, text, text[], integer, integer, text, uuid, integer, boolean) to service_role;
