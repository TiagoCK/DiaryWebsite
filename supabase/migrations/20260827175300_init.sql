-- Diary pages: one row per scan.
--
-- A scan is either a single page or an open two-page spread, so page_id is the
-- FIRST physical page number the scan covers and page_count says how many it
-- spans. Ordering the diary is `order by diary_id, page_id`.
--
-- Run this in the Supabase SQL editor (Dashboard -> SQL Editor -> New query).

create table if not exists pages (
  diary_id     smallint    not null default 1,
  page_id      integer     not null,
  storage_key  text        not null unique,
  first_line   text,
  page_count   smallint    not null default 2,
  -- Display dimensions, with EXIF rotation already applied. Storing the raw
  -- JPEG dimensions instead would report every rotated spread as portrait.
  width        integer     not null,
  height       integer     not null,
  byte_size    integer,
  date_added   timestamptz not null default now(),

  primary key (diary_id, page_id),
  constraint pages_page_count_positive check (page_count >= 1),
  constraint pages_dimensions_positive check (width > 0 and height > 0)
);

create index if not exists pages_order_idx on pages (diary_id, page_id);

-- The single most important line in this file.
--
-- Supabase exposes every table over PostgREST authenticated with the anon key,
-- and that key is public by design -- it ships to browsers. With RLS off,
-- anyone holding it can read the whole diary index.
--
-- RLS on with NO policies denies all anon and authenticated access, while
-- service_role bypasses RLS entirely. That is the posture we want: every read
-- goes through the Next.js server, which holds the service-role key.
--
-- Do not add a policy here without deciding who it is for.
alter table pages enable row level security;
