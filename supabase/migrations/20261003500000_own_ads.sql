-- Our own ads next to competitors': Research has a "Competitors' ads | Our ads" switch. An ad (and a
-- watchlist Page) is ours when the import or the watchlist entry says so; everything else about it
-- works the same (cards, filters, Jev decode, AI scan, Recreate, the format library).

alter table public.paid_ads add column is_own boolean not null default false;
alter table public.ad_watchlist add column is_own boolean not null default false;

create index paid_ads_product_side_idx on public.paid_ads (product_id, is_own);

comment on column public.paid_ads.is_own is 'True for the product''s own ads (imported as "Our ads"), shown under Research → Our ads.';
comment on column public.ad_watchlist.is_own is 'True for the product''s own Facebook Page(s); their ads are saved as ours.';
