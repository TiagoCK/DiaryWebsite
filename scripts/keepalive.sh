#!/bin/sh
#
# Keeps the Supabase project from being paused for inactivity.
#
#   scripts/keepalive.sh
#
# A free-plan project pauses after about a week without database activity, and
# a paused project CANNOT be woken by a request -- it is restored by hand in the
# dashboard. So this script's whole job is to make sure that never happens. It
# is not a recovery tool, and it says so when it finds a paused project.
#
# Shell and curl rather than Node, deliberately. This runs from a launchd agent,
# which inherits a minimal PATH that does not include nvm's node -- and nvm's
# path carries the version number, so it would break on every upgrade anyway.
# /usr/bin/curl is always present, and the same script runs unchanged on CI.
#
# Exit codes:
#   0  the project answered; it is awake
#   1  could not reach it, or an unexpected status
#   2  the project is PAUSED and needs restoring by hand in the dashboard
#
# Config comes from the environment when set (that is how CI passes secrets),
# otherwise from .env.local beside the repo, so this machine keeps exactly one
# copy of the credentials.

set -eu

REPO="$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)"
ENV_FILE="$REPO/.env.local"

# The publishable key (sb_publishable_...), never the secret key. The
# publishable key is public by design -- Supabase ships it to browsers -- so a
# copy of it in CI secrets or a launchd job expands nothing. The secret key
# bypasses row-level security, and this project's whole posture depends on it
# never leaving a server.
URL="${SUPABASE_URL:-}"
KEY="${SUPABASE_PUBLISHABLE_KEY:-}"

# Read one value out of .env.local without executing it -- a shell `.` on that
# file would run whatever happens to be in it.
env_value() {
  [ -f "$ENV_FILE" ] || return 0
  sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" "$ENV_FILE" \
    | tail -n 1 \
    | sed -e 's/^"//' -e "s/^'//" -e 's/"$//' -e "s/'$//" -e 's/[[:space:]]*$//'
}

[ -n "$URL" ] || URL="$(env_value SUPABASE_URL)"
[ -n "$KEY" ] || KEY="$(env_value NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)"

# Trailing slash would produce //rest/v1 and a 404 that looks like an outage.
URL="${URL%/}"

stamp() { date '+%Y-%m-%d %H:%M:%S'; }

# A LaunchAgent runs in the GUI session, so this actually surfaces. Guarded for
# CI, where the workflow failing is the notification.
notify() {
  [ -z "${CI:-}" ] || return 0
  command -v osascript >/dev/null 2>&1 || return 0
  osascript -e "display notification \"$1\" with title \"Diary keep-alive\"" \
    >/dev/null 2>&1 || true
}

fail() {
  echo "$(stamp) FAIL  $1"
  notify "$1"
  exit "${2:-1}"
}

if [ -z "$URL" ] || [ -z "$KEY" ]; then
  # Worth spelling out, because the launchd case looks like a missing file and
  # is not one. Under a LaunchAgent, macOS privacy protection (TCC) denies the
  # *read* of anything under ~/Documents while `test -r` still returns true, so
  # the env file appears present and comes back empty. The agent therefore gets
  # its config from the plist's EnvironmentVariables instead -- see
  # scripts/install-keepalive.sh.
  fail "No credentials. Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in the environment, or put SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in $ENV_FILE. (If this is the launchd agent, re-run scripts/install-keepalive.sh -- it cannot read .env.local under ~/Documents.)"
fi

# `pages` rather than `diaries`: it has existed since migration 0001, so this
# works against a database that has not run the later ones. The query is a real
# SELECT -- row-level security is closed, so it returns [] -- and executing SQL
# is what counts as activity. Merely opening a connection does not.
#
# -o /dev/null: the body is never of interest, and not printing it keeps rows
# out of the log even if a policy is ever added.
#
# apikey only, no Authorization header. Publishable and secret keys are opaque,
# not JWTs, and Supabase documents them as belonging on apikey alone; Bearer is
# accepted for migration compatibility and authenticates nobody. Measured
# against the project: apikey alone 200, apikey+Bearer 200, Bearer alone 401.
code="$(
  curl --silent --show-error --location \
    --max-time 20 \
    --output /dev/null \
    --write-out '%{http_code}' \
    --header "apikey: $KEY" \
    "$URL/rest/v1/pages?select=page_id&limit=1" \
    2>/dev/null
)" || code="000"

case "$code" in
  200)
    echo "$(stamp) ok    200 - project is awake"
    ;;
  540)
    # Supabase's own status for a paused project. A ping cannot clear this.
    fail "Project is PAUSED (540). Restore it in the Supabase dashboard -- a ping cannot wake it." 2
    ;;
  000)
    fail "Could not reach $URL (no HTTP response -- network, DNS or timeout)"
    ;;
  401 | 403)
    fail "Rejected with $code -- the publishable key looks wrong or has been rotated"
    ;;
  *)
    fail "Unexpected status $code from $URL"
    ;;
esac
