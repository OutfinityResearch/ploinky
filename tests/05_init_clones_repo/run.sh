#!/bin/bash
set -e

echo "--- Running Test: Init automatically clones the default repo ---"

# Run any ploinky command to trigger the initialization logic. 'help' is safe.
$PLOINKY_CMD help > /dev/null

# Verify that the repository was cloned
REPO_PATH=".ploinky/repos/plonkyAgents"
if [ ! -d "$REPO_PATH" ]; then
    echo "FAIL: Repository directory was not created at ${REPO_PATH}"
    exit 1
fi

# Verify that it's a git repository
if [ ! -d "$REPO_PATH/.git" ]; then
    echo "FAIL: Cloned directory does not appear to be a git repository."
    exit 1
fi

echo "PASS: Ploinky initialization correctly cloned the default 'plonkyAgents' repository."
exit 0