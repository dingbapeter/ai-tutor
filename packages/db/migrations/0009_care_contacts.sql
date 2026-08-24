-- The care contact: one trusted person, offered as a one-tap call when the
-- safety layer sees real distress. Never dialed automatically.
create table if not exists care_contacts (
  student_id uuid primary key references students(id),
  name text not null,
  phone text not null,
  relationship text,
  updated_at timestamp not null default now()
);
