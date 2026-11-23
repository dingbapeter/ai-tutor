-- Comp access grants: explicit, time-boxed free elevated use tied to a
-- monthly performance review. Being on staff never implies access; a grant
-- must be given, and it lapses if the review is not kept up.
create table if not exists access_grants (
  user_id uuid primary key references users(id),
  level text not null,
  reason text,
  granted_by uuid,
  granted_at timestamp not null default now(),
  expires_at timestamp,
  review_interval_days integer not null default 30,
  next_review_at timestamp,
  last_review_at timestamp,
  last_rating text,
  revoked_at timestamp
);

-- The performance-review trail behind those grants: who reviewed whom, the
-- rating, and the decision. An auditable HR record, kept even after a grant ends.
create table if not exists access_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  reviewed_by uuid,
  reviewed_at timestamp not null default now(),
  rating text not null,
  decision text not null,
  note text
);
create index if not exists access_reviews_user_idx on access_reviews(user_id, reviewed_at desc);
