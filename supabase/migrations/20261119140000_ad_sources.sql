-- Research collects competitors' ads from more places: Google's Ads Transparency Center (search,
-- YouTube, Shopping, Maps and Play ads) through Apify, and TikTok's Ad Library through Apify. Which
-- sources run is chosen in Settings > Research sources (install.settings.research; no column needed).
--
--   paid_ads.network     gains 'google'.
--   paid_ads.source,
--   ad_pulls.source      gain 'google_apify' (TikTok's library through Apify reuses 'tiktok_apify').
--   ad_watchlist         gains what each source finds a competitor by, next to the Facebook Page and
--                        TikTok business id it already has:
--                          google_advertiser_id  the advertiser id in Google's Transparency Center (AR…);
--                                                without one, Google ads are found by the competitor's
--                                                `website` (the column from 20261005700000), then its name;
--                          tiktok_business_name  the advertiser name TikTok's Ad Library shows, when it
--                                                differs from the competitor's name.

alter table public.paid_ads drop constraint if exists paid_ads_network_check;
alter table public.paid_ads add constraint paid_ads_network_check check (network in ('meta', 'tiktok', 'google'));

alter table public.paid_ads drop constraint if exists paid_ads_source_check;
alter table public.paid_ads add constraint paid_ads_source_check
  check (source in ('meta_api', 'meta_apify', 'meta_mcp', 'meta_local', 'tiktok_library', 'tiktok_creative_center', 'tiktok_apify', 'google_apify'));

alter table public.ad_pulls drop constraint if exists ad_pulls_source_check;
alter table public.ad_pulls add constraint ad_pulls_source_check
  check (source in ('meta_api', 'meta_apify', 'meta_mcp', 'meta_local', 'tiktok_library', 'tiktok_creative_center', 'tiktok_apify', 'google_apify'));

alter table public.ad_watchlist
  add column if not exists google_advertiser_id text check (google_advertiser_id is null or google_advertiser_id ~ '^AR[0-9]{10,30}$'),
  add column if not exists tiktok_business_name text check (tiktok_business_name is null or char_length(tiktok_business_name) between 1 and 120);

comment on column public.ad_watchlist.google_advertiser_id is 'The competitor''s advertiser id in Google''s Ads Transparency Center (AR…). Without one, Google ads are found by its website, then its name.';
comment on column public.ad_watchlist.tiktok_business_name is 'The advertiser name in TikTok''s Ad Library, when it differs from the competitor''s name.';
