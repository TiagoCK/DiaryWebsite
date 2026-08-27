import { createBrowserClient } from "@supabase/ssr";

/**
 * Supabase client for the browser, authenticated with the public anon key.
 *
 * Its only job is signing in. It cannot read diary data: `pages` and `profiles`
 * both have RLS enabled with no policies, so the anon key sees nothing. All
 * actual data access happens server-side with the service-role key.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}
