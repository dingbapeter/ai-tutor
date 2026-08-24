-- Blind-spot sprint: web push, password reset. Mirrors schema.ts.
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamp not null default now()
);
create index if not exists push_user_idx on push_subscriptions(user_id);

create table if not exists password_resets (
  token_hash text primary key,
  user_id uuid not null references users(id),
  used boolean not null default false,
  created_at timestamp not null default now()
);
