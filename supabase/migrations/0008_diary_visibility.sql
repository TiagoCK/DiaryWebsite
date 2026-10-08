-- Who may open a diary.
--
-- Until now every signed-in reader could open every volume, which is fine while
-- the only account is yours and becomes wrong the moment a second one exists --
-- or the moment one volume is meant to be shown and another kept back.
--
-- Two values, deliberately:
--
--   readers  anyone signed in (the existing behaviour, so nothing changes)
--   admins   admins only -- invisible to readers, and its images are refused
--
-- A third value for a genuinely public tier is a one-line addition once there
-- is a public surface to honour it. Adding it now would put a value in the
-- schema that no code path reads, which is worse than not having it.
--
-- Safe to re-run.

alter table diaries add column if not exists visibility text not null default 'readers';

-- add constraint has no IF NOT EXISTS, so guard it to keep this file re-runnable
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'diaries_visibility_valid'
  ) then
    alter table diaries add constraint diaries_visibility_valid
      check (visibility in ('readers', 'admins'));
  end if;
end $$;

-- This column is only ever read through the server, which holds the
-- service-role key and does the filtering itself. It is not a policy: RLS on
-- diaries stays closed with none, exactly as in 0007.
