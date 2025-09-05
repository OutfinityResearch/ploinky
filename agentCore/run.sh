#!/bin/bash

# Ploinky Agent Core - Standard entry point for all agents
# This script handles the task queue mechanics and command routing

AGENT_DIR="${AGENT_DIR:-/agent}"
TASK_DIR="$AGENT_DIR/.tasks"

# Create necessary directories
mkdir -p "$TASK_DIR"/{requests,responses,errors,locks,urgent}

# Source the task handler library
source /agentCore/lib/taskHandler.sh

# Main loop
echo "[AgentCore] Starting agent with command: $1"

while true; do
    # Check for urgent tasks (e.g., cancel requests)
    for urgent_file in "$TASK_DIR/urgent"/*; do
        if [[ -f "$urgent_file" ]]; then
            task_id=$(basename "$urgent_file")
            echo "[AgentCore] Cancelling task: $task_id"
            cancel_task "$task_id"
            rm -f "$urgent_file"
        fi
    done
    
    # Process request queue
    for request_file in "$TASK_DIR/requests"/*; do
        if [[ -f "$request_file" ]]; then
            task_id=$(basename "$request_file")
            
            # Acquire lock
            if mkdir "$TASK_DIR/locks/$task_id" 2>/dev/null; then
                echo "[AgentCore] Processing task: $task_id"
                
                # Process the task
                process_task "$task_id" "$request_file"
                
                # Release lock
                rmdir "$TASK_DIR/locks/$task_id"
                
                # Remove request file
                rm -f "$request_file"
            fi
        fi
    done
    
    # Small delay to prevent CPU spinning
    sleep 0.1
done