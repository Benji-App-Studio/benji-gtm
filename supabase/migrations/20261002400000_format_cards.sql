-- Format library: every winning post or paid ad Radar finds becomes a format card (hook pattern,
-- beat structure, pacing, CTA, evidence and examples) in a workspace (a product). The studio builds
-- and refreshes them from the workspace's run reports and paid-ad research; recreate prompts are
-- computed from a card and the brand kit, so they aren't stored.
--
-- Other tables point at a card with a nullable `format_id uuid references public.format_cards (id)
-- on delete set null` (Measure: which format a creative or ad used; Launch: what a draft was made
-- from). Cards are upserted on (product_id, key) and never deleted by a refresh, so those ids hold.

create table public.format_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  -- Cluster key: source | medium | format | hook type. One card per key per workspace.
  key text not null check (char_length(key) between 1 and 300),
  source text not null check (source in ('organic', 'paid')),
  medium text not null check (medium in ('video', 'text', 'image')),
  platform text not null,
  platforms text[] not null default '{}',
  format_type text not null,
  format_name text not null,
  family text not null,
  hook_type text,
  structure text[] not null default '{}',
  examples_count integer not null default 0,
  best_score integer not null default 0,
  rank integer not null default 0,
  -- The whole card (beats, evidence, examples, why it works) as the studio's FormatCard type.
  card jsonb not null,
  -- Archived cards stay referenceable but leave the library's grid.
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, key)
);

create index format_cards_product_idx on public.format_cards (product_id, rank desc);
create index format_cards_user_id_idx on public.format_cards (user_id);

create trigger format_cards_touch before update on public.format_cards for each row execute function public.touch_updated_at();

alter table public.format_cards enable row level security;

create policy "Users manage their format cards" on public.format_cards for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id and exists (
    select 1 from public.products p where p.id = product_id and p.user_id = (select auth.uid())));
