-- The Vercel Sandbox compressor was removed (Nov 6 2026, user call): videos over the 50 MB upload limit are
-- simply not stored (the ad, its copy and its poster are). This undoes 20261106073110 / 20261106090000.
update public.paid_ad_media set status = 'failed', lease_until = null, error = 'Over the 50 MB upload limit: not stored (the ad and its poster are).' where status = 'compress';
drop function if exists public.research_media_compress_claim(uuid, integer, integer);
drop function if exists public.research_media_compress_claim(integer, integer);
drop function if exists public.research_media_compress_counts();
drop index if exists public.paid_ad_media_compress_idx;
alter table public.paid_ad_media drop constraint if exists paid_ad_media_status_check;
alter table public.paid_ad_media add constraint paid_ad_media_status_check check (status in ('queued', 'downloading', 'done', 'failed'));
-- research_media_enqueue is restored to its 20261003200000_ad_media.sql definition (applied as written there).
