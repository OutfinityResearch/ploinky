#!/bin/bash
set -e

echo "--- Running Test: help command ---"

# 1. Run the help command
HELP_OUTPUT=$($PLOINKY_CMD help)

# 2. Check for essential command documentation
COMMANDS_TO_CHECK=(
    "add repo"
    "new agent"
    "set install"
    "set update"
    "set run"
    "add env"
    "enable env"
    "run agent"
    "run bash"
    "run update"
    "list agents"
    "list repos"
    "help"
)

echo "Checking help output contains documentation for all commands..."

MISSING_COMMANDS=""
for cmd in "${COMMANDS_TO_CHECK[@]}"; do
    if ! echo "$HELP_OUTPUT" | grep -qi "$cmd"; then
        MISSING_COMMANDS="$MISSING_COMMANDS$cmd, "
    fi
done

if [ -n "$MISSING_COMMANDS" ]; then
    echo "FAIL: Help output is missing documentation for: ${MISSING_COMMANDS%, }"
    echo "Help output was:"
    echo "$HELP_OUTPUT"
    exit 1
fi

# 3. Check that help provides useful descriptions (not just command names)
# Check for some key terms that should appear in descriptions
DESCRIPTION_TERMS=(
    "repository"
    "agent"
    "container"
    "environment"
    "command"
)

MISSING_TERMS=""
for term in "${DESCRIPTION_TERMS[@]}"; do
    if ! echo "$HELP_OUTPUT" | grep -qi "$term"; then
        MISSING_TERMS="$MISSING_TERMS$term, "
    fi
done

if [ -n "$MISSING_TERMS" ]; then
    echo "WARNING: Help output might be missing descriptions. Missing terms: ${MISSING_TERMS%, }"
fi

# 4. Check help output is reasonably sized (not empty, not too short)
HELP_LENGTH=$(echo "$HELP_OUTPUT" | wc -l)
if [ "$HELP_LENGTH" -lt 10 ]; then
    echo "FAIL: Help output is too short (only $HELP_LENGTH lines). Expected comprehensive help."
    exit 1
fi

# 5. Test help command exit code
$PLOINKY_CMD help > /dev/null
if [ $? -ne 0 ]; then
    echo "FAIL: Help command exited with non-zero code."
    exit 1
fi

echo "PASS: 'help' command works as expected and provides comprehensive documentation."
exit 0