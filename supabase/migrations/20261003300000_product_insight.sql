-- Product insight: the AI reads the links a product was onboarded with (its website and subpages, the
-- App Store / Google Play listing, anything else given) and writes an organized profile: what it is,
-- the problem and the customer, value, features, pricing, proof, the brand's colours and voice. The
-- `insight` edge function fills these columns in the background; "Replace with AI insight" copies the
-- profile over the fields the user typed (keeping them in `insight_backup` for Undo).

alter table public.products
  add column links text[] not null default '{}',
  add column insight jsonb,
  add column insight_status text check (insight_status in ('running', 'done', 'failed')),
  add column insight_message text,
  add column insight_started_at timestamptz,
  add column insight_at timestamptz,
  add column insight_applied_at timestamptz,
  add column insight_backup jsonb;

comment on column public.products.links is 'Extra links the AI reads: App Store / Google Play listings, other sites, docs. The website column is read too.';
comment on column public.products.insight is 'The AI product profile from the insight edge function (see studio/src/lib/product-insight.ts).';
comment on column public.products.insight_backup is 'What "Replace with AI insight" overwrote (product fields and brand_kit), for Undo.';
