#!/bin/sh

# runTask.sh - Execute tasks inside the container using the coreAgent libraries
# This script is mounted at /coreAgent/runTask.sh in the container

TASK_ID=$1
COMMAND=$2
shift 2
PARAMS="$@"

TASK_DIR=${TASK_DIR:-/tasks}
RESPONSE_DIR=${RESPONSE_DIR:-/responses}
AGENT_DIR=${AGENT_DIR:-/code}

# Ensure directories exist
mkdir -p "$TASK_DIR" "$RESPONSE_DIR"

# Change to agent directory
cd "$AGENT_DIR" || exit 1

# Check if Node.js is available
if command -v node >/dev/null 2>&1; then
    RUNTIME="node"
elif command -v bun >/dev/null 2>&1; then
    RUNTIME="bun"
elif command -v deno >/dev/null 2>&1; then
    RUNTIME="deno"
else
    echo "No JavaScript runtime found"
    exit 1
fi

# Execute the task using the coreAgent client
if [ -f "/coreAgent/taskRunner.js" ]; then
    $RUNTIME /coreAgent/taskRunner.js "$TASK_ID" "$COMMAND" $PARAMS
else
    # Fallback: directly execute if taskRunner not available
    if [ -f "./index.js" ]; then
        $RUNTIME ./index.js "$COMMAND" $PARAMS > "$RESPONSE_DIR/${TASK_ID}.json" 2>&1
    else
        echo "{\"error\": \"No task runner found\"}" > "$RESPONSE_DIR/${TASK_ID}.json"
        exit 1
    fi
fi

exit 0