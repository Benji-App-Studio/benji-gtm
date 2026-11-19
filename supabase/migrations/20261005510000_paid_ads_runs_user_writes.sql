-- What signed-in users may write, narrowed to what the studio actually writes.
--
-- paid_ads: ads come from the research edge function (service role). The studio only marks an ad sent
-- to the format library (library_seed, sent_to_library_at; and clears sent_to_library_at when a format
-- card is removed) and hides it (hidden). Users could update every column of their rows, including
-- the media links the media worker downloads; now they can update only those three, and only on ads
-- of a product they own.
--
-- runs: written by the radar edge function (service role): analysis runs, the demo's ready-made run
-- (its `demo-run` route) and deleting a run from history (`delete-run`). Users only read their runs.
-- Deleting a project still removes its runs (the foreign key's cascade isn't a user write).

-- MARK: paid_ads

drop policy if exists "Users update their paid ads" on public.paid_ads;
create policy "Users update their paid ads" on public.paid_ads for update to authenticated
  using ((select auth.uid()) = user_id and exists (
    select 1 from public.products p where p.id = product_id and p.user_id = (select auth.uid())))
  with check ((select auth.uid()) = user_id and exists (
    select 1 from public.products p where p.id = product_id and p.user_id = (select auth.uid())));

revoke update on public.paid_ads from anon, authenticated;
grant update (hidden, library_seed, sent_to_library_at) on public.paid_ads to authenticated;

-- MARK: runs

drop policy if exists "Users manage their runs" on public.runs;
create policy "Users read their runs" on public.runs for select to authenticated
  using ((select auth.uid()) = user_id);

revoke insert, update, delete on public.runs from anon, authenticated;
