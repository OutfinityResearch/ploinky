#!/bin/bash
set -e

echo "--- Running Test: error handling and validation ---"

# Helper function to check if command fails
expect_failure() {
    local cmd="$1"
    local test_name="$2"
    
    set +e
    eval "$cmd" > /dev/null 2>&1
    local exit_code=$?
    set -e
    
    if [ $exit_code -eq 0 ]; then
        echo "FAIL: $test_name - Command should have failed but succeeded: $cmd"
        exit 1
    else
        echo "PASS: $test_name - Command failed as expected"
    fi
}

# 1. Test: Missing required parameters
echo "Testing missing parameters..."
expect_failure "$PLOINKY_CMD add repo" "add repo without parameters"
expect_failure "$PLOINKY_CMD new agent" "new agent without parameters"
expect_failure "$PLOINKY_CMD new agent only-one-param" "new agent with only one parameter"
expect_failure "$PLOINKY_CMD set run" "set run without parameters"
expect_failure "$PLOINKY_CMD add env" "add env without parameters"
expect_failure "$PLOINKY_CMD enable env" "enable env without parameters"

# 2. Test: Invalid repository operations
echo "Testing invalid repository operations..."
expect_failure "$PLOINKY_CMD new agent non-existent-repo test-agent" "new agent in non-existent repo"
expect_failure "$PLOINKY_CMD add repo test-repo not-a-valid-url" "add repo with invalid URL"

# 3. Test: Invalid agent operations
echo "Testing invalid agent operations..."
expect_failure "$PLOINKY_CMD run agent non-existent-agent" "run non-existent agent"
expect_failure "$PLOINKY_CMD set run non-existent-agent 'echo test'" "set command on non-existent agent"
expect_failure "$PLOINKY_CMD run bash non-existent-agent" "run bash on non-existent agent"
expect_failure "$PLOINKY_CMD run update non-existent-agent" "run update on non-existent agent"

# 4. Test: Invalid environment variable operations
echo "Testing invalid environment variable operations..."

# First create a test agent for env testing
mkdir -p .ploinky/repos/test-repo
$PLOINKY_CMD new agent test-repo env-test-agent > /dev/null

# Try to enable a non-existent environment variable
expect_failure "$PLOINKY_CMD enable env env-test-agent NON_EXISTENT_VAR" "enable non-existent env var"

# 5. Test: Invalid command syntax
echo "Testing invalid command syntax..."
expect_failure "$PLOINKY_CMD invalid-command" "invalid command"
expect_failure "$PLOINKY_CMD run invalid-subcommand agent-name" "invalid run subcommand"
expect_failure "$PLOINKY_CMD set invalid-type agent-name 'command'" "invalid set type"

# 6. Test: Container-related errors
echo "Testing container-related errors..."

# Create agent with invalid container image
$PLOINKY_CMD new agent test-repo bad-container-agent this-image-does-not-exist:latest > /dev/null
$PLOINKY_CMD set run bad-container-agent "echo 'test'"

# This should fail when trying to create/run the container
expect_failure "$PLOINKY_CMD run agent bad-container-agent" "run agent with non-existent container image"

# 7. Test: File permission errors (if applicable)
echo "Testing file permission scenarios..."

# Create a read-only manifest to test write protection
mkdir -p .ploinky/repos/test-repo/readonly-agent
echo '{"container": "ubuntu:latest", "run": "echo test"}' > .ploinky/repos/test-repo/readonly-agent/manifest.json
chmod 444 .ploinky/repos/test-repo/readonly-agent/manifest.json

# Try to modify the read-only agent
expect_failure "$PLOINKY_CMD set run readonly-agent 'echo modified'" "modify read-only manifest"

# Cleanup the read-only file
chmod 644 .ploinky/repos/test-repo/readonly-agent/manifest.json

echo ""
echo "=== All error handling tests completed successfully ==="
echo "PASS: Error handling and validation work as expected."
exit 0