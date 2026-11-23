-- Voice familiarity: the tutor gets to know how a learner usually sounds,
-- so it can notice when they sound unlike themselves. Off by default,
-- switched on only by the account holder, never for a school roster.
--
-- What is kept is a handful of running averages (typical pitch, how much
-- it moves, loudness, speaking pace), a few numbers per learner. No audio,
-- no voiceprint, nothing that could pick a voice out of a crowd. Switching
-- it off clears them, and deleting the learner deletes them with the row.
alter table students add column if not exists voice_familiarity boolean not null default false;
alter table students add column if not exists voice_profile jsonb;
