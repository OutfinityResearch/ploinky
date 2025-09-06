#!/bin/bash
set -e

echo "--- Running Test: run bash command ---"

# 1. Setup: Create a local repo and a new agent inside it
mkdir -p .ploinky/repos/local-test-repo
$PLOINKY_CMD new agent local-test-repo my-bash-agent ubuntu:latest > /dev/null

# 2. Set the agent's install command to create a test file
$PLOINKY_CMD set install my-bash-agent "echo 'Test marker file' > /tmp/bash_test_marker.txt"

# 3. Set the agent's run command
$PLOINKY_CMD set run my-bash-agent "echo 'Agent running successfully'"

# 4. First run the agent to trigger install (creates container)
$PLOINKY_CMD run agent my-bash-agent > /dev/null

# 5. Test 'run bash' command with a simple echo
BASH_OUTPUT=$($PLOINKY_CMD run bash my-bash-agent -- bash -c "echo 'Bash session works'" < /dev/null)
if ! echo "$BASH_OUTPUT" | grep -q "Bash session works"; then
    echo "FAIL: 'run bash' command did not execute the bash command correctly."
    exit 1
fi

# 6. Test that the install command was executed (check for marker file)
MARKER_CHECK=$($PLOINKY_CMD run bash my-bash-agent -- bash -c "cat /tmp/bash_test_marker.txt 2>/dev/null || echo 'NOT FOUND'" < /dev/null)
if ! echo "$MARKER_CHECK" | grep -q "Test marker file"; then
    echo "FAIL: Container does not have the marker file from install command."
    exit 1
fi

# 7. Test running bash with working directory mapping
# Create a test file in the current directory
echo "Host file content" > test_file_for_bash.txt

# Check if the file is accessible from within the container
FILE_CHECK=$($PLOINKY_CMD run bash my-bash-agent -- bash -c "cat test_file_for_bash.txt 2>/dev/null || echo 'NOT FOUND'" < /dev/null)
if ! echo "$FILE_CHECK" | grep -q "Host file content"; then
    echo "FAIL: 'run bash' does not properly map the working directory."
    exit 1
fi

# Cleanup
rm -f test_file_for_bash.txt

echo "PASS: 'run bash' command works as expected."
exit 0