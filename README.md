# My Diary

A personal diary web app for reading handwritten scans as a book. Next.js (App
Router), plain JavaScript, Supabase for page data and image storage.

## Running it

Requires Node 20.9+ (developed on 26.4.0).

```bash
npm install
npm run dev
```

Then open http://localhost:3000. Arrow keys or the buttons turn pages.

Other commands:

- `npm run build` — production build
- `npm start` — serve the production build (run `build` first)
- `npm run upload -- --dry-run` — preview a scan upload
- `npm run upload -- --commit` — upload scans and seed the database

## Where the pages come from

`DIARY_SOURCE` in `.env.local` selects the backing store:

| Value | Page data | Images |
|---|---|---|
| `supabase` (default) | `pages` table | private Supabase Storage, via signed URLs |
| `local` | the manifest in `src/lib/pages.js` | `images/` on disk |

The switch is explicit rather than an automatic fallback. A Supabase free-tier
project pauses after about a week of inactivity, and silently serving stale
local data in that case would be more confusing than a loud failure. Set
`DIARY_SOURCE=local` to work offline or while the project is paused.

## First-time Supabase setup

1. **Run the migration.** Supabase dashboard → SQL Editor → New query. Paste
   `supabase/migrations/0001_init.sql` and run it. This creates the `pages`
   table and — importantly — enables row-level security on it.
2. **Set the keys** in `.env.local`: `SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY`.
3. **Upload the scans.** `npm run upload -- --dry-run` first to see the plan,
   then `npm run upload -- --commit`. The script creates the private
   `diary-scans` bucket if it doesn't exist, and refuses to run if the bucket
   exists but is public.

### Why row-level security matters here

Supabase exposes every table over PostgREST authenticated with the anon key, and
that key is public by design — it ships to browsers. With RLS off, anyone
holding it can read the whole diary index.

The migration enables RLS and writes **no policies**, which denies all anon and
authenticated access while `service_role` bypasses RLS entirely. Every read
therefore goes through the Next.js server, which holds the service-role key.
Don't add a policy without deciding who it's for.

The `diary-scans` bucket is private for the same reason: objects are reachable
only through short-lived signed URLs minted server-side.

## Filling in `first_line`

`first_line` is for searching later. Nothing populates it automatically — type
it in the Supabase dashboard → Table Editor → `pages`, sorted by `page_id`.

A spread row covers two pages, so use the first line of the **left** page and
stay consistent. Nothing depends on the column being filled, so it can be done
gradually.

## The scans

Scans live in `images/` and are **gitignored** — diary content never enters git
history. Keep them as your master copy; the upload script only reads them.

Two things about these files are easy to get wrong:

- **They carry EXIF orientation 6 or 8**, so their stored JPEG dimensions are
  portrait while they *display* landscape. Browsers rotate automatically, but
  `sharp` does not unless you call `.rotate()`. The upload script bakes the
  rotation into the uploaded bytes so nothing downstream has to care.
- **Filenames are not a reliable sort key.** Both batches end in digits, so
  sorting on the trailing number alone interleaves them, and a lexicographic
  sort puts `_10` before `_2`. Order comes from the explicit `page_id`.

## The page model

A **view** is one frame of the open book:

- A spread (`page_count: 2`) fills a view alone.
- Two consecutive single pages pair into one view, left and right.
- A trailing unpaired single sits on the left with a blank facing page.

So every view has a left half and a right half no matter what it is made of,
which is what lets the flip animation use one code path. `halfOf(view, side)`
returns either half of a spread (clipped) or a whole single page.

The current 14 scans yield 13 views covering pages 1–26.

## Layout

```
src/app/          routes and UI (App Router)
  page.js         server component; fetches metadata, renders the viewer
  layout.js       root layout, page metadata
  globals.css     global styles, including the 3D book
  api/scan/       serves a page's image (see below)
src/components/
  BookViewer.js   client component; the page-flip and navigation
src/lib/
  pages.js        THE SEAM — page data, view assembly, image URLs
  supabase.js     server-only client (service-role key)
scripts/
  upload.mjs      normalise, upload, and seed rows
supabase/migrations/
  0001_init.sql   schema, indexes, RLS
```

Imports can use the `@/` alias for anything under `src/`.

### The scan route

`/api/scan/<pageId>` is the indirection layer. In `local` mode it streams the
file from disk; in `supabase` mode it looks up the row, mints a signed Storage
URL, and redirects to it.

This is why `getPageImageUrl()` can stay synchronous. Signed URLs are async and
expire, so returning one directly would make view assembly async and push
changes up into the viewer. Routing through our own endpoint also means signed
URLs are minted only for pages someone actually opens, and no storage key ever
reaches the browser.

## Notes

Secrets go in `.env.local`, which is gitignored — never commit the service-role
key. It bypasses RLS, so it must stay server-side and must never gain a
`NEXT_PUBLIC_` prefix. Editor swap files (`.env.local.swp`) are ignored too,
since they hold the contents of whatever you were editing.

This app is not statically exported, so it needs a host that runs Node (Vercel,
or similar). GitHub Pages serves static files only and can't host it.
