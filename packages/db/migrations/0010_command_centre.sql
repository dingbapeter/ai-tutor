-- The Command Centre: staff, roles, and a permanent audit trail.
create table if not exists staff_members (
  user_id uuid primary key references users(id),
  role text not null check (role in ('owner','admin','finance','support','staff','investor')),
  title text,
  status text not null default 'active' check (status in ('active','suspended')),
  invited_by uuid,
  created_at timestamp not null default now(),
  last_seen_at timestamp
);

create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null,
  actor_email text not null,
  actor_role text not null,
  action text not null,
  target text,
  meta jsonb not null default '{}',
  ip text,
  created_at timestamp not null default now()
);
create index if not exists audit_actor_idx on audit_log(actor_user_id, created_at desc);
create index if not exists audit_action_idx on audit_log(action, created_at desc);
