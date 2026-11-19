-- Research → Ads: two flags on paid_ads.
--
-- is_video: the ad plays as a video, whatever Meta calls its format. `media_type` keeps Meta's format
-- (a carousel or dynamic ad stays "carousel" / "dco"), but one whose media are mostly videos is a
-- video ad to Research's "Video" filter, the AI scan and Recreate. The research function works it out
-- each time it saves an ad (isVideoAd in supabase/functions/radar/engine/adlibrary.ts: Meta says
-- "video", or it has a video and at least as many videos as images, counting the scraper's measured
-- creative when there is one, else the ad's own media). The studio's isVideoAd (lib/recreate.ts) is
-- the same rule. Existing rows are filled in here by that rule.
--
-- hidden: the user hid the ad from Research (the ad's DELETE route). The row stays, so its decode,
-- scan and library hand-off are kept, and a later pull or import doesn't bring it back: the research
-- function never writes this column.

alter table public.paid_ads add column if not exists is_video boolean not null default false;
alter table public.paid_ads add column if not exists hidden boolean not null default false;

comment on column public.paid_ads.is_video is 'True when the ad plays as a video: media_type is video, or it has a video and at least as many videos as images (a carousel or dynamic ad of videos). Set by the research function when the ad is saved.';
comment on column public.paid_ads.hidden is 'True when the user hid the ad from Research. Pulls and imports keep it; only the studio sets it.';

-- The backfill isn't an edit of the ads: leave updated_at alone.
alter table public.paid_ads disable trigger paid_ads_touch;

update public.paid_ads a
   set is_video = true
  from (
    select p.id
      from public.paid_ads p
      cross join lateral (
        select count(*) filter (where m ->> 'type' = 'video') as videos,
               count(*) filter (where m ->> 'type' = 'image') as images
          from jsonb_array_elements(
                 case
                   when jsonb_typeof(p.creative -> 'media') = 'array' and jsonb_array_length(p.creative -> 'media') > 0 then p.creative -> 'media'
                   when jsonb_typeof(p.media) = 'array' then p.media
                   else '[]'::jsonb
                 end) m
      ) c
     where p.media_type = 'video' or (c.videos > 0 and c.videos >= c.images)
  ) v
 where a.id = v.id and not a.is_video;

alter table public.paid_ads enable trigger paid_ads_touch;
