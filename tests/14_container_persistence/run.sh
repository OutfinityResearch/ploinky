#!/bin/bash
set -e

echo "--- Running Test: container persistence ---"

# 1. Setup: Create a local repo and agent
mkdir -p .ploinky/repos/local-test-repo
$PLOINKY_CMD new agent local-test-repo persistence-agent ubuntu:latest > /dev/null

# 2. Set commands that will test persistence
$PLOINKY_CMD set install persistence-agent "echo 'Initial install' > /tmp/persistence_test.txt"
$PLOINKY_CMD set run persistence-agent "cat /tmp/persistence_test.txt && echo ' - Run at: '\$(date +%s) >> /tmp/persistence_test.txt"

# 3. First run - creates container and runs install
echo "First run - creating container..."
FIRST_RUN=$($PLOINKY_CMD run agent persistence-agent)
if ! echo "$FIRST_RUN" | grep -q "Initial install"; then
    echo "FAIL: First run did not show initial install output."
    exit 1
fi

# 4. Second run - should use existing container (no install)
echo "Second run - testing persistence..."
sleep 1  # Ensure different timestamp
SECOND_RUN=$($PLOINKY_CMD run agent persistence-agent)

# Should contain the initial install line plus first run timestamp
if ! echo "$SECOND_RUN" | grep -q "Initial install"; then
    echo "FAIL: Container state was not persisted between runs."
    exit 1
fi

# Check that file has been appended to (has multiple run timestamps)
if ! echo "$SECOND_RUN" | grep -q "Run at:"; then
    echo "FAIL: Persistence test file was not updated on second run."
    exit 1
fi

# 5. Third run - verify accumulation of state
echo "Third run - verifying accumulated state..."
sleep 1
THIRD_RUN=$($PLOINKY_CMD run agent persistence-agent)

# Count the number of "Run at:" lines - should be at least 2
RUN_COUNT=$(echo "$THIRD_RUN" | grep -c "Run at:" || true)
if [ "$RUN_COUNT" -lt 2 ]; then
    echo "FAIL: Container is not accumulating state across runs (found $RUN_COUNT runs, expected at least 2)."
    echo "Output was: $THIRD_RUN"
    exit 1
fi

# 6. Test persistence with bash command
echo "Testing persistence with bash command..."
$PLOINKY_CMD run bash persistence-agent -- bash -c "echo 'Bash was here' >> /tmp/persistence_test.txt" < /dev/null

# Verify the bash modification persisted
AFTER_BASH=$($PLOINKY_CMD run agent persistence-agent)
if ! echo "$AFTER_BASH" | grep -q "Bash was here"; then
    echo "FAIL: Modifications from 'run bash' were not persisted."
    exit 1
fi

# 7. Get container name/ID to verify it exists
echo "Verifying Docker container exists..."
CONTAINER_NAME="ploinky_$(pwd | sed 's/[^a-zA-Z0-9]/_/g')_persistence-agent"
set +e
CONTAINER_EXISTS=$(docker ps -a --filter "name=$CONTAINER_NAME" --format "{{.Names}}" | grep -c "$CONTAINER_NAME")
set -e

if [ "$CONTAINER_EXISTS" -eq 0 ]; then
    echo "WARNING: Could not verify Docker container existence (might be using different naming scheme)."
else
    echo "Confirmed: Docker container '$CONTAINER_NAME' exists."
fi

echo "PASS: Container persistence works as expected."
exit 0