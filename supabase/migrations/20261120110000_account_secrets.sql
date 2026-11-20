-- Each account's own API keys (accounts mode, 20261120100000_platform_accounts.sql).
--
-- Kept in Vault under `acct:<user id>:<NAME>`, so an account's keys never share a name with another
-- account's or with the install-wide keys (bare names, which become the platform's keys in accounts mode).
-- The names an account may store are the install's (install_secret_allowed), without the desktop
-- runner's secret (the runner belongs to the platform). The edge functions read them through
-- account_secrets(p_user) (service role only, supabase/functions/_shared/tenant.ts); the Settings page
-- sees only what account_secrets_meta says (last 4 characters, when it was checked).
--
-- Also: ad_pulls.key_source, so a pull started on the platform's token (a staff account without its own)
-- is polled with that token later, and an account's pull only ever with the account's.

-- MARK: Meta

create table public.account_secrets_meta (
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  last4 text,
  set_at timestamptz not null default now(),
  verified_at timestamptz,
  status text not null default 'unverified' check (status in ('ok', 'failed', 'unverified')),
  message text,
  primary key (user_id, name)
);
alter table public.account_secrets_meta enable row level security;
-- No permissive policy: closed to the browser (the install function answers with key states).
create policy "Install members only" on public.account_secrets_meta as restrictive for all to authenticated
  using ((select public.install_allows())) with check ((select public.install_allows()));

-- MARK: Names

create or replace function public.account_secret_allowed(p_name text) returns boolean
language sql immutable set search_path = '' as $$
  select public.install_secret_allowed(p_name) and p_name <> 'CREATIVES_RUNNER_SECRET';
$$;

create or replace function public.account_vault_name(p_user uuid, p_name text) returns text
language sql immutable set search_path = '' as $$
  select 'acct:' || p_user::text || ':' || p_name;
$$;

-- MARK: Reading and writing

create or replace function public.account_put_secret(p_user uuid, p_name text, p_value text) returns void
language plpgsql security definer set search_path = '' as $$
declare existing uuid; clean text := btrim(p_value); vault_name text;
begin
  if p_user is null then raise exception 'No user'; end if;
  if not public.account_secret_allowed(p_name) then raise exception 'Unknown key name %', p_name; end if;
  if clean is null or clean = '' then raise exception 'The key is empty'; end if;
  vault_name := public.account_vault_name(p_user, p_name);
  select id into existing from vault.secrets where name = vault_name;
  if existing is null then
    perform vault.create_secret(clean, vault_name);
  else
    perform vault.update_secret(existing, clean);
  end if;
  insert into public.account_secrets_meta (user_id, name, last4, set_at, verified_at, status, message)
  values (p_user, p_name, right(clean, 4), now(), null, 'unverified', null)
  on conflict (user_id, name) do update
    set last4 = excluded.last4, set_at = excluded.set_at, verified_at = null, status = 'unverified', message = null;
end;
$$;

create or replace function public.account_delete_secret(p_user uuid, p_name text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_user is null then raise exception 'No user'; end if;
  if not public.account_secret_allowed(p_name) then raise exception 'Unknown key name %', p_name; end if;
  delete from vault.secrets where name = public.account_vault_name(p_user, p_name);
  delete from public.account_secrets_meta where user_id = p_user and name = p_name;
end;
$$;

create or replace function public.account_mark_secret(p_user uuid, p_name text, p_ok boolean, p_message text default null) returns void
language sql security definer set search_path = '' as $$
  update public.account_secrets_meta
     set status = case when p_ok then 'ok' else 'failed' end,
         verified_at = now(),
         message = left(p_message, 300)
   where user_id = p_user and name = p_name;
$$;

-- One account's keys, by their plain names. Never another account's, never the install-wide ones.
create or replace function public.account_secrets(p_user uuid) returns table (name text, value text)
language sql stable security definer set search_path = '' as $$
  select substr(s.name, length('acct:' || p_user::text || ':') + 1), s.decrypted_secret
    from vault.decrypted_secrets s
   where p_user is not null
     and left(s.name, length('acct:' || p_user::text || ':')) = 'acct:' || p_user::text || ':'
     and public.account_secret_allowed(substr(s.name, length('acct:' || p_user::text || ':') + 1));
$$;

-- MARK: Deleting a user removes their keys

create or replace function public.account_purge_secrets() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from vault.secrets where left(name, length('acct:' || old.id::text || ':')) = 'acct:' || old.id::text || ':';
  return old;
end;
$$;

drop trigger if exists account_purge_secrets on auth.users;
create trigger account_purge_secrets before delete on auth.users for each row execute function public.account_purge_secrets();

-- MARK: Which token a pull was started with

alter table public.ad_pulls add column if not exists key_source text check (key_source in ('account', 'platform'));

-- MARK: Grants (service role only)

revoke execute on function public.account_put_secret(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.account_delete_secret(uuid, text) from public, anon, authenticated;
revoke execute on function public.account_mark_secret(uuid, text, boolean, text) from public, anon, authenticated;
revoke execute on function public.account_secrets(uuid) from public, anon, authenticated;
revoke execute on function public.account_purge_secrets() from public, anon, authenticated;
grant execute on function public.account_put_secret(uuid, text, text) to service_role;
grant execute on function public.account_delete_secret(uuid, text) to service_role;
grant execute on function public.account_mark_secret(uuid, text, boolean, text) to service_role;
grant execute on function public.account_secrets(uuid) to service_role;
