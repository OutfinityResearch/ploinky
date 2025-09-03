#!/bin/bash
set -e



echo "--- Running Test: env commands ---"

# 1. Setup: Add repo and new agent
$PLOINKY_CMD add repo standard https://github.com/ploinky/ploinky-agents-standard.git
$PLOINKY_CMD new agent standard my-env-agent ubuntu:latest

# 2. Run the 'add env' command
$PLOINKY_CMD add env MY_SECRET_KEY "12345abcdef"

# 3. Verify the .secrets file was updated
SECRETS_PATH=".ploinky/.secrets"
if ! grep -q 'MY_SECRET_KEY="12345abcdef"' "$SECRETS_PATH"; then
    echo "FAIL: .secrets file was not updated correctly."
    exit 1
fi

# 4. Run the 'enable env' command
$PLOINKY_CMD enable env my-env-agent MY_SECRET_KEY

# 5. Verify the manifest was updated with the env var
MANIFEST_PATH=".ploinky/repos/standard/my-env-agent/manifest.json"
if ! grep -q '"env": \[
  "MY_SECRET_KEY"
\]' "$MANIFEST_PATH"; then
    echo "FAIL: Manifest was not updated with the enabled environment variable."
    exit 1
fi

echo "PASS: 'add env' and 'enable env' commands work as expected."
exit 0
