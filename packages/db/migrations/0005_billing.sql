-- Sprint 6b: billing + email verification. Mirrors schema.ts.

alter table users add column if not exists email_verified boolean not null default false;

create table if not exists email_verifications (
  token_hash text primary key,
  user_id uuid not null references users(id),
  used boolean not null default false,
  created_at timestamp not null default now()
);

create table if not exists billing_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  provider text not null,
  customer_ref text not null,
  subscription_ref text not null,
  plan text not null,
  status text not null default 'active',
  created_at timestamp not null default now(),
  updated_at timestamp not null default now()
);
create index if not exists billing_customer_idx on billing_subscriptions(provider, customer_ref);
create index if not exists billing_user_idx on billing_subscriptions(user_id);
