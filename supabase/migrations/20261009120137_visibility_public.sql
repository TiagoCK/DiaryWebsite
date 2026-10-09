-- Add a third visibility: a volume anyone may read, with no account at all.
--
-- The visibility migration left a note saying a public tier was "a one-line
-- addition once there is a public surface to honour it". This is that: the
-- shelf, the reader and the image route now serve a viewer who has no session,
-- and src/lib/diary-rules.js decides what such a viewer may see.
--
--   public   anyone at all
--   readers  anyone signed in
--   admins   admins only
--
-- The default stays 'readers'. Nothing becomes world-readable by omission.
--
-- Still NOT a policy. RLS on diaries stays on with none; 'public' is an
-- application-level decision the server makes while holding the secret key,
-- exactly as 'readers' and 'admins' already were. A reader with the publishable
-- key still sees nothing directly.
--
-- Safe to re-run.

do $$
begin
  if exists (
    select 1 from pg_constraint where conname = 'diaries_visibility_valid'
  ) then
    alter table diaries drop constraint diaries_visibility_valid;
  end if;

  alter table diaries add constraint diaries_visibility_valid
    check (visibility in ('public', 'readers', 'admins'));
end $$;
