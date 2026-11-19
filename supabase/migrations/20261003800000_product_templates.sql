-- Playground template libraries, one per product (workspace). Nothing here is global: switching
-- product shows that product's library, empty for a new one. Two kinds:
-- - starter: one of the built-in Style Library formats (studio/src/lib/ad-styles.ts) added to this
--   product's library; free, ready at once, its images are the app's own /ad-styles files.
-- - custom: an ad image the person uploaded (public `workspace` bucket,
--   <user>/<product>/playground/templates/). The research function's `template-analyze` route reads it
--   with OpenAI vision (layout, on-image text slots, brands to keep out) into `analysis`; after the
--   person confirms the credits, Higgsfield remakes it as a clean, brand-neutral template on the
--   creative pipeline (creative_batches.settings.source = 'playground-template'), linked by batch_id.
-- Contract: studio/src/lib/playground-templates.ts. API: /api/playground/[productId]/templates.

create table public.product_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  kind text not null check (kind in ('starter', 'custom')),
  starter_id text,
  name text not null check (char_length(name) between 1 and 120),
  status text not null default 'analyzing' check (status in ('analyzing', 'analyzed', 'generating', 'ready', 'failed')),
  source_url text,
  source_path text,
  template_url text,
  template_path text,
  thumb_url text,
  analysis jsonb,
  batch_id uuid references public.creative_batches (id) on delete set null,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A starter is an AD_STYLES id and has no upload; a custom template is an upload and has no starter id.
  constraint product_templates_kind_shape check (
    (kind = 'starter' and starter_id is not null and source_url is null)
    or (kind = 'custom' and starter_id is null)
  )
);

-- Each starter at most once per product (the API's add-starter is idempotent through it).
create unique index product_templates_starter_idx on public.product_templates (product_id, starter_id) where starter_id is not null;
create index product_templates_product_idx on public.product_templates (product_id, created_at desc);
create index product_templates_batch_idx on public.product_templates (batch_id) where batch_id is not null;

create trigger product_templates_touch before update on public.product_templates for each row execute function public.touch_updated_at();

alter table public.product_templates enable row level security;

create policy "Users read their product templates" on public.product_templates for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Users add their product templates" on public.product_templates for insert to authenticated
  with check (user_id = (select auth.uid()) and exists (select 1 from public.products p where p.id = product_id and p.user_id = (select auth.uid())));
create policy "Users edit their product templates" on public.product_templates for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and exists (select 1 from public.products p where p.id = product_id and p.user_id = (select auth.uid())));
create policy "Users delete their product templates" on public.product_templates for delete to authenticated
  using (user_id = (select auth.uid()));

comment on table public.product_templates is 'A product''s own Playground template library: Style Library starters added to it and uploaded ads read by OpenAI and remade by Higgsfield as clean, brand-neutral templates. Never shared across products.';
comment on column public.product_templates.kind is 'starter (a Style Library format, lib/ad-styles.ts) or custom (an uploaded ad).';
comment on column public.product_templates.starter_id is 'For starters: the AD_STYLES id. Unique per product.';
comment on column public.product_templates.status is 'analyzing → analyzed (read, ready to remake) → generating (Higgsfield remake running) → ready; failed at either step (see error). Starters are ready at once.';
comment on column public.product_templates.source_url is 'Custom: the uploaded original (public workspace bucket link).';
comment on column public.product_templates.source_path is 'Custom: the original''s path in the workspace bucket (<user>/<product>/playground/templates/<uuid>.<ext>).';
comment on column public.product_templates.template_url is 'The clean template image: the starter''s /ad-styles file, or the remake''s creative once ready.';
comment on column public.product_templates.template_path is 'The remake''s path in the creatives bucket (owned by the creatives pipeline).';
comment on column public.product_templates.analysis is 'Custom: what the research function read (TemplateAnalysis in studio/src/lib/playground-templates.ts): name, tagline, layout, aspect, text fields, brands to keep out, product slot, people, group.';
comment on column public.product_templates.batch_id is 'The remake''s creative batch (settings.source = playground-template).';
comment on column public.product_templates.error is 'Why the analysis or the remake failed, in plain words.';
