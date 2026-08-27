import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/**
 * Supabase auth client bound to the request's cookies.
 *
 * Uses the anon key deliberately: this client exists to identify *who is asking*,
 * not to fetch data. Data access uses the service-role client in ./supabase.js.
 * Handing this one the service-role key would let a forged cookie read anything.
 */
export async function createAuthClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Components cannot set cookies. Harmless: the middleware
            // refreshes the session on every request, so the write that matters
            // has already happened there.
          }
        },
      },
    }
  );
}
