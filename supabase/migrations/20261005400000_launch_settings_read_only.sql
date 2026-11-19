-- Launch settings decide where the team's Meta token writes (ad account, Page, ad sets, budgets), so
-- users may only read their row. Every save goes through the `launch` edge function's /settings route,
-- which checks LAUNCH_ALLOWED_EMAILS and the workspace's owner, validates the form and writes with the
-- service role. Replaces the "for all" policy from 20261002600000_launch.sql.

drop policy "Users manage their launch settings" on public.launch_settings;

create policy "Users read their launch settings" on public.launch_settings for select to authenticated
  using ((select auth.uid()) = user_id);

revoke insert, update, delete on public.launch_settings from anon, authenticated;
