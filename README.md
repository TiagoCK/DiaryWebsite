# My Diary

Reads a shelf of handwritten diary scans as a book — a real page-turn, two pages
to a spread — and gives its owner the tools to run the archive: upload scans or
whole PDFs, rotate and crop them, black out what should stay private, reorder
pages, and search what has been transcribed.

Next.js (App Router), plain JavaScript, Supabase for page rows, private image
storage and auth. No test framework, no ORM, no UI library.

**The content is private, so the app is not deployed publicly.** This repository
is the code only: scans, the manifest and every credential are gitignored, and
nothing in the history has ever contained diary content.

## The problem it actually solves

A scan is not a page. A photograph of an open notebook is *two* pages, and the
next photograph might be one. That single fact drives most of the design:

- **Page numbers are derived, not stored identity.** A scan occupies
  `page_count` consecutive numbers, so the diary is an ordered list of scans and
  the numbering falls out of it. Reordering is therefore a renumbering of
  everything, done in one SQL function so it cannot half-apply; deleting a page
  closes its gap the same way. A UI keyed on page numbers silently showed the
  wrong images, which is why every list is keyed on a content-derived id
  instead.
- **Redaction is data, not a burn.** Censor bars are stored as percentages of
  the *original* image and re-applied by the publish pipeline —
  `crop(rotate(bars(original)))`. Burning them into the published bytes would
  mean the next crop silently republished the uncensored scan. The pristine
  original is kept so an admin can still see what a bar covers, behind the one
  endpoint that requires an admin.
- **The database is closed by default.** RLS is on with **no policies**, which
  denies every anon and authenticated request; the app reads through the server
  with the service-role key. Supabase hands the anon key to browsers by design,
  so anything less would publish the diary index.

## Architecture

```
browser ──► Next.js server ──► Supabase Postgres   page rows, RLS-closed
                │
                └────────────► Supabase Storage    private bucket, signed URLs

/api/scan/<pageId>          the only image path a reader can reach
/api/admin/original/<id>    pristine, pre-redaction, admin-only
```

`src/lib/pages.js` is the seam: everything above it asks for pages, everything
below it decides whether they come from Postgres or from disk. Pure rules live
beside it — `views.js` (grouping scans into spreads), `ordering.js`
(renumbering), `search.js` (matching), `redaction.js` (box geometry) — with no
database or React imports, which is what makes them directly testable.

## Running it

Requires Node 22+ (developed on 26.4.0).

```bash
npm install
npm run dev
```

Then open http://localhost:3000. Arrow keys or the buttons turn pages.

Other commands:

- `npm test` — the suite (no database or scans needed; fixtures are generated)
- `npm run lint`
- `npm run build` — production build
- `npm start` — serve the production build (run `build` first)
- `npm run add` — preview adding new scans
- `npm run add -- --commit` — add them

## Tests

`node --test`, no framework. 110 assertions across six suites covering the
rules that are easy to get quietly wrong: dense renumbering, view grouping,
accent-insensitive matching, EXIF orientation, PDF page order, redaction
geometry and upload path safety.

Every fixture is **generated at run time** — images via sharp, including one
carrying EXIF orientation 6, and a hand-built three-page PDF whose ink rises per
page so ordering can be checked without reading text back. Nothing reads
`images/`, so the suite passes on a machine that has never seen the diary. CI
runs it on Node 22 and 24 with no credentials at all.

## Signing in

The diary is invite-only. Accounts exist **only** when you create them in
Supabase → Authentication → Users, where you also set the password. The app has
no sign-up form, no "create account" link, and no `signUp()` call anywhere.

**One dashboard setting is load-bearing:** Authentication → Sign In / Providers
→ Email → **"Allow new users to sign up" must be OFF**. The anon key ships to
every browser, so while that toggle is on, anyone holding it can call `signUp()`
and create an account no matter what the UI offers.

No email is ever sent — no confirmations, no password resets — which keeps
Supabase's rate-limited built-in SMTP out of the picture entirely. If you forget
a password, reset it in the dashboard.

### Roles

Every user has a row in `profiles` with a role, created automatically by a
trigger when you add them:

