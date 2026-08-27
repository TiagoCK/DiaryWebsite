import { createClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase client, authenticated with the service-role key.
 *
 * The service-role key bypasses row-level security, so it must never reach the
 * browser. Keeping it in a non-NEXT_PUBLIC_ variable is what enforces that:
 * Next.js only inlines NEXT_PUBLIC_-prefixed variables into client bundles, so
 * importing this module from a client component fails at build time rather
 * than silently shipping the key.
 */

let client = null;

export function getSupabase() {
  if (client) return client;

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY " +
        "in .env.local, or set DIARY_SOURCE=local to read scans from disk instead."
    );
  }

  assertPublicUrlMatches(url);

  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

/** Storage bucket holding the scans. Private: reachable only via signed URLs. */
export const BUCKET = "diary-scans";

/** How long a minted image URL stays valid. */
export const SIGNED_URL_TTL_SECONDS = 10 * 60;

/**
 * The server talks to Supabase via SUPABASE_URL; the browser signs in via
 * NEXT_PUBLIC_SUPABASE_URL. Nothing keeps them in step, and when they drift the
 * failure is silent and baffling: the server works perfectly while every login
 * is rejected, because sign-in is being attempted against a different project.
 *
 * That exact mismatch cost real debugging time here, so it is now an error.
 */
function assertPublicUrlMatches(serverUrl) {
  const publicUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (!publicUrl) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL is not set. The browser needs it to sign in."
    );
  }
  if (publicUrl !== serverUrl) {
    throw new Error(
      "SUPABASE_URL and NEXT_PUBLIC_SUPABASE_URL point at different Supabase " +
        "projects. Sign-in would fail against a project that has none of your " +
        "data. Make them identical in .env.local."
    );
  }
}
