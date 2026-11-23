-- The employment record behind a console account: who someone actually is,
-- how they are engaged, and who they report to.
alter table staff_members add column if not exists full_name text;
alter table staff_members add column if not exists employment_type text
  check (employment_type in ('employee','contractor','advisor','investor'));
-- Dates, not timestamps: a start date is a day, not a moment.
alter table staff_members add column if not exists start_date text;
alter table staff_members add column if not exists end_date text;
alter table staff_members add column if not exists manager_user_id uuid;
alter table staff_members add column if not exists location text;
alter table staff_members add column if not exists notes text;

create index if not exists staff_manager_idx on staff_members(manager_user_id);
