-- Learner routines: uploaded timetables/curricula, parsed to structure.
create table if not exists routines (
  student_id uuid primary key references students(id),
  routine jsonb not null default '{}',
  updated_at timestamp not null default now()
);
