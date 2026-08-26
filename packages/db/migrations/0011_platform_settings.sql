-- Operational switches the Command Centre flips without a deploy.
create table if not exists platform_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid,
  updated_at timestamp not null default now()
);
