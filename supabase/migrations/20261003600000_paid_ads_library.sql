-- Extra Ad Library details per ad, read from Meta's response by the importer (see AdLibraryDetails in
-- supabase/functions/radar/engine/adlibrary.ts): the impressions bucket behind Meta's "Low impression
-- count" badge, partnership ads (branded content) and the account an ad ran from, the landing domain
-- and tracking tool, the CTA type, age gating and AI-made media.
alter table public.paid_ads add column library jsonb;
comment on column public.paid_ads.library is 'Extra Ad Library details read from Meta''s response: impressions bucket (low impression count), partnership / branded content, the account it ran from, landing domain and tracking tool, CTA type, age gating, AI-made media.';
