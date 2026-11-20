-- The language each person chose (Settings › Language), so it follows them to another browser. The
-- page renders from the locale cookie; this is the saved copy. Additive and nullable: null means "not
-- chosen" (the browser's languages decide). Safe in install, legacy and accounts modes: profiles already
-- has row-level security ("Users read their profile" / "Users update their profile"), and this column
-- is covered by those policies.
alter table public.profiles add column if not exists locale text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_locale_known' and conrelid = 'public.profiles'::regclass) then
    alter table public.profiles add constraint profiles_locale_known check (locale is null or locale in ('en', 'zh-TW', 'ja', 'ko'));
  end if;
end $$;
