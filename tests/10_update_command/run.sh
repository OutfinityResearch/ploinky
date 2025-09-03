#!/bin/bash
set -e

echo "--- Running Test: set update and run update commands ---"

# 1. Setup: Create a local repo and a new agent inside it
mkdir -p .ploinky/repos/local-test-repo
$PLOINKY_CMD new agent local-test-repo my-update-agent ubuntu:latest > /dev/null

# 2. Set the install command
$PLOINKY_CMD set install my-update-agent "echo 'v1.0.0' > /tmp/version.txt"

# 3. Set the update command
$PLOINKY_CMD set update my-update-agent "echo 'v2.0.0' > /tmp/version.txt && echo 'Update completed'"

# 4. Verify the manifest was updated with update command
MANIFEST_PATH=".ploinky/repos/local-test-repo/my-update-agent/manifest.json"
if ! grep -q '"update": "echo' "$MANIFEST_PATH"; then
    echo "FAIL: Manifest was not updated with the 'update' command."
    exit 1
fi

# 5. Set the run command
$PLOINKY_CMD set run my-update-agent "cat /tmp/version.txt"

# 6. Run the agent first time to trigger install
INITIAL_VERSION=$($PLOINKY_CMD run agent my-update-agent)
if ! echo "$INITIAL_VERSION" | grep -q "v1.0.0"; then
    echo "FAIL: Initial version not set correctly by install command."
    exit 1
fi

# 7. Run the update command
UPDATE_OUTPUT=$($PLOINKY_CMD run update my-update-agent)
if ! echo "$UPDATE_OUTPUT" | grep -q "Update completed"; then
    echo "FAIL: 'run update' command did not execute correctly."
    exit 1
fi

# 8. Verify the update was applied by running the agent again
UPDATED_VERSION=$($PLOINKY_CMD run agent my-update-agent)
if ! echo "$UPDATED_VERSION" | grep -q "v2.0.0"; then
    echo "FAIL: Update command did not update the version file."
    exit 1
fi

echo "PASS: 'set update' and 'run update' commands work as expected."
exit 0