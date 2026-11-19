-- Row-level security follows the install's membership.
--
-- Every table so far only asks "is this row yours?". That was enough while anyone who signed up was
-- welcome. On an install with an owner it is not: an account that can still sign in but is not (or
-- no longer) a member of the install, such as someone the owner removed, could keep writing its own
-- rows straight through the database API. Some of those rows are work orders: a `creative_jobs` row
-- is picked up by the scheduled worker and generated with the owner's image keys, and files go into
-- the owner's storage. The edge functions already turn such an account away (_shared/auth.ts); this
-- makes the database and storage agree with them.
--
--   * install_allows()   true for the owner and the members of the install, and for everyone on a
--                        database with no install row (one set up before installs had owners).
--   * "Install members only"   a restrictive policy on every table with row-level security, and on
--                        storage.objects. Restrictive policies are ANDed with the existing ones, so a
--                        member sees exactly what they saw before and a non-member sees nothing.
--
-- The service role (the edge functions) and the scheduled jobs are not subject to row-level security
-- and are unaffected. A table added by a later migration must add the same policy
-- (scripts/provision-tests/install-rls.test.ts checks that).

-- MARK: Who the install lets in

-- Answers for the caller only (auth.uid()), so it tells an account nothing about anyone else.
-- Security definer: `install` and `install_members` are closed to the browser.
create function public.install_allows() returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when not exists (select 1 from public.install) then true
    else exists (select 1 from public.install i where i.owner_user_id = (select auth.uid()))
      or exists (select 1 from public.install_members m where m.user_id = (select auth.uid()))
  end;
$$;

revoke execute on function public.install_allows() from public, anon;
grant execute on function public.install_allows() to authenticated, service_role;

-- MARK: Tables

do $$
declare t record;
begin
  for t in
    select c.relname
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind = 'r'
       and c.relrowsecurity
       -- The install's own tables: closed to the browser already, and read by install_allows().
       and c.relname not in ('install', 'install_members', 'install_secrets_meta', 'install_migrations')
  loop
    execute format(
      'create policy "Install members only" on public.%I as restrictive for all to authenticated using ((select public.install_allows())) with check ((select public.install_allows()))',
      t.relname);
  end loop;
end
$$;

-- MARK: Storage

create policy "Install members only" on storage.objects as restrictive for all to authenticated
  using ((select public.install_allows())) with check ((select public.install_allows()));
