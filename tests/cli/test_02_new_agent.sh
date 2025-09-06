#!/bin/bash
set -e

echo "--- Running Test: new agent ---"

# 1. Setup: Create a local repository structure manually.
# Tests should not depend on remote repositories or modify the default one.
mkdir -p .ploinky/repos/local-test-repo

# 2. Run the 'new agent' command in the local repo
$PLOINKY_CMD new agent local-test-repo my-test-agent ubuntu:latest

# 3. Verify that the agent's manifest.json was created
MANIFEST_PATH=".ploinky/repos/local-test-repo/my-test-agent/manifest.json"
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
