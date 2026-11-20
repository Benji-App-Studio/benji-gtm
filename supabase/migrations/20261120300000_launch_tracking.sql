-- Launch tracking: every ad sent from the dashboard, followed from the competitor ad it was made from
-- to the studio creative to its numbers on Meta (studio/src/lib/launch/tracking.ts).
--
-- meta_ads gains two columns the Meta sync fills (supabase/functions/metrics/lineage.ts):
--   * creative_ref  the studio creative (public.creatives.id) the ad was made from, matched through
--                   Launch's drafts by ad id, or by Launch's ad name for ads made before drafts kept
--                   the id. Text, not a foreign key: a creative can be deleted while its ad runs on.
--   * delivery      Meta's delivery details for the ad: configured status, delivery issues, when it
--                   was created and its ad account ({ configured, issues: [{ summary, level }], created,
--                   account }).
--   * format_synced the format the sync last wrote into format_id. format_id (already there) is filled
--                   the same way; when it differs from format_synced someone set it by hand in Measure,
--                   and the sync keeps it. When they agree, a later correction of the draft still applies.
--
-- Additive and nullable: the sync saves ads without these columns until they exist, so the order of
-- deploying the function and applying this migration doesn't matter. No new table, so no new policy:
-- meta_ads keeps its owner-read policy and the restrictive "Install members only" one.

alter table public.meta_ads
  add column if not exists creative_ref text,
  add column if not exists delivery jsonb,
  add column if not exists format_synced text;

comment on column public.meta_ads.creative_ref is 'The studio creative (creatives.id) this ad was made from, matched through launch_drafts by the metrics sync.';
comment on column public.meta_ads.delivery is 'Meta delivery details: { configured, issues: [{ summary, level }], created, account } (read-only fields of the Ad).';
comment on column public.meta_ads.format_synced is 'The format the metrics sync last wrote into format_id; a different format_id was set by hand and is kept.';

-- The Ads view and the sync look drafts up by workspace and ad.
create index if not exists launch_drafts_product_ad_idx on public.launch_drafts (product_id, ad_id) where ad_id is not null;
create index if not exists meta_ads_creative_ref_idx on public.meta_ads (product_id, creative_ref) where creative_ref is not null;
