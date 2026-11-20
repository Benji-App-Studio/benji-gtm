-- RevenueCat keys per project. A RevenueCat v2 secret key reads one project only, so an account with two
-- apps in two RevenueCat projects needs two keys: REVENUECAT_API_KEY_<PROJECT> (the project ID in capitals,
-- anything else as "_"), next to the account's default REVENUECAT_API_KEY. The app's own key wins
-- (metrics/index.ts revenueCatKey). Same shape as the per-app AppStack keys.
--
-- Every name the operating dashboard migration allowed, plus per-project RevenueCat keys.
-- account_secret_allowed calls this function, so accounts mode accepts them too.
create or replace function public.install_secret_allowed(p_name text) returns boolean
language sql immutable set search_path = '' as $$
  select p_name in (
    'OPENAI_API_KEY', 'TYPESAFE_API_KEY', 'APIFY_TOKEN',
    'META_AD_LIBRARY_TOKEN', 'META_SYSTEM_USER_TOKEN', 'META_APP_SECRET',
    'REVENUECAT_API_KEY', 'APPSTACK_API_KEY', 'HIGGSFIELD_API_KEY',
    'GOOGLE_SERVICE_ACCOUNT_JSON', 'CREATIVES_RUNNER_SECRET',
    'TIKTOK_RESEARCH_CLIENT_KEY', 'TIKTOK_RESEARCH_CLIENT_SECRET',
    'MIXPANEL_SERVICE_ACCOUNT', 'SUPERWALL_API_KEY'
  ) or p_name ~ '^APPSTACK_API_KEY_[A-Za-z0-9_]{1,64}$'
    or p_name ~ '^REVENUECAT_API_KEY_[A-Za-z0-9_]{1,64}$';
$$;
