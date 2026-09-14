-- Make the tutor look like anyone: each student can set their tutor's skin
-- tone, hair style and hair colour. The persona keeps its voice, teaching
-- soul, name and clothing colour; only the appearance is the learner's.
-- Null on any column means the persona's default look.
alter table students add column if not exists look_skin text;
alter table students add column if not exists look_hair text;
alter table students add column if not exists look_hair_color text;
