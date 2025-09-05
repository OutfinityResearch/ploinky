#!/bin/bash
set -e

echo "--- Running Test: Verify bash agent from default repo ---"

# 1. Trigger initialization by running a simple command.
# The default plonkyAgents repo should be cloned automatically.
$PLOINKY_CMD help > /dev/null

# 2. Verify that the bash agent can be found and executed.
# We run a simple, non-interactive command that should succeed.
# The '--' separates ploinky's arguments from the arguments passed to the agent's run command.
$PLOINKY_CMD run agent bash -- bash -c "echo 'Bash agent is runnable'"

# 3. Check the manifest exists as a final verification
MANIFEST_PATH=".ploinky/repos/plonkyAgents/bash/manifest.json"
if [ ! -f "$MANIFEST_PATH" ]; then
    echo "FAIL: bash agent manifest was not found at ${MANIFEST_PATH}"
    exit 1
fi

echo "PASS: The default 'bash' agent was found and is runnable."
exit 0
