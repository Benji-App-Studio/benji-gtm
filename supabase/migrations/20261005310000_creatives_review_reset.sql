-- A creative whose file or on-screen words change after QA (a composed text set again, our logo placed
-- or moved) is not the creative QA checked or the reviewer approved. Same trigger as in
-- 20261002500000_creative_studio.sql, extended: when url, storage_path or the copy QA reads (headline,
-- body, author, community, hook) change, QA goes back to pending with a rerun marker (`qa.rerun`) and
-- any decision goes back to pending with a note saying why. The routes that change a file ask for QA
-- straight away; the creatives tick re-runs any marked creative left pending for a minute (and wakes
-- the edge function for them, 20261005320000_creative_jobs_retries.sql).
create or replace function public.creatives_review_stamp() returns trigger
language plpgsql set search_path = '' as $$
declare
  changed boolean := new.url is distinct from old.url or new.storage_path is distinct from old.storage_path
    or (new.copy->>'headline', new.copy->>'body', new.copy->>'author', new.copy->>'community', new.copy->>'hook')
       is distinct from (old.copy->>'headline', old.copy->>'body', old.copy->>'author', old.copy->>'community', old.copy->>'hook');
begin
  if changed then
    new.qa_status := 'pending';
    new.qa := coalesce(old.qa, '{}'::jsonb) || jsonb_build_object('rerun', true);
  end if;
  if new.approval is distinct from old.approval then
    new.reviewed_at := now();
    new.reviewed_by := coalesce((select auth.uid()), new.reviewed_by);
  end if;
  -- QA ran again (or will): whatever was decided before needs a fresh look.
  if (changed or new.qa_status is distinct from old.qa_status) and old.approval <> 'pending' and new.approval = old.approval then
    new.approval := 'pending';
    new.reviewed_at := null;
    if changed then
      new.approval_note := format('The file or its words changed after it was %s: review it again.', old.approval);
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.creatives_review_stamp() from public, anon, authenticated;

-- What the tick looks for: creatives waiting for QA to run again.
create index if not exists creatives_qa_pending_idx on public.creatives (updated_at) where qa_status = 'pending';
