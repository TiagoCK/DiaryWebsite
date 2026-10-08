import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isOutage, outageOr, OutageError } from "../src/lib/outage.js";

/**
 * Every shape below was captured from supabase-js by pointing it at a stub that
 * answers the way a paused project does, rather than written from imagination.
 * That matters: the first draft of this file invented a tidy
 * `{ code: "540" }` error, which no layer actually produces, and it passed
 * while the real paused-project cases all fell through as "wrong password".
 */

/**
 * A paused project, as the AUTH client reports it.
 *
 * Supabase answers 540 with a plain-text body, supabase-js tries to parse it as
 * JSON, and what survives is the parse failure -- the HTTP status is gone. This
 * is the single most important case in the file: it is what the owner of a
 * paused diary actually hits when they try to sign in.
 */
const AUTH_PAUSED = {
  name: "AuthUnknownError",
  message: "Unexpected token 'P', \"Project is paused\" is not valid JSON",
};

/** The same pause when the body happens to be JSON: here the status survives. */
const AUTH_PAUSED_JSON = { name: "AuthApiError", status: 540, message: "Project is paused" };

/** A project mid-restore, as the auth client reports it. */
const AUTH_MID_RESTORE = {
  name: "AuthRetryableFetchError",
  status: 503,
  message: "Service Unavailable",
};

/**
 * A paused project, as the DATA client reports it -- the whole error object.
 *
 * postgrest-js keeps the HTTP status on the *response* and throws it away when
 * building the error, so this is genuinely all there is. The 540 has to be
 * passed in alongside, which is why isOutage() takes a second argument.
 */
const REST_PAUSED = { message: "Project is paused" };

/** supabase-js, when a token check cannot reach the auth server. */
const AUTH_UNREACHABLE = {
  name: "AuthRetryableFetchError",
  status: 0,
  message: "Failed to fetch",
};

/** Node's fetch on a refused connection: bare message, real cause one level down. */
function refusedConnection() {
  const cause = new Error("connect ECONNREFUSED 127.0.0.1:9");
  cause.code = "ECONNREFUSED";
  return new TypeError("fetch failed", { cause });
}

/** postgrest-js flattens a transport failure into its own error shape. */
const POSTGREST_TRANSPORT = {
  message: "TypeError: fetch failed",
  details: "",
  hint: "",
  code: "",
};

/** A wrong password. The one case that must never read as an outage. */
const BAD_CREDENTIALS = {
  name: "AuthApiError",
  status: 400,
  code: "invalid_credentials",
  message: "Invalid login credentials",
};

/** RLS refusing a write. Closed by design, not broken. */
const RLS_DENIED = {
  code: "42501",
  message: 'new row violates row-level security policy for table "pages"',
  details: null,
  hint: null,
};

describe("outage: recognising an unreachable project", () => {
  it("knows a paused project from the auth client's JSON parse failure", () => {
    // Regression: this used to be false, so a paused project told the owner
    // their password was wrong.
    assert.equal(isOutage(AUTH_PAUSED), true);
  });

  it("knows a paused project when the status does survive", () => {
    assert.equal(isOutage(AUTH_PAUSED_JSON), true);
  });

  it("knows a project mid-restore", () => {
    assert.equal(isOutage(AUTH_MID_RESTORE), true);
  });

  it("knows an auth server it could not reach", () => {
    assert.equal(isOutage(AUTH_UNREACHABLE), true);
  });

  it("follows the cause chain to a refused connection", () => {
    assert.equal(isOutage(refusedConnection()), true);
  });

  it("recognises a transport failure flattened by postgrest", () => {
    assert.equal(isOutage(POSTGREST_TRANSPORT), true);
  });

  it("treats every gateway status as the same outage", () => {
    for (const status of [502, 503, 504]) {
      assert.equal(isOutage({ status, message: "Bad gateway" }), true, `status ${status}`);
    }
  });

  it("recognises its own error type", () => {
    assert.equal(isOutage(new OutageError("down")), true);
  });
});

