#!/bin/bash
set -euo pipefail

# This test verifies that web commands (--rotate) refresh their tokens:
# - webtty, webconsole, webchat, dashboard, webmeet

source "$(dirname -- "${BASH_SOURCE[0]}")/testUtils.sh"

TEST_WORKSPACE_DIR=$(mktemp -d -t ploinky-webcmds-test-XXXXXX)
trap cleanup EXIT
trap 'handle_error $LINENO "$BASH_COMMAND"' ERR

cd "$TEST_WORKSPACE_DIR"
echo "Created temporary workspace at: $TEST_WORKSPACE_DIR"

echo "--- Running Web Commands Token Rotation Test ---"

# Enable agent and start workspace (first-time requires port)
echo "1) Enabling 'demo' agent and starting router..."
ploinky enable repo demo
ploinky start demo

# Ensure initial tokens exist by invoking each command once (no rotation)
echo "2) Ensuring initial tokens exist..."
ploinky webtty
ploinky webchat
ploinky dashboard
ploinky webmeet

SECRETS_FILE=".ploinky/.secrets"
if [[ ! -f "$SECRETS_FILE" ]]; then
  echo "✗ Missing .ploinky/.secrets after preparing tokens"
  exit 1
fi

get_secret() {
  local name="$1"
  local val
  val=$(grep -E "^${name}=" "$SECRETS_FILE" | tail -n1 | sed -E "s/^${name}=//") || true
  echo -n "$val"
}

WTTY_BEFORE=$(get_secret WEBTTY_TOKEN)
WCHAT_BEFORE=$(get_secret WEBCHAT_TOKEN)
WDASH_BEFORE=$(get_secret WEBDASHBOARD_TOKEN)
WMEET_BEFORE=$(get_secret WEBMEET_TOKEN)

assert_not_empty "$WTTY_BEFORE" "WEBTTY_TOKEN not set initially"
assert_not_empty "$WCHAT_BEFORE" "WEBCHAT_TOKEN not set initially"
assert_not_empty "$WDASH_BEFORE" "WEBDASHBOARD_TOKEN not set initially"
assert_not_empty "$WMEET_BEFORE" "WEBMEET_TOKEN not set initially"

echo "3) Rotating tokens with respective commands..."

# webtty rotates WEBTTY_TOKEN
ploinky webtty --rotate
WTTY_AFTER=$(get_secret WEBTTY_TOKEN)
if [[ "$WTTY_AFTER" == "$WTTY_BEFORE" ]]; then
  echo "✗ WEBTTY_TOKEN did not change after 'webtty --rotate'"
  exit 1
fi
echo "✓ WEBTTY_TOKEN rotated via webtty"

# webconsole also rotates WEBTTY_TOKEN
WTTY_PRE2="$WTTY_AFTER"
ploinky webconsole --rotate
WTTY_AFTER2=$(get_secret WEBTTY_TOKEN)
if [[ "$WTTY_AFTER2" == "$WTTY_PRE2" ]]; then
  echo "✗ WEBTTY_TOKEN did not change after 'webconsole --rotate'"
  exit 1
fi
echo "✓ WEBTTY_TOKEN rotated via webconsole"

# webchat rotates WEBCHAT_TOKEN
ploinky webchat --rotate
WCHAT_AFTER=$(get_secret WEBCHAT_TOKEN)
if [[ "$WCHAT_AFTER" == "$WCHAT_BEFORE" ]]; then
  echo "✗ WEBCHAT_TOKEN did not change after 'webchat --rotate'"
  exit 1
fi
echo "✓ WEBCHAT_TOKEN rotated via webchat"

# dashboard rotates WEBDASHBOARD_TOKEN
ploinky dashboard --rotate
WDASH_AFTER=$(get_secret WEBDASHBOARD_TOKEN)
if [[ "$WDASH_AFTER" == "$WDASH_BEFORE" ]]; then
  echo "✗ WEBDASHBOARD_TOKEN did not change after 'dashboard --rotate'"
  exit 1
fi
echo "✓ WEBDASHBOARD_TOKEN rotated via dashboard"

# webmeet rotates WEBMEET_TOKEN
ploinky webmeet --rotate
WMEET_AFTER=$(get_secret WEBMEET_TOKEN)
if [[ "$WMEET_AFTER" == "$WMEET_BEFORE" ]]; then
  echo "✗ WEBMEET_TOKEN did not change after 'webmeet --rotate'"
  exit 1
fi
echo "✓ WEBMEET_TOKEN rotated via webmeet"

echo "--- All rotations verified successfully ---"

