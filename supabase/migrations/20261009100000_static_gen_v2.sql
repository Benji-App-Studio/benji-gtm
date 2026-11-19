-- Static generation v2 (docs/STATIC_GEN_V2.md): the shared columns every workstream codes against.
-- - creatives: the Meta link description (where disclaimers go: "Results vary.", "AI-generated
--   imagery."), the A/B copy variants (A creator voice, B brand voice; each with primary text,
--   headline and description) and the awareness level (1 Unaware … 5 Most aware) of the batch it came
--   from;
-- - creative_batches: the awareness level the batch was asked for;
-- - product_assets: whether a pictured person consented to ads ('confirmed', 'unknown', 'not_given'),
--   whether they may be a minor, and a transparent cut-out of a product or packaging picture.
-- The review trigger (20261005310000_creatives_review_reset.sql) also resets QA and any decision when
-- the description or the copy variants change: QA reads them too.

alter table public.creatives
  add column if not exists description text check (char_length(description) <= 1000),
  add column if not exists copy_variants jsonb not null default '[]'::jsonb check (jsonb_typeof(copy_variants) = 'array'),
  add column if not exists awareness_level smallint check (awareness_level between 1 and 5);
comment on column public.creatives.description is 'Meta link description: disclaimers ("Results vary.", "AI-generated imagery.").';
comment on column public.creatives.copy_variants is 'A/B ad copy: [{label, voice: creator|brand, primary_text, headline, description}] (lib/creative-types.ts CopyVariant).';
comment on column public.creatives.awareness_level is 'Awareness level 1 (Unaware) … 5 (Most aware), from its batch.';

alter table public.creative_batches
  add column if not exists awareness_level smallint check (awareness_level between 1 and 5);
comment on column public.creative_batches.awareness_level is 'Awareness level 1 (Unaware) … 5 (Most aware) the batch was made for.';

alter table public.product_assets
  add column if not exists consent text not null default 'unknown' check (consent in ('confirmed', 'unknown', 'not_given')),
  add column if not exists possible_minor boolean not null default false,
  add column if not exists cutout_url text,
  add column if not exists cutout_path text;
comment on column public.product_assets.consent is 'A pictured person''s consent to appear in ads: confirmed, unknown or not_given.';
comment on column public.product_assets.possible_minor is 'The pictured person may be under 18: never used without a human check.';
comment on column public.product_assets.cutout_url is 'Transparent PNG of a product or packaging picture (public address).';
comment on column public.product_assets.cutout_path is 'Storage path of the cut-out.';

-- Same trigger as 20261005310000_creatives_review_reset.sql, with the description and the copy
-- variants among the words QA reads.
create or replace function public.creatives_review_stamp() returns trigger
language plpgsql set search_path = '' as $$
declare
  changed boolean := new.url is distinct from old.url or new.storage_path is distinct from old.storage_path
    or (new.copy->>'headline', new.copy->>'body', new.copy->>'author', new.copy->>'community', new.copy->>'hook')
       is distinct from (old.copy->>'headline', old.copy->>'body', old.copy->>'author', old.copy->>'community', old.copy->>'hook')
    or new.description is distinct from old.description
    or new.copy_variants is distinct from old.copy_variants;
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
