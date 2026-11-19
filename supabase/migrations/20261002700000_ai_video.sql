-- AI video: Seedance 2.5 clips made on the Higgsfield API (no presenter, no Mac runner), next to the
-- Marketing Studio UGC videos the local runner makes.
alter table public.creative_jobs drop constraint creative_jobs_kind_check;
alter table public.creative_jobs add constraint creative_jobs_kind_check check (kind in ('ugc_video', 'ai_video', 'image', 'reddit', 'tweet'));
alter table public.creatives drop constraint creatives_style_check;
alter table public.creatives add constraint creatives_style_check check (style in ('ugc_video', 'ai_video', 'image', 'reddit', 'tweet'));
