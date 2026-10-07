-- Name your tutor: each student can give their chosen persona a name of
-- their own. The persona keeps its voice and teaching style; the name is
-- the student's. Null means the persona's default name.
alter table students add column if not exists tutor_name text;
