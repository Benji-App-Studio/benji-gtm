-- Radar: users' products (from onboarding), their analysis projects, and every run of each project
-- with its full report. Every row belongs to one user; RLS lets users touch only their own rows.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  onboarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  kind text not null check (kind in ('saas', 'mobile_app', 'physical_product', 'clothing', 'food_beverage', 'restaurant', 'local_service', 'creator_education', 'other')),
  description text not null default '',
  website text,
  stage text check (stage in ('idea', 'pre_launch', 'launched', 'established')),
  audience text,
  price_tier text,
  sales_channel text,
  region text,
  socials jsonb not null default '{}'::jsonb,
  known_competitors text[] not null default '{}',
  answers jsonb not null default '{}'::jsonb,
  category text,
  category_label text,
  platform_scores jsonb,
  keywords text[] not null default '{}',
  is_primary boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  product_id uuid references public.products (id) on delete set null,
  type text not null check (type in ('competitors', 'account', 'campaign')),
  name text not null check (char_length(name) between 1 and 120),
  description text not null default '',
  settings jsonb not null default '{}'::jsonb,
  candidates jsonb not null default '[]'::jsonb,
  status text not null default 'review' check (status in ('draft', 'discovering', 'review', 'analyzing', 'ready', 'error')),
  message text,
  demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  status text not null default 'running' check (status in ('running', 'done', 'error')),
  phase text,
  message text,
  settings jsonb not null default '{}'::jsonb,
  competitors jsonb not null default '[]'::jsonb,
  posts integer,
  apify_usd numeric(10, 4) not null default 0,
  jev_tokens bigint not null default 0,
  report jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index products_user_id_idx on public.products (user_id);
create index projects_user_id_idx on public.projects (user_id, created_at desc);
create index projects_product_id_idx on public.projects (product_id);
create index runs_project_id_idx on public.runs (project_id, started_at desc);
create index runs_user_id_idx on public.runs (user_id);

create function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
create trigger products_touch before update on public.products for each row execute function public.touch_updated_at();
create trigger projects_touch before update on public.projects for each row execute function public.touch_updated_at();

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.projects enable row level security;
alter table public.runs enable row level security;

create policy "Users read their profile" on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy "Users update their profile" on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy "Users manage their products" on public.products for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users manage their projects" on public.projects for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id and (product_id is null or exists (
    select 1 from public.products p where p.id = product_id and p.user_id = (select auth.uid()))));
create policy "Users manage their runs" on public.runs for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id and exists (
    select 1 from public.projects p where p.id = project_id and p.user_id = (select auth.uid())));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('thumbs', 'thumbs', true, 2097152, array['image/jpeg', 'image/png', 'image/webp']);
create policy "Users upload thumbnails to their folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'thumbs' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Users replace thumbnails in their folder" on storage.objects for update to authenticated
  using (bucket_id = 'thumbs' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Users delete thumbnails in their folder" on storage.objects for delete to authenticated
  using (bucket_id = 'thumbs' and (storage.foldername(name))[1] = (select auth.uid())::text);
