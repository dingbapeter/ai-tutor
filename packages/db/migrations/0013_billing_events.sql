-- The money ledger: every verified processor webhook, recorded before acted on.
create table if not exists billing_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_ref text not null,
  type text not null check (type in ('activated','canceled','payment_failed','refunded')),
  email text,
  customer_ref text,
  subscription_ref text,
  plan text,
  amount_minor integer,
  currency text,
  matched boolean not null default false,
  created_at timestamp not null default now()
);
-- Processors retry webhooks; the same event must land exactly once.
create unique index if not exists billing_events_ref_idx on billing_events(provider, event_ref);
create index if not exists billing_events_time_idx on billing_events(created_at desc);
