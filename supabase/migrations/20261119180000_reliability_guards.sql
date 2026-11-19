-- Two guards from the self-hosting audit (Nov 19).
--
-- 1. Reading an ad (research decode) is tried at most three times, with a pause between tries, and
--    the last error is kept so the page can say "Couldn't read this ad: …". Before this, an ad the AI
--    failed on was claimed again every 15 minutes forever, each try paid.
--      decode_attempts  tries so far (a claim counts, so a try that stopped the worker counts too)
--      decode_error     why the last try failed, in plain words; null once it is read
--      decode_retry_at  the next try waits until then
--
-- 2. The owner is claimed in one statement that only one caller can win (two setup tabs used to be
--    able to make two owners): install_claim_owner takes a transaction-scoped advisory lock, inserts
--    the install row if there is none, keeps an owner already recorded, and adds the owner membership
--    only for the user who is the recorded owner. It answers the owner's id: the caller compares it
--    with its own user to know whether it won.

-- MARK: Ad decode attempts

alter table public.paid_ads
  add column if not exists decode_attempts integer not null default 0,
  add column if not exists decode_error text,
  add column if not exists decode_retry_at timestamptz;

-- MARK: Owner claim

create or replace function public.install_claim_owner(p_user uuid, p_settings jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare owner uuid;
begin
  if p_user is null then raise exception 'No user to make the owner'; end if;
  -- One claim at a time, for the length of this transaction.
  perform pg_advisory_xact_lock(hashtext('public.install_claim_owner'));
  insert into public.install (id, owner_user_id, settings)
    values (true, p_user, coalesce(p_settings, '{}'::jsonb))
    on conflict (id) do update
      set owner_user_id = coalesce(public.install.owner_user_id, excluded.owner_user_id),
          -- Settings saved earlier win over these defaults.
          settings = excluded.settings || public.install.settings
    returning owner_user_id into owner;
  if owner = p_user then
    insert into public.install_members (user_id, role) values (p_user, 'owner')
      on conflict (user_id) do update set role = 'owner';
  end if;
  return owner;
end;
$$;

revoke execute on function public.install_claim_owner(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.install_claim_owner(uuid, jsonb) to service_role;
