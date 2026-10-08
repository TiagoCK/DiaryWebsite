import { createBrowserClient } from "@supabase/ssr";

/**
 * Supabase client for the browser, authenticated with the publishable key.
 *
 * Its only job is signing in. It cannot read diary data: `pages` and `profiles`
 * both have RLS enabled with no policies, so the publishable key sees nothing.
 * All actual data access happens server-side with the secret key.
 *
 * The publishable key is meant to be shipped -- it carries the same low
 * privileges the anon key did, which is why NEXT_PUBLIC_ is correct here and
 * why the RLS-closed posture is what actually protects the diary. It maps to
 * the Postgres `anon` role, so the policies in supabase/migrations still apply
 * to it unchanged.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  );
}
