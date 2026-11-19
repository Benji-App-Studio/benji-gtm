-- Product images: the pictures of what a product is and sells, for creatives. The user uploads them on
-- the Product page (app screens, product shots, packaging, lifestyle…); the `insight` function also
-- collects them from the product's website, subpages and store listing. The AI sorts them (kind,
-- group, label, what each is good for) and Recreate / Studio suggest them as references. Files live in
-- the public `workspace` bucket under <user>/<product>/assets/.

create table public.product_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  url text not null,
  storage_path text,
  source text not null default 'upload' check (source in ('upload', 'website', 'app_store', 'google_play')),
  source_url text,
  kind text not null default 'other' check (kind in ('app_screen', 'product', 'packaging', 'lifestyle', 'person', 'logo', 'other')),
  label text,
  description text,
  -- The AI's grouping: one product line, feature or screen set ("Tretalone", "Scan flow"…).
  group_name text,
  -- What it suits in an ad, as short tags ("hero product shot", "before/after", "app demo"…).
  good_for text[] not null default '{}',
  width integer,
  height integer,
  -- Set when the AI last sorted it; the user's own edits win (kind_locked).
  sorted_at timestamptz,
  kind_locked boolean not null default false,
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  unique (product_id, url)
);

create index product_assets_product_idx on public.product_assets (product_id, created_at desc);

alter table public.product_assets enable row level security;

create policy "Users read their product images" on public.product_assets for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Users add their product images" on public.product_assets for insert to authenticated
  with check (user_id = (select auth.uid()) and exists (select 1 from public.products p where p.id = product_id and p.user_id = (select auth.uid())));
create policy "Users edit their product images" on public.product_assets for update to authenticated
  using (user_id = (select auth.uid()));
create policy "Users delete their product images" on public.product_assets for delete to authenticated
  using (user_id = (select auth.uid()));

comment on table public.product_assets is 'Product images (uploaded, or collected by the insight function from the website and store listing), sorted by the AI and suggested as creative references.';
