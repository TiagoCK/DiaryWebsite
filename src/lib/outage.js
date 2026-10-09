/**
 * Telling "the database is unreachable" apart from "you are not allowed in".
 *
 * These two look identical at the call site and mean opposite things. Supabase
 * auth reports an unreachable project the same shape it reports a bad password:
 * no user, plus an error. Collapsing both to "no user" is how a paused project
 * came to redirect a perfectly valid session to the login page, which then told
 * the owner their password was wrong.
 *
 * On the free plan a project pauses after about a week of inactivity, and every
 * surface -- Postgres, auth, storage -- answers HTTP 540 at once. A paused
 * project cannot be woken by a request; it is restored by hand in the
 * dashboard. So the only thing the app can do about it is say so clearly.
 *
 * Pure on purpose: no database import, no React, nothing server-only. The login
 * form is a client component and needs isOutage(), so anything this module
 * pulled in would land in the browser bundle.
 */

/**
 * Where an unreachable backing store sends a navigation.
 *
 * Lives here rather than in auth.js because src/proxy.js needs it too, and
 * importing auth.js there would drag in next/headers and the Supabase server
 * client for the sake of one string. (Under the old `middleware` convention it
 * was a hard requirement, since that ran on the Edge runtime; `proxy` runs on
 * nodejs, so it is now a matter of not pulling in a module graph rather than of
 * what the runtime permits.) This module is pure, so it is safe from anywhere.
 */
export const PAUSED_PATH = "/paused";

/**
 * Statuses that mean the request never reached a working database.
 *
 * 540 is Supabase's own code for a paused project. The gateway errors are here
 * because a project mid-restore answers those for a minute or two, and that is
 * the same outage from a reader's point of view.
 */
const UNREACHABLE_STATUSES = new Set([540, 502, 503, 504]);

/**
 * Transport-level failures, by message.
 *
 * Node's fetch reports a refused connection as a bare "fetch failed" and hides
 * the cause one level down, so the cause chain is walked below rather than just
 * the top-level message.
 */
const UNREACHABLE_MESSAGES =
  /fetch failed|failed to fetch|network ?error|\bload failed\b|socket hang up|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|UND_ERR/i;

/**
 * Auth error names that mean infrastructure, not credentials.
 *
 * AuthRetryableFetchError is the one supabase-js raises when it cannot reach
 * the auth server at all.
 *
 * AuthUnknownError is here for a subtler case, measured rather than guessed: a
 * paused project answers 540 with a plain-text body, supabase-js tries to parse
 * it as JSON, and the parse failure becomes an AuthUnknownError whose message is
 * "Unexpected token 'P'..." with the HTTP status discarded. Without this entry
 * a genuinely paused project still reported a wrong password -- the exact bug
 * this module exists to prevent. A real refusal is always an AuthApiError with
 * a parseable body, so it never lands here.
 */
const UNREACHABLE_AUTH_ERRORS = new Set(["AuthRetryableFetchError", "AuthUnknownError"]);

/**
 * A failure caused by the backing store being unreachable.
 *
 * Named so a throw can cross a module boundary and still be recognised without
 * re-inspecting the shape of whatever Supabase handed back.
 */
export class OutageError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "OutageError";
  }
}

/**
 * Is this error the backing store being unreachable, rather than a refusal?
 *
 * Deliberately conservative: anything it cannot positively identify as a
 * transport or availability failure is treated as a real error. A wrong
 * password misreported as an outage would tell someone to wait for a problem
 * that is never going to clear.
 *
 * `status` is separate because postgrest-js does not put it on the error. A
 * paused project yields the error `{ message: "Project is paused" }` and
 * nothing else, while the 540 sits on the *response* -- so a data-access caller
 * has to hand it over or the outage is invisible from the error alone.
 */
export function isOutage(error, status) {
  if (UNREACHABLE_STATUSES.has(Number(status))) return true;
  if (!error) return false;
  if (error instanceof OutageError) return true;

  for (const link of chain(error)) {
    if (UNREACHABLE_AUTH_ERRORS.has(link.name)) return true;
    if (UNREACHABLE_STATUSES.has(statusOf(link))) return true;
    if (UNREACHABLE_MESSAGES.test(text(link))) return true;
  }
  return false;
}

/**
 * Wrap a Supabase error for rethrowing, as an OutageError when it is one.
 *
 * Lets a data-access module keep its own message -- which says which read
 * failed -- while still letting callers upstream tell the two cases apart.
 */
export function outageOr(cause, message, status) {
  const Kind = isOutage(cause, status) ? OutageError : Error;
  return new Kind(message, { cause });
}

/** The error plus its causes, depth-limited so a cycle cannot hang a request. */
function* chain(error) {
  let link = error;
  for (let depth = 0; link && typeof link === "object" && depth < 5; depth += 1) {
    yield link;
    link = link.cause;
  }
}

/**
 * A numeric status from whichever field carries it.
 *
 * PostgrestError has no `status`; it carries `code`, a string. Postgres error
 * codes are five characters ("42501" for an RLS refusal), so a `code` that
 * parses to a three-digit HTTP status is unambiguously the HTTP one.
 */
function statusOf(error) {
  const candidates = [error.status, error.statusCode, error.code];
  for (const value of candidates) {
    const status = Number(value);
    if (Number.isInteger(status) && status >= 100 && status <= 599) return status;
  }
  return 0;
}

/** Everything on this link worth matching a message against. */
function text(error) {
  return [error.message, error.details, error.code, error.errno].filter(Boolean).join(" ");
}
