-- Redaction: black bars covering areas of a scan.
--
-- The stored original stays PRISTINE and uncensored, so an admin can still see
-- what a bar covers. Bars are data, not a permanent burn.
--
-- They have to be data. The published image is regenerated from the original
-- every time rotation or cropping changes, so a bar merely burned into the
-- published bytes would vanish -- silently republishing the uncensored scan --
-- the next time the page was rotated or cropped. Instead the publish pipeline
-- is crop(rotate(bars(original))): bars are applied to the original first, so
-- they travel with the content through any later geometry change.
--
-- Coordinates are percentages of the ORIGINAL image, before rotation and crop,
-- which is the only space that stays stable when the geometry changes.
--
-- What this protects against: readers. /api/scan serves only the censored
-- published image and has no code path to originals/, and the single endpoint
-- that does serve originals requires an admin. What it does NOT protect
-- against: anyone who is an admin, or who holds the service-role key or
-- dashboard access. Censoring here means "hidden from readers", not "gone".
--
-- Safe to re-run.

alter table pages add column if not exists redaction_boxes jsonb;
alter table pages add column if not exists redacted_at     timestamptz;
