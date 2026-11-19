-- Edited ads: when a re-pull or re-import finds that a running ad's copy, headline, description, button,
-- link or media files changed (same Library ID), the research function keeps the version it replaced in
-- paid_ad_versions and stamps paid_ads.creative_changed_at. The Research page then flags "edited since
-- decoded" (decoded_at / scanned_at before the change) and shows what changed. Rows are written by the
-- edge function (service role); users read and delete their own.

alter table public.paid_ads add column if not exists creative_changed_at timestamptz;
comment on column public.paid_ads.creative_changed_at is 'When an import last found this ad''s copy, link or media changed (its earlier versions are in paid_ad_versions). Null: unchanged since first seen.';

create table public.paid_ad_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  paid_ad_id uuid not null references public.paid_ads (id) on delete cascade,
  -- Which parts the next version changed: body, headline, description, cta, link, media.
  changed text[] not null default '{}',
  body text not null default '',
  headline text not null default '',
  description text not null default '',
  cta text not null default '',
  link_url text,
  media jsonb not null default '[]'::jsonb,
  thumb text,
  -- When this version was first and last seen (first seen: the ad's first sighting or its previous change).
  seen_from timestamptz,
  seen_until timestamptz,
  replaced_at timestamptz not null default now()
);

create index paid_ad_versions_ad_idx on public.paid_ad_versions (paid_ad_id, replaced_at desc);
create index paid_ad_versions_product_idx on public.paid_ad_versions (product_id);

alter table public.paid_ad_versions enable row level security;

create policy "Users read their paid ad versions" on public.paid_ad_versions for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Users delete their paid ad versions" on public.paid_ad_versions for delete to authenticated
  using ((select auth.uid()) = user_id);

comment on table public.paid_ad_versions is 'Earlier versions of a paid ad that was edited while running (same Library ID): the copy, link and media it had before.';
