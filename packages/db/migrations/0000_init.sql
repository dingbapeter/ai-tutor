-- Initial schema. Mirrors packages/db/src/schema.ts (drizzle).
create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  role text not null default 'student' check (role in ('student','parent','admin')),
  created_at timestamp not null default now()
);

create table if not exists students (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  parent_user_id uuid references users(id),
  display_name text not null,
  birth_year integer,
  locale text not null default 'en',
  persona_id text not null default 'amara',
  created_at timestamp not null default now()
);

create table if not exists skills (
  id text primary key,
  pack_id text not null,
  title text not null,
  description text,
  prerequisites jsonb not null default '[]'
);

create table if not exists mastery (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id),
  skill_id text not null references skills(id),
  level real not null default 0,
  attempts integer not null default 0,
  correct integer not null default 0,
  due_at timestamp,
  stability_days real not null default 1,
  updated_at timestamp not null default now(),
  unique (student_id, skill_id)
);

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id),
  pack_id text not null,
  started_at timestamp not null default now(),
  ended_at timestamp,
  recap jsonb
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id),
  role text not null check (role in ('user','assistant','system')),
  content text not null,
  audio_key text,
  created_at timestamp not null default now()
);
create index if not exists messages_session_idx on messages(session_id, created_at);

create table if not exists memories (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id),
  kind text not null check (kind in ('academic','personal','goal')),
  content text not null,
  active boolean not null default true,
  created_at timestamp not null default now()
);
create index if not exists memories_student_idx on memories(student_id) where active;
