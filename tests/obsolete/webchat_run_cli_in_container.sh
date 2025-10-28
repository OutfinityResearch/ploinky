#!/bin/bash
set -euo pipefail

source "$(dirname -- "${BASH_SOURCE[0]}")/testUtils.sh"

TEST_WORKSPACE_DIR=$(mktemp -d -t ploinky-webchat-cli-XXXXXX)
trap cleanup EXIT
trap 'handle_error $LINENO "$BASH_COMMAND"' ERR

cd "$TEST_WORKSPACE_DIR"
echo "Created temporary workspace at: $TEST_WORKSPACE_DIR"

echo "--- Running WebChat agent-CLI binding test ---"

# Enable demo repo and agent, start router for good measure
ploinky enable repo demo || true
ploinky start demo 8086

# Configure webchat with an agent name and verify by connecting over HTTP
ploinky webchat demo

SECRETS_FILE=".ploinky/.secrets"
if [[ ! -f "$SECRETS_FILE" ]]; then
  echo "✗ .ploinky/.secrets not found after configuring webchat"
  exit 1
fi

# Read configured WEBCHAT_COMMAND
CMD=$(grep -E '^WEBCHAT_COMMAND=' "$SECRETS_FILE" | tail -n1 | sed -E 's/^WEBCHAT_COMMAND=//') || true
assert_not_empty "$CMD" "WEBCHAT_COMMAND not set after 'webchat demo'"
if [[ "$CMD" != "ploinky cli demo"* ]]; then
  echo "✗ WEBCHAT_COMMAND unexpected: '$CMD' (expected to start with 'ploinky cli demo')"
  exit 1
fi
echo "✓ WEBCHAT_COMMAND configured to run agent CLI: $CMD"

PORT=8086
# Wait for router HTTP to be ready
for i in {1..40}; do
  if curl -fsS "http://127.0.0.1:${PORT}/status" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done

# Authenticate to WebChat and open a stream (in agent CLI mode)
TOKEN=$(grep -E '^WEBCHAT_TOKEN=' "$SECRETS_FILE" | tail -n1 | sed -E 's/^WEBCHAT_TOKEN=//') || true
assert_not_empty "$TOKEN" "WEBCHAT_TOKEN not found"

COOKIE_JAR=cookies.txt
STREAM_LOG=stream.log

curl -sS -c "$COOKIE_JAR" -H 'Content-Type: application/json' \
  --data "{\"token\":\"$TOKEN\"}" \
  "http://127.0.0.1:${PORT}/webchat/auth" >/dev/null

# Open SSE, send a command, and capture output
(
  timeout 10s curl -sS -N -b "$COOKIE_JAR" "http://127.0.0.1:${PORT}/webchat/stream?tabId=t1" | sed -u -n '1,300p' > "$STREAM_LOG" 2>/dev/null &
  STREAM_PID=$!
  sleep 1
  echo -ne 'cat /etc/os-release | head -n 1\n' | curl -sS -X POST --data-binary @- -b "$COOKIE_JAR" "http://127.0.0.1:${PORT}/webchat/input?tabId=t1" >/dev/null
  sleep 2
  kill $STREAM_PID 2>/dev/null || true
) || true

if ! grep -q "Alpine Linux" "$STREAM_LOG"; then
  echo "--- Captured stream (first 120 lines) ---"
  sed -n '1,120p' "$STREAM_LOG"
  echo "✗ Did not observe 'Alpine Linux' in WebChat stream; container command may not have executed."
  exit 1
fi

echo "✓ Verified over HTTP: WebChat container outputs 'Alpine Linux' from /etc/os-release."
echo "--- Test complete ---"

# Now test binding WebChat to a local script (host shell) and verify it executes
echo "--- Testing WebChat with a local script (dash) ---"
# Prefer dash as the local script, present on most Linux distros
LOCAL_SHELL=$(command -v dash || true)
if [[ -z "$LOCAL_SHELL" ]]; then
  for cand in /bin/dash /usr/bin/dash /usr/local/bin/dash; do
    if [[ -x "$cand" ]]; then LOCAL_SHELL="$cand"; break; fi
  done
fi
if [[ -z "$LOCAL_SHELL" ]]; then
  echo "✗ Could not find 'dash' binary on this system."
  exit 1
fi

ploinky webchat "$LOCAL_SHELL"

# Wait for router to be ready after restart
for i in {1..40}; do
  if curl -fsS "http://127.0.0.1:${PORT}/status" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done

# Reuse token and new session
COOKIE_JAR2=cookies2.txt
STREAM_LOG2=stream2.log

curl -sS -c "$COOKIE_JAR2" -H 'Content-Type: application/json' \
  --data "{\"token\":\"$TOKEN\"}" \
  "http://127.0.0.1:${PORT}/webchat/auth" >/dev/null

(
  timeout 10s curl -sS -N -b "$COOKIE_JAR2" "http://127.0.0.1:${PORT}/webchat/stream?tabId=t2" | sed -u -n '1,300p' > "$STREAM_LOG2" 2>/dev/null &
  STREAM_PID=$!
  sleep 1
  # Print the shell name; should include 'dash'
  echo -ne 'echo $0\n' | curl -sS -X POST --data-binary @- -b "$COOKIE_JAR2" "http://127.0.0.1:${PORT}/webchat/input?tabId=t2" >/dev/null
  sleep 2
  kill $STREAM_PID 2>/dev/null || true
) || true

if ! grep -qi "dash" "$STREAM_LOG2"; then
  echo "--- Captured stream (first 120 lines) ---"
  sed -n '1,120p' "$STREAM_LOG2"
  echo "✗ Did not observe 'dash' in WebChat stream; local script may not have executed or printed expected shell name."
  exit 1
fi

echo "✓ Verified over HTTP: WebChat executed the local script ($LOCAL_SHELL) and reported shell name containing 'dash'."
echo "--- Local script test complete ---"
