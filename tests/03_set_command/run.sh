#!/bin/bash
set -e

echo "--- Running Test: set command ---"

# 1. Setup: Add repo and new agent
$PLOINKY_CMD add repo standard https://github.com/ploinky/ploinky-agents-standard.git
$PLOINKY_CMD new agent standard my-setter-agent ubuntu:latest

# 2. Run the 'set' command for 'run'
$PLOINKY_CMD set run my-setter-agent "echo 'Hello from the agent'"

# 3. Verify the manifest was updated
MANIFEST_PATH=".ploinky/repos/standard/my-setter-agent/manifest.json"
if ! grep -q "Hello from the agent" "$MANIFEST_PATH"; then
    echo "FAIL: Manifest content was not updated correctly for the 'run' command."
    exit 1
fi

# 4. Run the 'set' command for 'install'
$PLOINKY_CMD set install my-setter-agent "apt-get update"

# 5. Verify the manifest was updated
if ! grep -q '"install": "apt-get update"' "$MANIFEST_PATH"; then
    echo "FAIL: Manifest content was not updated correctly for the 'install' command."
    exit 1
fi

echo "PASS: 'set' command works as expected."
exit 0