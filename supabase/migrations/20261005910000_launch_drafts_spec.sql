-- "Send to Meta": drafts made from the sheet carry their own spec (the format, the shared copy, the Page
-- and Instagram account, the AI disclosure, and every piece of media with its upload state), and may go
-- to any ad set in the workspace's ad account, not only the testing one. Testing drafts keep spec null.
-- The launch function writes it (service role); users still only read their drafts.
alter table public.launch_drafts add column if not exists spec jsonb;

comment on column public.launch_drafts.spec is
  'Send to Meta sheet: { objective, format: single|carousel|placements, copy, media[] } (supabase/functions/launch/pipeline.ts DraftSpec). Null for testing-ad-set drafts.';
