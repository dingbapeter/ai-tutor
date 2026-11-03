-- Resume metadata: everything needed to pick a live session back up on a
-- fresh process, so a restart or a second API instance continues the
-- conversation instead of losing it.
alter table sessions add column if not exists persona_id text not null default 'amara';
alter table sessions add column if not exists language text not null default 'en';
alter table sessions add column if not exists plan text not null default 'free';
alter table sessions add column if not exists owner_user_id uuid;
alter table sessions add column if not exists parent_email text;
alter table sessions add column if not exists api_key_id uuid;
