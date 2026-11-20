-- Small per-account choices the app remembers across browsers and sign-outs (sign-out clears the
-- browser's storage): a closed getting-started guide per app ("guide.<app id>": "closed"), a closed
-- first-visit explainer per page ("explain.<page>": "closed"), and the app the three-step first run
-- created ("onboarding.draft": "<app id>"), so that run picks up where it stopped.
-- (studio/src/lib/ui-state.ts says which keys exist; the studio's /api/account/ui-state writes them.)
--
-- Additive, with a default: nothing changes for existing rows, and the studio keeps working before it
-- runs (it falls back to the browser's storage). No new table, so no new policy: profiles keeps its
-- own-row read and update policies in every mode (install, legacy and accounts).

alter table public.profiles
  add column if not exists ui_state jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_ui_state_object' and conrelid = 'public.profiles'::regclass) then
    alter table public.profiles add constraint profiles_ui_state_object
      check (jsonb_typeof(ui_state) = 'object' and pg_column_size(ui_state) <= 16384);
  end if;
end $$;

comment on column public.profiles.ui_state is 'Per-account UI choices: closed guides and explainers, the first run''s app (studio/src/lib/ui-state.ts).';
