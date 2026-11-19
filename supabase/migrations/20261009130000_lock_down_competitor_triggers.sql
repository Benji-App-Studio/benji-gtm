-- Trigger-only functions from one_competitor_list: nobody should call them over the API
-- (the security advisor flagged them as executable by anon and authenticated via /rest/v1/rpc).
revoke execute on function public.ad_watchlist_mirror() from public, anon, authenticated;
revoke execute on function public.projects_competitors_sync() from public, anon, authenticated;
