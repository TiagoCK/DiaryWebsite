# My Diary

A personal diary web app for reading handwritten scans as a book. Next.js (App Router), plain JavaScript.

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

## The scans

Scans live in `images/` and are **gitignored** — diary content never enters git
history. They are served in development by `src/app/api/scan/[file]/route.js`,
which streams from disk and checks each request against the manifest allowlist
in `src/lib/pages.js`.

Two things about these files are easy to get wrong:

- **They carry EXIF orientation 6 or 8**, so their stored JPEG dimensions are
  portrait while they *display* landscape. Browsers rotate automatically, but
  `sharp` does not unless you call `.rotate()`. Any dimension stored anywhere
  must be the display dimension.
- **Filenames are not a reliable sort key.** Both batches end in digits, so
  sorting on the trailing number alone interleaves them, and a lexicographic
  sort puts `_10` before `_2`. Order comes from the explicit `pageId` field.

## The page model

A **view** is one frame of the open book:

- A spread (`pageCount: 2`) fills a view alone.
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
  api/scan/       serves scans from images/ (allowlisted)
src/components/
  BookViewer.js   client component; the page-flip and navigation
src/lib/
  pages.js        THE SEAM — page data, view assembly, image URLs
```

Imports can use the `@/` alias for anything under `src/`.

### The seam

`src/lib/pages.js` is the only module that knows where scans come from. It
exports `getPages()`, `buildViews()`, `getPageImageUrl()`, and `halfOf()`.
Swapping the local manifest for a Supabase `pages` table and signed Storage
URLs means rewriting two function bodies; the viewer is untouched.

## Notes

Secrets go in `.env.local`, which is gitignored — never commit database URLs or
API keys. Editor swap files (`.env.local.swp`) are ignored too, since they hold
the contents of whatever you were editing.

This app is not statically exported, so it needs a host that runs Node (Vercel,
or similar). That's deliberate: it keeps a database, authentication, and
server-side API routes possible. GitHub Pages serves static files only and
can't host it.
