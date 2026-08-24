-- Show Dingba: camera_solve joins the metered usage kinds.
-- 0003 created the check inline, so Postgres named it usage_events_kind_check.
alter table usage_events drop constraint if exists usage_events_kind_check;
alter table usage_events add constraint usage_events_kind_check
  check (kind in ('message','voice_turn','tts_chars','practice','exam','api_call','camera_solve'));
