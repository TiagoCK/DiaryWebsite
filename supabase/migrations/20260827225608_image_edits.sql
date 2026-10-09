-- Image editing: rotation and cropping, applied from a preserved original.
--
-- Rotate and crop are geometric, so nothing is lost by keeping the scan as it
-- was uploaded and re-deriving from it: exactly one re-encode ever, and a crop
-- can later be widened again.
--
-- Redaction, when it arrives, must behave differently -- a censor bar whose
-- underlying pixels still exist is not a censor bar. Applying one will
-- re-baseline the original (the censored image becomes the new original and the
-- uncensored bytes are deleted) rather than sitting alongside it.
--
-- Safe to re-run.

alter table pages add column if not exists original_key   text;
alter table pages add column if not exists edit_rotation  smallint not null default 0;
alter table pages add column if not exists edit_crop      jsonb;
alter table pages add column if not exists updated_at     timestamptz;

-- add constraint has no IF NOT EXISTS, so guard it to keep this file re-runnable
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'pages_rotation_valid'
  ) then
    alter table pages add constraint pages_rotation_valid
      check (edit_rotation in (0, 90, 180, 270));
  end if;
end $$;
