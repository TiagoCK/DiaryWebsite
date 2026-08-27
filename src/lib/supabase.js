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

  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

/** Storage bucket holding the scans. Private: reachable only via signed URLs. */
export const BUCKET = "diary-scans";

/** How long a minted image URL stays valid. */
export const SIGNED_URL_TTL_SECONDS = 60 * 60;
