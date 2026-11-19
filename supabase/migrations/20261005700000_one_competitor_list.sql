-- One competitor list per product (IMPROVEMENT_PLAN B2). Competitors lived in four places: the product
-- form's products.known_competitors, the AI profile's products.insight->competitors, the picked
-- candidates of competitor projects (projects.candidates), and Research's ad_watchlist. QA, Formats,
-- Research and the Playground each merged their own subset.
--
-- The list is ad_watchlist (its rows that aren't the product's own Pages). It already has a name, the
-- Facebook Page and TikTok advertiser ids, a candidate link, RLS and the research function reading it,
-- so it gains three columns instead of a new table and a link between the two:
--   website  the competitor's site (from an analysis pick);
--   handles  social handles by platform, without "@" (from an analysis pick);
--   source   where the entry came from: research (Research or an ad import: the default, so the
--            research function's inserts need no change), product, profile or analysis.
-- `enabled` keeps its meaning, "follow: pull this competitor's ads". Entries added from the product,
-- the AI profile or an analysis start paused: on the list (QA and Formats check for them), nothing
-- pulled or paid for until someone follows them in Research. They carry their name as search terms,
-- as Research's own "add from an analysis" always did, so the existing source check holds.
--
-- Kept in step:
--   * products.known_competitors mirrors the list's names (trigger), so the edge functions and pages
--     that read the column (radar discovery, the insight prompt, the product page) see the same list.
--     The column is not dropped.
--   * picking a candidate in a competitor project adds it to the list; unpicking it removes the entry
--     again while it's bare (not followed, no Page, link or advertiser id). Trigger, so picks the radar
--     function makes (its preselection) count too, as they always did for QA and Formats.
--   * the product form and the AI profile's "Replace" write through the studio (lib/server/competitors.ts).
--
-- One competitor per name: public.competitor_key (trimmed, leading "@" dropped, spaces collapsed,
-- lower case) is the twin of competitorKey in studio/src/lib/competitors.ts; keep the two in step.
-- No unique index: the same brand may be followed on Meta and on TikTok (two rows, one competitor).

-- MARK: Columns

alter table public.ad_watchlist
  add column website text check (website is null or char_length(website) <= 300),
  add column handles jsonb not null default '{}'::jsonb check (jsonb_typeof(handles) = 'object'),
  add column source text not null default 'research' check (source in ('research', 'product', 'profile', 'analysis'));

comment on column public.ad_watchlist.source is 'Where the competitor came from: research (Research or an ad import), product (the product form), profile (the AI profile), analysis (a competitor project pick).';
comment on column public.ad_watchlist.enabled is 'Followed: Research pulls this entry''s ads. Entries added from the product, the AI profile or an analysis start paused.';

-- MARK: The name key

create function public.competitor_key(p_name text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select lower(regexp_replace(regexp_replace(btrim(coalesce(p_name, '')), '^@+', ''), '\s+', ' ', 'g'))
$$;

create index ad_watchlist_product_key_idx on public.ad_watchlist (product_id, public.competitor_key(name));

-- MARK: Adding to the list

-- Adds a competitor to a product's list unless one with the same name is there (then fills its empty
-- website, handles and candidate link). New entries are paused and searched by their name. Used by the
-- seed below and the projects trigger; the studio inserts through RLS instead.
create function public.competitors_add(p_product uuid, p_name text, p_source text, p_website text default null, p_handles jsonb default '{}'::jsonb, p_candidate text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid;
  v_name text := left(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'), 120);
  v_handles jsonb := case when jsonb_typeof(p_handles) = 'object' then p_handles else '{}'::jsonb end;
  v_site text := nullif(left(btrim(coalesce(p_website, '')), 300), '');
  v_twin uuid;
begin
  if public.competitor_key(v_name) = '' then return; end if;
  select p.user_id into v_owner from public.products p where p.id = p_product;
  if v_owner is null then return; end if;
  select w.id into v_twin from public.ad_watchlist w
   where w.product_id = p_product and not w.is_own and public.competitor_key(w.name) = public.competitor_key(v_name)
   order by w.created_at, w.id limit 1;
  if v_twin is not null then
    -- Fill what's empty; what the entry already has wins.
    update public.ad_watchlist w
       set website = coalesce(w.website, v_site), handles = v_handles || w.handles, candidate_id = coalesce(w.candidate_id, p_candidate)
     where w.id = v_twin
       and ((w.website is null and v_site is not null) or not (w.handles @> v_handles) or (w.candidate_id is null and p_candidate is not null));
    return;
  end if;
  insert into public.ad_watchlist (user_id, product_id, name, network, search_terms, website, handles, candidate_id, source, enabled)
  values (v_owner, p_product, v_name, 'meta', left(v_name, 100), v_site, v_handles, p_candidate, p_source, false);
end $$;

revoke execute on function public.competitors_add(uuid, text, text, text, jsonb, text) from public, anon, authenticated;

-- MARK: products.known_competitors mirrors the list

-- The list's names, one per key (its first spelling), oldest first; own Pages left out.
create function public.competitor_names(p_product uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(x.name order by x.created_at, x.id), '{}')
    from (select distinct on (public.competitor_key(w.name)) w.name, w.created_at, w.id
            from public.ad_watchlist w
           where w.product_id = p_product and not w.is_own and public.competitor_key(w.name) <> ''
           order by public.competitor_key(w.name), w.created_at, w.id) x
$$;

revoke execute on function public.competitor_names(uuid) from public, anon, authenticated;

create function public.ad_watchlist_mirror() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  pid uuid := coalesce(new.product_id, old.product_id);
  names text[] := public.competitor_names(pid);
begin
  update public.products p set known_competitors = names where p.id = pid and p.known_competitors is distinct from names;
  if tg_op = 'UPDATE' and old.product_id is distinct from new.product_id then
    names := public.competitor_names(old.product_id);
    update public.products p set known_competitors = names where p.id = old.product_id and p.known_competitors is distinct from names;
  end if;
  return null;
end $$;

create trigger ad_watchlist_mirror after insert or delete or update of name, is_own, product_id on public.ad_watchlist
  for each row execute function public.ad_watchlist_mirror();

-- MARK: Analysis picks join the list

-- A candidate newly picked (selected now, not before) in a competitor project of a product joins the
-- list; one unpicked (still in the project, no longer selected) leaves it while its entry is bare and
-- came from an analysis. Demo projects and projects without a product are left out.
create function public.projects_competitors_sync() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  c jsonb;
  before jsonb := case when tg_op = 'UPDATE' then coalesce(old.candidates, '[]'::jsonb) else '[]'::jsonb end;
  was boolean;
begin
  if new.product_id is null or new.type <> 'competitors' or new.demo or jsonb_typeof(new.candidates) <> 'array' then return null; end if;
  if jsonb_typeof(before) <> 'array' then before := '[]'::jsonb; end if;
  for c in select value from jsonb_array_elements(new.candidates) where jsonb_typeof(value) = 'object' loop
    select coalesce(bool_or(o.value->>'selected' = 'true'), false) into was
      from jsonb_array_elements(before) o where jsonb_typeof(o.value) = 'object' and o.value->>'id' = c->>'id';
    if c->>'selected' = 'true' and not was then
      perform public.competitors_add(new.product_id, c->>'name', 'analysis', c->>'website', coalesce(c->'handles', '{}'::jsonb), c->>'id');
    elsif coalesce(c->>'selected', 'false') <> 'true' and was then
      delete from public.ad_watchlist w
       where w.product_id = new.product_id and w.source = 'analysis' and w.candidate_id = c->>'id'
         and not w.is_own and not w.enabled and w.page_id is null and w.page_url is null and w.tiktok_advertiser_id is null;
    end if;
  end loop;
  return null;
end $$;

create trigger projects_competitors_sync after insert or update of candidates on public.projects
  for each row execute function public.projects_competitors_sync();

-- MARK: Seed the list from the other three places

-- Typed names first (so they keep the "product" source), then analysis picks (which add websites and
-- handles to names already there), then the AI profile's competitors. Products in creation order,
-- projects oldest first, names in their stored order.
do $$
declare
  r record;
begin
  for r in
    select p.id, n.name from public.products p, unnest(p.known_competitors) with ordinality n(name, i)
     order by p.created_at, p.id, n.i
  loop
    perform public.competitors_add(r.id, r.name, 'product');
  end loop;

  for r in
    select pr.product_id, c.value as candidate
      from public.projects pr,
           jsonb_array_elements(case when jsonb_typeof(pr.candidates) = 'array' then pr.candidates else '[]'::jsonb end) with ordinality c(value, i)
     where pr.product_id is not null and pr.type = 'competitors' and not pr.demo
       and jsonb_typeof(c.value) = 'object' and c.value->>'selected' = 'true'
     order by pr.created_at, pr.id, c.i
  loop
    perform public.competitors_add(r.product_id, r.candidate->>'name', 'analysis', r.candidate->>'website', coalesce(r.candidate->'handles', '{}'::jsonb), r.candidate->>'id');
  end loop;

  for r in
    select p.id, n.value #>> '{}' as name
      from public.products p,
           jsonb_array_elements(case when jsonb_typeof(p.insight->'competitors') = 'array' then p.insight->'competitors' else '[]'::jsonb end) with ordinality n(value, i)
     where jsonb_typeof(n.value) = 'string'
     order by p.created_at, p.id, n.i
  loop
    perform public.competitors_add(r.id, r.name, 'profile');
  end loop;
end $$;

-- Every product's column once from the list (also for products whose list didn't change, e.g. typed
-- names that differed only in case).
update public.products p set known_competitors = public.competitor_names(p.id)
 where p.known_competitors is distinct from public.competitor_names(p.id);