describe("outage: the status the data client throws away", () => {
  /*
   * These four pin the reason isOutage() takes a second argument. Collapsing it
   * back to isOutage(error) would make a paused project undetectable on every
   * data read, silently, with the tests above still green.
   */
  it("cannot tell a paused project from its error alone", () => {
    assert.equal(isOutage(REST_PAUSED), false);
  });

  it("can tell once the response status is passed in", () => {
    assert.equal(isOutage(REST_PAUSED, 540), true);
  });

  it("accepts the status on its own, error or not", () => {
    assert.equal(isOutage(null, 540), true);
    assert.equal(isOutage(undefined, 503), true);
  });

  it("does not let a healthy status mask a real error", () => {
    assert.equal(isOutage(AUTH_PAUSED, 200), true);
    assert.equal(isOutage(BAD_CREDENTIALS, 200), false);
    assert.equal(isOutage({ message: "column does not exist" }, 400), false);
  });
});

describe("outage: refusals are not outages", () => {
  /*
   * These are the assertions that earn the module. Reporting either of the
   * first two as an outage would tell someone to wait for a problem that is
   * never going to clear on its own.
   */
  it("does not mistake a wrong password for an outage", () => {
    assert.equal(isOutage(BAD_CREDENTIALS), false);
  });

  it("does not mistake an RLS refusal for an outage", () => {
    assert.equal(isOutage(RLS_DENIED), false);
  });

  it("does not mistake an expired token for an outage", () => {
    assert.equal(isOutage({ code: "PGRST301", message: "JWT expired" }), false);
  });

  it("does not mistake schema drift for an outage", () => {
    assert.equal(
      isOutage({ code: "42703", message: 'column "visibility" does not exist' }),
      false
    );
  });

  it("leaves an ordinary application error alone", () => {
    assert.equal(isOutage(new Error("getPages needs a diary id.")), false);
  });

  /*
   * "Upload failed" contains the substring "load failed". The word boundary in
   * the pattern is what keeps an ingest failure from being reported as the
   * database being down, so it is pinned here.
   */
  it("does not read 'Upload failed' as a transport failure", () => {
    assert.equal(isOutage(new Error("Upload failed: staging is full")), false);
  });

  it("handles nothing at all", () => {
    assert.equal(isOutage(null), false);
    assert.equal(isOutage(undefined), false);
  });

  it("survives a cause that points at itself", () => {
    const looping = new Error("round and round");
    looping.cause = looping;
    assert.equal(isOutage(looping), false);
  });
});

describe("outage: outageOr", () => {
  it("returns an OutageError when the cause is one, keeping the message", () => {
    const wrapped = outageOr(AUTH_PAUSED, "Could not read pages from Supabase: paused");
    assert.ok(wrapped instanceof OutageError);
    assert.equal(wrapped.message, "Could not read pages from Supabase: paused");
    assert.equal(wrapped.cause, AUTH_PAUSED);
  });

  it("forwards the response status, which is the data path's only signal", () => {
    assert.ok(outageOr(REST_PAUSED, "paused", 540) instanceof OutageError);
    const unwrapped = outageOr(REST_PAUSED, "paused");
    assert.ok(!(unwrapped instanceof OutageError));
  });

  it("returns a plain Error for a refusal, so it is not swallowed as an outage", () => {
    const wrapped = outageOr(RLS_DENIED, "Could not read pages from Supabase: denied");
    assert.ok(wrapped instanceof Error);
    assert.ok(!(wrapped instanceof OutageError));
    assert.equal(wrapped.cause, RLS_DENIED);
  });

  it("round-trips through isOutage, so a rethrow stays recognisable", () => {
    assert.equal(isOutage(outageOr(AUTH_PAUSED, "wrapped")), true);
    assert.equal(isOutage(outageOr(REST_PAUSED, "wrapped", 540)), true);
    assert.equal(isOutage(outageOr(RLS_DENIED, "wrapped")), false);
  });
});
