-- Sprint 5: safety incident log. Mirrors packages/db/src/schema.ts.
create table if not exists safety_incidents (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id),
  session_id uuid,
  direction text not null check (direction in ('student','tutor')),
  categories jsonb not null default '[]',
  severity text not null check (severity in ('concern','danger')),
  excerpt text not null,
  created_at timestamp not null default now()
);
create index if not exists safety_incidents_student_idx on safety_incidents(student_id, created_at desc);
