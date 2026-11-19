-- Research → Ads: imports from the local Meta Ad Library scraper (scripts/meta-ad-library, output
-- schema `radar.meta-ad-library/v1`). They arrive as source `meta_local`, with Meta's impressions
-- order for the scrape (rank 1 = most impressions in that Ad Library search) and the creative's
-- measured media (width, height, duration, aspect per media, card count, nearest Meta placement).

-- `paid_ads.source` had no check; ad_pulls had one without `meta_local`. Both now list every source.
alter table public.paid_ads drop constraint if exists paid_ads_source_check;
alter table public.paid_ads add constraint paid_ads_source_check
  check (source in ('meta_api', 'meta_apify', 'meta_mcp', 'meta_local', 'tiktok_library', 'tiktok_creative_center', 'tiktok_apify'));

alter table public.ad_pulls drop constraint if exists ad_pulls_source_check;
alter table public.ad_pulls add constraint ad_pulls_source_check
  check (source in ('meta_api', 'meta_apify', 'meta_mcp', 'meta_local', 'tiktok_library', 'tiktok_creative_center', 'tiktok_apify'));

-- Position in the scrape under Meta's default "total impressions" sort (1 = most). Only comparable
-- within one scrape of one advertiser.
alter table public.paid_ads add column if not exists impressions_rank integer check (impressions_rank is null or impressions_rank > 0);

-- The creative as measured by the scraper:
-- { card_count, nearest_placement, media: [{ type, url, thumbnail_url, width, height, duration_sec, aspect }] }
alter table public.paid_ads add column if not exists creative jsonb;
