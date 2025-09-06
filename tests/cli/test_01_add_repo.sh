#!/bin/bash
set -e

echo "--- Running Test: add repo ---"

# 1. Run the 'add repo' command with a different repository
$PLOINKY_CMD add repo example-repo https://github.com/git-fixtures/basic.git

# 2. Verify that the repository was cloned
REPO_PATH=".ploinky/repos/example-repo"
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
