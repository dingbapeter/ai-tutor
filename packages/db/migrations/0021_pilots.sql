-- School pilots: a before-and-after measurement of what learners gained.
--
-- A pilot belongs to a school. It freezes two matched tests (forms A and B)
-- at the moment it is made, enrols learners from the roster (optionally
-- split by chance into a tutored and a comparison group), and records each
-- learner's sitting of the starting and final test.
--
-- Deleting a school or a learner deletes their pilot rows with them, so
-- account deletion stays one clean sweep.
create table if not exists pilots (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  pack_id text not null,
  skill_ids jsonb not null default '[]'::jsonb,
  comparison boolean not null default false,
  -- baseline: the starting test is open. endline: the final test is open.
  -- closed: finished; nothing more can be sat.
  status text not null default 'baseline',
  -- The two tests, copied in full, so a later curriculum edit cannot change
  -- a test that has been sat.
  forms jsonb not null,
  created_at timestamp not null default now(),
  endline_opened_at timestamp,
  closed_at timestamp
);
create index if not exists pilots_org_idx on pilots (org_id);

create table if not exists pilot_members (
  pilot_id uuid not null references pilots(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  arm text not null default 'tutor',
  form_order text not null default 'AB',
  -- The learner's own test link. Random, and good for nothing but sitting
  -- this pilot's tests.
  code text not null unique,
  primary key (pilot_id, student_id)
);
create index if not exists pilot_members_student_idx on pilot_members (student_id);

create table if not exists pilot_attempts (
  id uuid primary key default gen_random_uuid(),
  pilot_id uuid not null references pilots(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  phase text not null,
  form text not null,
  started_at timestamp not null default now(),
  finished_at timestamp,
  -- item id -> { answer, correct }. correct is null while unmarked.
  answers jsonb not null default '{}'::jsonb,
  unique (pilot_id, student_id, phase)
);
