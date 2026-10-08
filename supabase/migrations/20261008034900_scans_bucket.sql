-- The private bucket the scans live in.
--
-- Until now this existed only as a side effect. An early version of the upload
-- script created it with an ensureBucket() that also refused to run against a
-- public bucket; scripts/add-pages.mjs replaced that script and dropped the
-- check, so nothing in this repository created the bucket any more. The project
-- could not be rebuilt from its own source, and nobody would have found out
-- until they tried.
--
-- Declaring it here is what makes `supabase db reset` produce a database the
-- app can actually serve images from.
--
-- `do update set public = false` rather than `do nothing`: where the bucket
-- already exists this is a no-op, but where it was ever made public it corrects
-- it. The whole image path depends on objects being unreachable except through
-- short-lived signed URLs minted server-side -- see src/lib/supabase.js.
--
-- No policy on storage.objects, deliberately, and for the same reason as the
-- pages table: Supabase enables RLS on it with none, which denies anon and
-- authenticated outright while the secret key bypasses it. Every image request
-- goes through the Next.js server.

insert into storage.buckets (id, name, public)
values ('diary-scans', 'diary-scans', false)
on conflict (id) do update set public = false;
