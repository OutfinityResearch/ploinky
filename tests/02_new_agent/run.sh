#!/bin/bash
set -e



echo "--- Running Test: new agent ---"

# 1. Setup: Add a repo first
$PLOINKY_CMD add repo standard https://github.com/ploinky/ploinky-agents-standard.git

# 2. Run the 'new agent' command
$PLOINKY_CMD new agent standard my-test-agent ubuntu:latest

# 3. Verify that the agent's manifest.json was created
MANIFEST_PATH=".ploinky/repos/standard/my-test-agent/manifest.json"
if [ ! -f "$MANIFEST_PATH" ]; then
    echo "FAIL: Agent manifest was not created at ${MANIFEST_PATH}"
    exit 1
fi

# 4. Verify the content of the manifest
if ! grep -q '"container": "ubuntu:latest"' "$MANIFEST_PATH"; then
    echo "FAIL: Manifest content is incorrect. Missing or wrong container name."
    exit 1
fi

echo "PASS: 'new agent' command works as expected."
exit 0
