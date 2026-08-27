import { redirect } from "next/navigation";
import { createAuthClient } from "./supabase-server";
import { getSupabase } from "./supabase";

/**
 * The signed-in user and their role, or null.
 *
 * Deliberately getUser() and not getSession(). getSession() decodes whatever is
 * in the cookie and hands it back without checking it; getUser() revalidates the
 * token against the auth server. Every authorization decision below rests on
 * this, so it has to be the checked one.
 */
export async function getCurrentUser() {
  const supabase = await createAuthClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) return null;

  const role = await ensureProfile(user);

  return {
    id: user.id,
    email: user.email,
    role,
    isAdmin: role === "admin",
  };
}

/**
 * Read a user's role, creating the profile row if it is missing.
 *
 * Supabase does not let us install a trigger on auth.users, so nothing creates
 * profile rows automatically when you add someone in the dashboard. Instead the
 * row is created the first time we see the user. The insert ignores conflicts,
 * so concurrent requests race harmlessly.
 *
 * A missing or unreadable profile always resolves to 'reader' -- the least
 * privilege -- never to admin.
 */
async function ensureProfile(user) {
  const db = getSupabase();

  const { data: existing } = await db
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (existing) return existing.role;

  const { data: created } = await db
    .from("profiles")
    .upsert({ id: user.id, email: user.email }, { onConflict: "id", ignoreDuplicates: true })
    .select("role")
    .maybeSingle();

  return created?.role ?? "reader";
}

/**
 * Require a signed-in user, or redirect to the login page.
 *
 * Called directly by every protected page and route rather than relying on the
 * middleware, which is a convenience redirect and not the security boundary.
 */
export async function requireUser(returnTo) {
  const user = await getCurrentUser();
  if (!user) {
    const target = returnTo ? `/login?next=${encodeURIComponent(returnTo)}` : "/login";
    redirect(target);
  }
  return user;
}

/** Require an admin. Readers get sent back to the diary, not to a login loop. */
export async function requireAdmin() {
  const user = await requireUser("/admin");
  if (!user.isAdmin) redirect("/");
  return user;
}
