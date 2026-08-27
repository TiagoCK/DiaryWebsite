# My Diary

A personal diary web app. Next.js (App Router), plain JavaScript.

Currently a single page with a title — a proof of concept for the setup, not yet a working diary.

## Running it

Requires Node 20.9+ (developed on 26.4.0).

```bash
npm install
npm run dev
```

Then open http://localhost:3000.

Other commands:

- `npm run build` — production build
- `npm start` — serve the production build (run `build` first)

## Layout

```
src/app/          routes and UI (App Router)
  layout.js       root layout, page metadata
  page.js         the home page
  globals.css     global styles
```

Imports can use the `@/` alias for anything under `src/` — e.g. `import { db } from '@/lib/db'` instead of a chain of `../`.

As this grows, the conventional places for things:

```
src/app/api/      server-side route handlers (external API calls, secret keys)
src/components/   shared React components
src/lib/          database client, helpers
middleware.js     (repo root) request gating, once there's auth
```

## Notes

Secrets go in `.env.local`, which is gitignored — never commit database URLs or API keys.

This app is not statically exported, so it needs a host that runs Node (Vercel, or similar). That's deliberate: it keeps a database, authentication, and server-side API routes possible. GitHub Pages serves static files only and can't host it.
