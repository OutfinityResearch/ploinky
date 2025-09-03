#!/bin/bash

# Exit immediately if a command exits with a non-zero status.
set -e



echo "--- Running Test: add repo ---"

# 1. Run the 'add repo' command
$PLOINKY_CMD add repo standard https://github.com/ploinky/ploinky-agents-standard.git

# 2. Verify that the repository was cloned
REPO_PATH=".ploinky/repos/standard"
if [ ! -d "$REPO_PATH" ]; then
    echo "FAIL: Repository directory was not created at ${REPO_PATH}"
    exit 1
fi

# 3. Verify that it's a git repository
if [ ! -d "$REPO_PATH/.git" ]; then
    echo "FAIL: Cloned directory does not appear to be a git repository."
    exit 1
fi

echo "PASS: 'add repo' command works as expected."
exit 0
