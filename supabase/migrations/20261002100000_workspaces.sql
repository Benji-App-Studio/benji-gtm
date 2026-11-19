-- Products become workspaces: each one carries the accounts the growth modules (research, studio,
-- launch, measure) work against, and a brand kit for the creatives. Both are JSON so modules can
-- grow them without a migration each; studio/src/lib/workspace.ts is the contract that reads them.
--   connections        Meta ad account, Page, Instagram, pixel and app IDs; RevenueCat project;
--                      AppStack app; where the workspace's files live. IDs only, never secrets.
--   brand_kit          App name, tagline, icon, colours, real screenshots, tone, forbidden claims,
--                      App Store link.
--   connection_checks  The last verification of each connection, with the values it checked, so a
--                      connection counts as verified only while its values are unchanged.
-- Products already have owner-only RLS ("Users manage their products"), which covers the new columns.

alter table public.products
  add column connections jsonb not null default '{}'::jsonb check (jsonb_typeof(connections) = 'object'),
  add column brand_kit jsonb not null default '{}'::jsonb check (jsonb_typeof(brand_kit) = 'object'),
  add column connection_checks jsonb not null default '{}'::jsonb check (jsonb_typeof(connection_checks) = 'object');

-- MARK: Brand assets

-- Icons and screenshots (and later anything a module saves for the workspace), under
-- <user id>/<product id>/. Public, like thumbs: creative tools and Meta fetch them by URL, and they
-- are App Store material anyway. Only the owner can list, add, replace or remove them.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('workspace', 'workspace', true, 15728640, array['image/png', 'image/jpeg', 'image/webp']);

create policy "Users list their workspace files" on storage.objects for select to authenticated
  using (bucket_id = 'workspace' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Users add workspace files to their folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'workspace' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Users replace workspace files in their folder" on storage.objects for update to authenticated
  using (bucket_id = 'workspace' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Users delete workspace files in their folder" on storage.objects for delete to authenticated
  using (bucket_id = 'workspace' and (storage.foldername(name))[1] = (select auth.uid())::text);
