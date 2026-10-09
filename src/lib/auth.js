import { cache } from "react";
import { redirect } from "next/navigation";
import { createAuthClient } from "./supabase-server";
import { getSupabase } from "./supabase";
import { isOutage, outageOr, OutageError, PAUSED_PATH } from "./outage.js";

/**
 * Who is asking, and whether we could find out at all.
 *
 * Two different nulls live here. "No session" and "could not reach Supabase"
 * arrive in the same shape -- no user, plus an error -- and they mean opposite
 * things. One belongs at the login page; the other must never go there, because
 * a paused project would then present itself as a rejected password.
 *
 * Reported as state rather than thrown because the root layout calls this on
 * every request, including for the paused page itself. A throw here would take
 * down the one page whose whole job is to explain the outage.
 *
 * Wrapped in React's cache() so the root layout, the admin layout and the page
 * inside it don't each pay for a token revalidation plus a profile query -- it
 * runs once per request.
 *
 * Deliberately getUser() and not getSession(). getSession() decodes whatever is
 * in the cookie and hands it back without checking it; getUser() revalidates the
 * token against the auth server. Every authorization decision below rests on
 * this, so it has to be the checked one.
 */
export const getAuthState = cache(async function getAuthState() {
  const supabase = await createAuthClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error && isOutage(error)) return { user: null, outage: true };
  if (error || !user) return { user: null, outage: false };

  try {
    const role = await ensureProfile(user);
    return {
      user: { id: user.id, email: user.email, role, isAdmin: role === "admin" },
      outage: false,
    };
  } catch (profileError) {
    // A profile read that failed because the database is unreachable is the
    // same outage, found one query later. Anything else is a real fault and is
    // still raised -- see ensureProfile on why it refuses to guess a role.
    if (profileError instanceof OutageError) return { user: null, outage: true };
    throw profileError;
  }
});

/**
 * The signed-in user and their role, or null.
 *
 * Null covers both "not signed in" and "could not tell", which is the right
 * answer for a caller that only decides what to render. Anything making a
 * routing or authorization decision wants getAuthState(), so it can tell the
 * two apart.
 */
export async function getCurrentUser() {
  return (await getAuthState()).user;
}

/**
 * Read a user's role, creating the profile row if it is missing.
 *
 * Supabase does not let us install a trigger on auth.users, so nothing creates
 * profile rows automatically when you add someone in the dashboard. Instead the
 * row is created the first time we see the user.
 *
 * A read failure is raised rather than swallowed. Treating "I could not read
 * your role" as "you are a reader" silently demotes an admin on any transient
 * blip, and an invisible privilege change is worse than a visible error --
 * especially when the same default is what an attacker would want.
 *
 * A genuinely absent row still resolves to 'reader', the least privilege.
 */
async function ensureProfile(user) {
  const db = getSupabase();

  const read = () =>
    db.from("profiles").select("role").eq("id", user.id).maybeSingle();

  // `status` travels alongside: postgrest-js keeps the HTTP status on the
  // response, not the error, so a paused project is invisible without it.
  const { data: existing, error, status } = await read();
  if (error) throw outageOr(error, `Could not read your profile: ${error.message}`, status);
  if (existing) return existing.role;

  const { error: insertError, status: insertStatus } = await db
    .from("profiles")
    .upsert({ id: user.id, email: user.email }, { onConflict: "id", ignoreDuplicates: true });
  if (insertError)
    throw outageOr(
      insertError,
      `Could not create your profile: ${insertError.message}`,
      insertStatus
    );

  // Read back rather than trusting the upsert's return: ON CONFLICT DO NOTHING
  // yields no rows when another request created the row first, and inferring
  // "reader" from that empty result would ignore whatever role it actually has.
  const { data: created, error: rereadError, status: rereadStatus } = await read();
  if (rereadError)
    throw outageOr(
      rereadError,
      `Could not read your profile: ${rereadError.message}`,
      rereadStatus
    );

  return created?.role ?? "reader";
}

/**
 * Require a signed-in user, or redirect: to the paused page if the backing
 * store is unreachable, to the login page if there is simply no session.
 *
 * Called directly by every protected page and route rather than relying on the
 * middleware, which is a convenience redirect and not the security boundary.
 *
 * The outage branch is checked first and deliberately does not fall through to
 * the login page. Sending someone there would be an invitation to type a
 * password that cannot be verified, and the failure it produced told them the
 * password was wrong.
 */
export async function requireUser(returnTo) {
  const { user, outage } = await getAuthState();
  if (outage) redirect(PAUSED_PATH);
  if (!user) {
    const target = returnTo ? `/login?next=${encodeURIComponent(returnTo)}` : "/login";
    redirect(target);
  }
  return user;
}

/**
 * The viewer, who may be nobody.
 *
 * For pages a stranger may legitimately open: the shelf and the reader, now
 * that a volume can be marked `public`. Returns null for "not signed in" and
 * leaves it to canSee() to decide what that viewer may have.
 *
 * Why this is not just getCurrentUser(), which also returns user-or-null: the
 * outage. requireUser() redirects to /paused when the backing store is
 * unreachable, and a page that simply dropped it would instead sail past with a
 * null viewer and throw an OutageError out of the first data read -- turning the
 * paused page into a stack trace. This keeps that redirect and gives up only the
 * sign-in one.
 */
export async function getViewer() {
  const { user, outage } = await getAuthState();
  if (outage) redirect(PAUSED_PATH);
  return user;
}

/**
 * Require an admin. Readers get sent back to the diary, not to a login loop.
 *
 * No returnTo is passed. The middleware redirects signed-out visitors first and
 * already carries the real pathname in ?next=, so hardcoding one here only
 * managed to overwrite a correct deep link with "/admin".
 */
export async function requireAdmin() {
  const user = await requireUser();
  if (!user.isAdmin) redirect("/");
  return user;
}
