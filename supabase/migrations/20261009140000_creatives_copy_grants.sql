-- Static generation v2 added creatives.description and creatives.copy_variants (20261009100000) but not
-- to the columns a signed-in person may update (20261002500000_creative_studio.sql grants a column list).
-- "Write copy" (POST /api/studio/creatives/[id]/copy) and picking a copy variant or editing the
-- description (PATCH /api/studio/creatives/[id]) update them as the user, so both failed with
-- "permission denied for table creatives". RLS still limits the rows to the user's own products; the
-- review-reset trigger still clears QA and approval when either changes.
grant update (description, copy_variants) on public.creatives to authenticated;
