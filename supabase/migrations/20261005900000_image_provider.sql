-- Image generation: Higgsfield or OpenAI, the same model (GPT Image 2.5) either way.
--
-- products.image_provider: the person's choice for this product's image jobs, remembered between
--   generations (the Studio, the Playground and template remakes start from it; each generation can
--   still pick the other). Higgsfield unless changed.
-- creatives_claim_jobs(..., p_provider): the Higgsfield API worker claims only Higgsfield jobs, so an
--   OpenAI job (params.provider = 'openai', always backend 'api') is never made by Higgsfield. The
--   OpenAI worker takes its jobs with a conditional update of its own (the creatives function), and the
--   Mac runner's claim (backend 'local') never sees OpenAI jobs. Jobs planned before this have no
--   provider and count as Higgsfield.

alter table public.products
  add column if not exists image_provider text not null default 'higgsfield' check (image_provider in ('higgsfield', 'openai'));

comment on column public.products.image_provider is 'Who makes this product''s GPT Image 2.5 jobs unless a generation picks otherwise: higgsfield (default) or openai.';

-- As creatives_claim_jobs (20261002500000_creative_studio.sql), limited to one provider's jobs.
create or replace function public.creatives_claim_jobs(p_runner text, p_backend text, p_models text[], p_limit integer, p_seconds integer, p_provider text)
returns setof public.creative_jobs
language plpgsql security definer set search_path = '' as $$
begin
  perform public.creatives_requeue_stale();
  return query
  update public.creative_jobs j
     set status = 'running', backend = p_backend, runner_id = p_runner, attempts = j.attempts + 1,
         lease_until = now() + make_interval(secs => p_seconds), started_at = coalesce(j.started_at, now()), error = null
   where j.id in (
     select q.id from public.creative_jobs q
      where q.status = 'queued' and q.backend in (p_backend, 'auto')
        and (q.not_before is null or q.not_before <= now())
        and (p_models is null or q.model = any (p_models))
        and (p_provider is null or coalesce(q.params->>'provider', 'higgsfield') = p_provider)
      order by q.created_at
      limit greatest(0, least(p_limit, 20))
      for update skip locked)
  returning j.*;
end;
$$;
revoke execute on function public.creatives_claim_jobs(text, text, text[], integer, integer, text) from public, anon, authenticated;
grant execute on function public.creatives_claim_jobs(text, text, text[], integer, integer, text) to service_role;

-- The old claim (the Mac runner's, backend 'local') must never take an OpenAI job either, even one a
-- person moved to 'auto' by hand: the same function, with OpenAI jobs left out.
create or replace function public.creatives_claim_jobs(p_runner text, p_backend text, p_models text[], p_limit integer, p_seconds integer)
returns setof public.creative_jobs
language sql security definer set search_path = '' as $$
  select * from public.creatives_claim_jobs(p_runner, p_backend, p_models, p_limit, p_seconds, 'higgsfield');
$$;
revoke execute on function public.creatives_claim_jobs(text, text, text[], integer, integer) from public, anon, authenticated;
grant execute on function public.creatives_claim_jobs(text, text, text[], integer, integer) to service_role;

-- What the queue says when an OpenAI job waits too long (6 hours, like the Higgsfield API's).
create or replace function public.creatives_requeue_stale() returns integer
language plpgsql security definer set search_path = '' as $$
declare a integer; b integer; c integer;
begin
  update public.creative_jobs set status = 'running', lease_until = now() + interval '5 minutes'
   where status = 'finalizing' and lease_until < now();
  get diagnostics a = row_count;

  update public.creative_jobs
     set status = case when attempts - retries >= 3 then 'failed' else 'queued' end,
         error = case when attempts - retries >= 3 then 'The runner stopped three times on this job.' else error end,
         finished_at = case when attempts - retries >= 3 then now() else finished_at end,
         lease_until = null, runner_id = null
   where status = 'running' and lease_until < now() and backend <> 'template';
  get diagnostics b = row_count;

  update public.creative_jobs
     set status = 'failed', finished_at = now(), lease_until = null, runner_id = null,
         error = case
           when backend = 'template' then 'The post was never confirmed as rendered (the creatives backend didn''t answer). Start the batch again.'
           when backend = 'api' and params->>'provider' = 'openai' then 'OpenAI didn''t pick this job up within 6 hours. Check that OPENAI_API_KEY is set in Supabase and the creatives function is deployed, then retry (or try with Higgsfield instead).'
           when backend = 'api' then 'Higgsfield''s API didn''t pick this job up within 6 hours. Check that HIGGSFIELD_API_KEY is set in Supabase, then retry.'
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
grant execute on function public.creatives_requeue_stale() to service_role;
