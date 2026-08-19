-- Sprint 4: accounts & auth. Mirrors packages/db/src/schema.ts.
alter table users add column if not exists password_hash text;
alter table users add column if not exists display_name text;

create table if not exists auth_tokens (
  token_hash text primary key,
  user_id uuid not null references users(id),
  created_at timestamp not null default now(),
  last_used_at timestamp not null default now()
);
create index if not exists auth_tokens_user_idx on auth_tokens(user_id);
