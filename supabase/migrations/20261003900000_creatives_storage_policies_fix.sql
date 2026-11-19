-- The creatives storage policies in 20261002500000_creative_studio.sql used an unqualified `name`
-- inside the products subquery, so Postgres bound it to `p.name` (the product's name) and every
-- check became `p.id::text = (storage.foldername(p.name))[1]`, which never holds. Recreate them
-- with the object's name qualified: the first folder must be a product the user owns.

drop policy "Users read creatives of their products" on storage.objects;
drop policy "Users upload creatives for their products" on storage.objects;
drop policy "Users delete creatives of their products" on storage.objects;

create policy "Users read creatives of their products" on storage.objects for select to authenticated
  using (bucket_id = 'creatives' and exists (
    select 1 from public.products p where p.id::text = (storage.foldername(storage.objects.name))[1] and p.user_id = (select auth.uid())));
create policy "Users upload creatives for their products" on storage.objects for insert to authenticated
  with check (bucket_id = 'creatives' and exists (
    select 1 from public.products p where p.id::text = (storage.foldername(storage.objects.name))[1] and p.user_id = (select auth.uid())));
create policy "Users delete creatives of their products" on storage.objects for delete to authenticated
  using (bucket_id = 'creatives' and exists (
    select 1 from public.products p where p.id::text = (storage.foldername(storage.objects.name))[1] and p.user_id = (select auth.uid())));
