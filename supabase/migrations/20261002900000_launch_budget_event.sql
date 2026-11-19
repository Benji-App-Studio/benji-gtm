-- Launch setup options from the Meta ads playbook: scale with a campaign budget (CBO, default) or ad
-- set budgets, and optimise app ad sets for installs (default) or the trial / purchase app event.
alter table public.launch_settings
  add column scaling_budget text not null default 'campaign' check (scaling_budget in ('campaign', 'adset')),
  add column optimize_for text not null default 'install' check (optimize_for in ('install', 'trial', 'purchase'));