| Role | Can |
|---|---|
| `reader` (default) | Read the diary |
| `admin` | Read the diary, plus `/admin` to edit each page's `first_line` |

Promote someone from `/admin` → People, which lists every account from
Authentication → Users and lets you set a role even before their first sign-in.
You can also edit the `role` cell directly in Table Editor → `profiles`.

Note there is **no database trigger** creating profile rows. Supabase restricts
DDL on the `auth` schema, so `create trigger ... on auth.users` fails. Instead
the app creates a user's profile the first time it sees them
(`ensureProfile()` in `src/lib/auth.js`), defaulting to `reader`, and the admin
page can assign a role ahead of that.

An admin cannot change their own role — with a single admin that would lock the
role out of the app permanently, since nothing else can grant it.

### How access is enforced

Every read goes through the Next.js server using the service-role key, so the
**server** is the security boundary, not RLS. RLS is still on (with no policies)
for both `pages` and `profiles`, which is what makes it safe for the browser to
hold a Supabase client for the login form — the anon key can't read a row.

Two things in the code are deliberate and easy to undo by accident:

- **`getUser()`, never `getSession()`, on the server.** `getSession()` decodes
  the cookie and trusts it; `getUser()` revalidates against the auth server.
- **The middleware is not the security boundary.** It refreshes sessions and
  redirects politely. Every protected surface re-checks for itself —
  `src/app/page.js`, `src/app/admin/page.js`, the server action in
  `src/app/admin/actions.js` (server actions are publicly reachable endpoints,
  so guarding the form's page guards nothing), and above all
  `src/app/api/scan/[pageId]/route.js`, which serves the images.


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

1. **Run the migrations.** Supabase dashboard → SQL Editor → New query. Paste
   and run `supabase/migrations/0001_init.sql` (the `pages` table, with
   row-level security), then `0002_auth.sql` (the `profiles` table, the
   new-user trigger, and RLS on it).
2. **Set the keys** in `.env.local`: `SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY`.
3. **Add the scans.** See below.

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

## Adding pages from the app

**Admin → Upload**, or the Upload link in the banner. Takes one image, or a PDF
whose pages each become a diary page in order. Two steps, the same shape as the
script below: **Analyse** shows what the pages would be, **Add** writes them.

The middle step is not ceremony. `page_count` fixes the numbering of every page
added after it, and nothing in the app can change it once written — so the
single/spread guess is a dropdown you can correct first, and the page numbers
update as you do.

Both steps run `analyse()` from `src/lib/ingest.js`, which is the same function
the script uses. There is deliberately no second pipeline.

### What it stores

Pages are JPEG at up to 1600px wide, because these are photographs of paper —
the content PNG compresses worst. The 14 scans here average 150 KB, so the 1 GB
free tier holds roughly 6,800 pages; as PNG the same images would be ~13× larger
in both storage and egress. Nothing compounds the loss: `originals/` keeps the
pristine upload, so a later crop or rotation re-encodes once from that.

The file you pick is also written into `images/` as the full-resolution master,
and the manifest is regenerated, so `DIARY_SOURCE=local` keeps working. A PDF
contributes one PNG master per page. If `images/` is not writable — a deployment
rather than your own machine — that step is skipped and the result says so.

### PDFs

Rasterised locally with `pdfjs-dist` and `@napi-rs/canvas`. Nothing is sent to
Adobe or any other service: the diary only ever reaches your own Supabase.
(Adobe's PDF Services free tier is real — 500 document transactions a month —
but it would mean uploading private pages to a third party, needing credentials,
and depending on their uptime.)

Each page is rendered so its long edge lands near 1600px, computed per page
rather than at a fixed DPI, to PNG first — lossless, so `analyse()` still does
exactly one lossy encode. Limits: 100 MB per upload, 200 pages per PDF.

Two things worth knowing if you touch this code:

- The file is sent as the **raw request body**, not multipart. `request.formData()`
  refuses bodies over about 10 MB, which most scanned PDFs are.
- pdfjs wants `standardFontDataUrl` as a path with forward slashes and a
  trailing one. A `file://` URL breaks on any project folder with a space in its
  name — this one has two.

## Adding pages from the terminal

Drop scans into `images/incoming/`, then:

```bash
npm run add
```

That prints the plan and changes nothing. Check the **single/spread** column —
it decides the page numbering for everything added after it, and it is the one
value that is awkward to correct later. Then:

```bash
npm run add -- --commit
```

Each scan is uploaded, its row inserted, and the original moved into `images/`
alongside the rest. The emptied `incoming/` folder is the record of what has
been added, so re-running is safe.

Everything else is derived from the file: page numbers continue from the end of
the diary, dimensions are measured, EXIF rotation is baked in, and anything
wider than 1600px is downscaled. Order comes from a numeric-aware filename sort,
so `_10` lands after `_2` rather than before it.

If a scan is guessed wrong — an open spread that happens to be portrait, say —
override it:

```bash
npm run add -- --commit --single=odd-one.jpg
```

`first_line` stays empty; fill it in from `/admin/pages`.

The script also regenerates `src/lib/manifest.generated.json`, which is what
`DIARY_SOURCE=local` reads. That file is gitignored like `images/` itself —
both only exist on the machine holding the scans, so a fresh clone has neither.
Never edit it by hand.

## Filling in `first_line`

`first_line` is what search reads. Type it in from **Admin → Page index**, which
reports how many scans have one and can filter to the blank ones
(`/admin/pages?blank=1`) so the gaps can be worked through.

A spread row covers two pages, so use the first line of the **left** page and
stay consistent. Nothing depends on the column being filled, so it can be done
gradually — but a scan with no first line cannot be found by search.

## Search

Three surfaces, one rule. `src/lib/search.js` holds the matching, so they cannot
drift apart:

- **In the viewer** — filters the pages already in memory as you type; clicking
  a result turns to that page. No request.
- **`/search?q=`** — a plain GET form, so the URL is shareable and it works with
  JavaScript off. Results link to `/?page=N`, which opens the reader at that
  page.
- **Admin → Page index** — `?q=` over the same rule, plus coverage and the blank
  filter.

Terms are ANDed and matched as substrings, case- and accent-insensitively, so
`electrical student` finds *"electrical engi student"*. A blank query matches
nothing rather than everything.

`fold()` maps each character to exactly one folded character rather than running
`normalize("NFD")` over the whole string, because `highlight()` finds matches in
the folded text and slices the **original** at those offsets. NFD turns `é` into
two code points and would shift every offset after it, marking the wrong
letters.

Matching runs in the app, not in Postgres. `getPages()` already loads every
row's metadata on every render, so filtering 14 rows is free, and one rule beats
two that disagree — `ilike` folds case by its own collation and would not match
the filter running in the browser. **Past a few thousand scans**, move this to
`ilike` with a `pg_trgm` index and have the viewer's live filter call it.

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

The controls under the book carry a **Go to page** field. It takes any page
number and shows the view holding it, so an interior number resolves to its
frame — page 4 opens the spread at pages 3–4. That is deliberately unlike the
**Order** tab, which refuses an interior number: reordering has to know which
*scan* you mean, while reading only has to know which *frame*. Jumping to the
neighbouring view flips; anything further lands directly, since the leaf
animation turns exactly one view.

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
  fonts.js        which font files load (see Typography)
  supabase.js     server-only client (service-role key)
scripts/
  add-pages.mjs   append scans from images/incoming/
supabase/migrations/
  0001_init.sql   schema, indexes, RLS
```

Imports can use the `@/` alias for anything under `src/`.

### The scan route

`/api/scan/<pageId>` is the indirection layer. In `local` mode it streams the
file from disk; in `supabase` mode it looks up the row, mints a signed Storage
URL, and redirects to it.

### A page number is not an identity

Reordering rewrites every `page_id` but leaves the same *set* of numbers in
place — 1, 2, 3, 5, 7 … before and after. So anything keyed on the page number
sees no change at all and keeps showing the previous occupant of each slot.

Two things went wrong that way. Image URLs were versioned on `updated_at`, which
only the editor writes, so swapping two never-edited scans produced two
identical URLs and the browser never re-fetched. And React reused each list row
in place, which left `/admin/pages`' uncontrolled first-line box holding the
previous scan's text — pressing Save then wrote it onto the wrong scan.

The fix is `contentIdFor(storage_key)` in `src/lib/pages.js`: a short opaque
hash of the one value that never moves. It keys every page list, so React moves
a row (and its form state) along with its scan, and it goes into `?v=` so an
image URL changes whenever *what sits at that page number* changes. The storage
key itself still never reaches the browser.

This is why `getPageImageUrl()` can stay synchronous. Signed URLs are async and
expire, so returning one directly would make view assembly async and push
changes up into the viewer. Routing through our own endpoint also means signed
URLs are minted only for pages someone actually opens, and no storage key ever
reaches the browser.

## Typography

Two files, answering different questions.

**`src/app/globals.css`** — what each role is set in. Four tokens at the very
top of the file, and no rule anywhere else names a font directly:

| Token | Used for |
|---|---|
| `--font-body` | reading text, admin UI, every form control |
| `--font-display` | `h1`, `h2`, `h3`, the topbar title, diary titles |
| `--font-hand` | the transcribed first line under the current spread |
| `--font-mono` | `<code>` (diary slugs on the admin shelf) |

**`src/lib/fonts.js`** — which font *files* load. This has to be JavaScript
because `next/font` is a build-time transform: it downloads the face at build,
self-hosts it out of `.next/static/media`, and generates a metric-matched
fallback so nothing shifts when the real font arrives. Nothing is fetched from
Google at runtime, so opening a page sends no reader's IP to a third party.

`--font-hand-scale` compensates for script faces rendering visually smaller
than a serif at the same `font-size`. Every heading and the first-line caption
multiply by it, so retuning after a font swap is one number rather than a hunt
through 1900 lines.

### Swapping in your own handwriting

Making the font happens outside this repo. [Calligraphr](https://calligraphr.com)
is the practical tool: print a character template, fill it in, scan it, get a
TTF back.

Worth knowing before you spend an evening on it:

- Print the template at **100% scale**. "Fit to page" silently rescales it and
  takes the font's metrics with it.
- Use a fineliner, not a ballpoint. Variable line weight vectorises badly.
- Scan at **300 DPI**, grayscale.
- The free tier gives ~75 characters and one variant each. One month of Pro
  buys **multiple variants per character** with automatic contextual
  alternates, which is the difference between handwriting and a typeface that
  looks like handwriting — without it every `e` on the page is identical, which
  reads as fake immediately.

Then convert and subset in one step. Handwriting outlines are complex and a raw
TTF runs 200–400 KB:

```bash
pyftsubset handwriting.ttf --flavor=woff2 --layout-features="calt,liga,kern" --unicodes="U+0000-00FF,U+2018-201D,U+2026" --output-file=handwriting.woff2
```

Keep `--layout-features` if you paid for the variants — the default subsetter
drops `calt` and takes the alternates with it. For the same reason, avoid the
FontSquirrel web generator.

Drop the result at `src/fonts/handwriting.woff2` and change `fonts.js`:

```js
import localFont from "next/font/local";

const hand = localFont({
  src: "../fonts/handwriting.woff2",
  variable: "--font-hand-loaded",
  display: "swap",
});
```

Nothing else moves — every consumer goes through `--font-hand`, not through
the font's name. Retune `--font-hand-scale` and you are done.

One thing worth deciding before the repo goes public: **your handwriting as a
font file is arguably more identifying than the text being redacted.** It comes
from the same hand as the scans, it ships as a downloadable asset, and it
outlives the site.

## Notes

`SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_URL` must name the **same project**.
The server uses the first and the browser uses the second, and when they drift
the failure is silent and confusing: every server-side query works while every
sign-in is rejected, because logins go to a project that has none of your data.
`src/lib/supabase.js` now throws on a mismatch rather than letting it happen.

Secrets go in `.env.local`, which is gitignored — never commit the service-role
key. It bypasses RLS, so it must stay server-side and must never gain a
`NEXT_PUBLIC_` prefix. Editor swap files (`.env.local.swp`) are ignored too,
since they hold the contents of whatever you were editing.

This app is not statically exported, so it needs a host that runs Node (Vercel,
or similar). GitHub Pages serves static files only and can't host it.
