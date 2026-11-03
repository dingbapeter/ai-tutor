-- Face hints: whether a learner may let their tutor see their face. Off by
-- default, switched on only by the account holder (the parent, or the adult
-- learner themselves). The camera is read on the learner's own device and
-- only a one-word expression hint ever reaches the server; nothing about a
-- face is stored anywhere, so this flag is the whole of the data kept.
alter table students add column if not exists face_hints boolean not null default false;
