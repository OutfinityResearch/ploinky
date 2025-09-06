#!/bin/bash
set -e

echo "--- Running Test: ambiguous agent names (RepoName:AgentName) ---"

# 1. Setup: Create two local repos
mkdir -p .ploinky/repos/repo-one
mkdir -p .ploinky/repos/repo-two

# 2. Create agents with the SAME NAME in different repos
$PLOINKY_CMD new agent repo-one duplicate-agent ubuntu:latest > /dev/null
$PLOINKY_CMD new agent repo-two duplicate-agent ubuntu:latest > /dev/null

# 3. Set different run commands for each to distinguish them
$PLOINKY_CMD set run repo-one:duplicate-agent "echo 'Agent from repo-one'"
$PLOINKY_CMD set run repo-two:duplicate-agent "echo 'Agent from repo-two'"

# 4. Test running with prefixed names
OUTPUT_ONE=$($PLOINKY_CMD run agent repo-one:duplicate-agent)
if ! echo "$OUTPUT_ONE" | grep -q "Agent from repo-one"; then
    echo "FAIL: Could not run agent with prefixed name 'repo-one:duplicate-agent'."
    exit 1
fi

OUTPUT_TWO=$($PLOINKY_CMD run agent repo-two:duplicate-agent)
if ! echo "$OUTPUT_TWO" | grep -q "Agent from repo-two"; then
    echo "FAIL: Could not run agent with prefixed name 'repo-two:duplicate-agent'."
    exit 1
fi

# 5. Test that using unprefixed ambiguous name fails or prompts
# This should fail or show an error about ambiguous name
set +e
AMBIGUOUS_OUTPUT=$($PLOINKY_CMD run agent duplicate-agent 2>&1)
AMBIGUOUS_EXIT_CODE=$?
set -e

if [ $AMBIGUOUS_EXIT_CODE -eq 0 ]; then
    echo "FAIL: Running ambiguous agent name should have failed or prompted for clarification."
    exit 1
fi

# Check if error message mentions ambiguity or lists the full names
if ! echo "$AMBIGUOUS_OUTPUT" | grep -qE "(ambiguous|repo-one:duplicate-agent|repo-two:duplicate-agent)"; then
    echo "WARNING: Error message for ambiguous name could be more informative."
    echo "Error was: $AMBIGUOUS_OUTPUT"
fi

# 6. Create a unique agent to verify non-ambiguous names still work
$PLOINKY_CMD new agent repo-one unique-agent ubuntu:latest > /dev/null
$PLOINKY_CMD set run unique-agent "echo 'Unique agent works'"

OUTPUT_UNIQUE=$($PLOINKY_CMD run agent unique-agent)
if ! echo "$OUTPUT_UNIQUE" | grep -q "Unique agent works"; then
    echo "FAIL: Non-ambiguous agent name should work without prefix."
    exit 1
fi

echo "PASS: Ambiguous agent name handling works as expected."
exit 0