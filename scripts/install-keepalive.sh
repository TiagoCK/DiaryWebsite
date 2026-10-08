#!/bin/sh
#
# Installs (or removes) the local keep-alive LaunchAgent.
#
#   scripts/install-keepalive.sh              install or re-install
#   scripts/install-keepalive.sh --uninstall  remove it
#
# Why this exists rather than a sed one-liner in the README: macOS privacy
# protection (TCC) makes a naive install silently useless, in two ways that both
# look like something else.
#
#   1. A LaunchAgent holds none of the privacy grants your Terminal has, so
#      launchd cannot read a script stored under ~/Documents. It fails with
#      "Operation not permitted" before the script runs. So the script is copied
#      to ~/Library/Application Support, which is not protected.
#
#   2. The agent cannot read .env.local either -- and `test -r` on it still
#      returns TRUE while the read fails, so the script sees an empty value and
#      reports missing credentials. So the config is written into the plist's
#      EnvironmentVariables instead.
#
# Only the publishable key goes into the plist. It is public by design, which is
# why this is not a secret spreading; the secret key is refused outright.
#
# Re-run this after editing scripts/keepalive.sh -- the installed copy is a
# copy, and this is what refreshes it.

set -eu

REPO="$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)"
LABEL="com.diarywebsite.keepalive"
DOMAIN="gui/$(id -u)"
SAFE_DIR="$HOME/Library/Application Support/diary-keepalive"
SCRIPT="$SAFE_DIR/keepalive.sh"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/diary-keepalive.log"

if [ "${1:-}" = "--uninstall" ]; then
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  rm -rf "$SAFE_DIR"
  echo "Removed $LABEL. The log at $LOG is left in place."
  exit 0
fi

env_value() {
  [ -f "$REPO/.env.local" ] || return 0
  sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" "$REPO/.env.local" \
    | tail -n 1 \
    | sed -e 's/^"//' -e "s/^'//" -e 's/"$//' -e "s/'$//" -e 's/[[:space:]]*$//'
}

URL="${SUPABASE_URL:-$(env_value SUPABASE_URL)}"
KEY="${SUPABASE_PUBLISHABLE_KEY:-$(env_value NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)}"
URL="${URL%/}"

if [ -z "$URL" ] || [ -z "$KEY" ]; then
  echo "FAILED: need SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in $REPO/.env.local" >&2
  exit 1
fi

# A secret key here would be baked into a plist and read out by anything running
# as this user, for a job that only ever needs to prove the project is awake.
case "$KEY" in
  sb_secret_*)
    echo "FAILED: that is a SECRET key. The agent only ever needs the publishable key." >&2
    exit 1
    ;;
esac

mkdir -p "$SAFE_DIR" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cp "$REPO/scripts/keepalive.sh" "$SCRIPT"
chmod +x "$SCRIPT"

# plutil rather than sed: it escapes the values itself, so a key containing a
# shell or regex metacharacter cannot corrupt the plist.
cp "$REPO/scripts/keepalive.plist" "$PLIST"
plutil -replace ProgramArguments.1 -string "$SCRIPT" "$PLIST"
plutil -replace EnvironmentVariables.SUPABASE_URL -string "$URL" "$PLIST"
plutil -replace EnvironmentVariables.SUPABASE_PUBLISHABLE_KEY -string "$KEY" "$PLIST"
plutil -replace StandardOutPath -string "$LOG" "$PLIST"
plutil -replace StandardErrorPath -string "$LOG" "$PLIST"
plutil -lint "$PLIST" >/dev/null

# Truncate BEFORE loading, so whatever lands in the log is from this install.
# Truncating afterwards races the job: kickstart -p returns when the process
# exits, which is not necessarily after its stdout has reached the file.
: > "$LOG"

launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$PLIST"

# Prove it, rather than asserting it. RunAtLoad has already fired by now;
# kickstart forces one more so a re-install is also verified.
launchctl kickstart -p "$DOMAIN/$LABEL" >/dev/null 2>&1 || true

# Wait for a verdict rather than guessing how long a network round trip takes.
n=0
while [ "$n" -lt 30 ]; do
  grep -qE "ok    200|FAIL" "$LOG" 2>/dev/null && break
  n=$((n + 1))
  sleep 0.5
done

echo
echo "Installed $LABEL"
echo "  script: $SCRIPT"
echo "  plist:  $PLIST"
echo "  log:    $LOG"
echo
if grep -q "ok    200" "$LOG" 2>/dev/null; then
  echo "Verified: $(grep "ok    200" "$LOG" | tail -n 1)"
else
  echo "The first run did NOT report success:"
  sed 's/^/  /' "$LOG" 2>/dev/null || echo "  (no output)"
  echo
  echo "Inspect with: launchctl print $DOMAIN/$LABEL"
  exit 1
fi
