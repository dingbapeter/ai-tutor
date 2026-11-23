-- Referral loop: who invited whom, and time-boxed plan boosts as thanks.
-- The boost is deliberately separate from users.plan (which billing owns):
-- the effective plan is computed at read time as the better of the two, so
-- a boost can never overwrite or outlive a paid subscription record.
alter table users add column if not exists referral_code text unique;
alter table users add column if not exists referred_by uuid references users(id);
alter table users add column if not exists referral_rewarded boolean not null default false;
alter table users add column if not exists plan_boost text;
alter table users add column if not exists plan_boost_until timestamp;
create index if not exists users_referred_by_idx on users(referred_by);
