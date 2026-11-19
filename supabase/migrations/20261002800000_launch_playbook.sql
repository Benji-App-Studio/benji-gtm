-- Launch: where a workspace is in the Meta ads playbook (account warm-up, attribution step). Optional
-- progress the Launch page shows and suggests from; nothing reads it to block a launch.
alter table public.launch_settings add column playbook jsonb not null default '{}'::jsonb;
