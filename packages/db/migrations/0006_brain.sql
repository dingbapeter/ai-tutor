-- The Dingba Brain: structured learner profile, one row per student.
create table if not exists learner_profiles (
  student_id uuid primary key references students(id),
  profile jsonb not null default '{}',
  updated_at timestamp not null default now()
);
