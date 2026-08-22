-- Sprint 6a: plans, orgs, API keys, usage metering. Mirrors schema.ts.
alter table users drop constraint if exists users_role_check;
alter table users add constraint users_role_check
  check (role in ('student','parent','teacher','admin'));
alter table users add column if not exists plan text not null default 'free';
alter table users add column if not exists org_id uuid;

create table if not exists orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_user_id uuid not null references users(id),
  seats integer not null default 30,
  plan text not null default 'premium',
  created_at timestamp not null default now()
);

alter table students add column if not exists org_id uuid references orgs(id);

create table if not exists api_keys (
  id uuid primary key default gen_random_uuid(),
  key_hash text not null unique,
  owner_user_id uuid not null references users(id),
  name text not null,
  scopes jsonb not null default '[]',
  monthly_quota integer not null default 10000,
  revoked boolean not null default false,
  created_at timestamp not null default now(),
  last_used_at timestamp
);

create table if not exists usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  student_id uuid,
  api_key_id uuid,
  kind text not null check (kind in ('message','voice_turn','tts_chars','practice','exam','api_call')),
  quantity integer not null default 1,
  created_at timestamp not null default now()
);
create index if not exists usage_user_idx on usage_events(user_id, kind, created_at);
create index if not exists usage_student_idx on usage_events(student_id, kind, created_at);
create index if not exists usage_key_idx on usage_events(api_key_id, created_at);
