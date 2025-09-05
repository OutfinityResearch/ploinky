#!/bin/bash

# Task Handler Library for Ploinky Agents

# Process a task by reading the request and executing the appropriate command
process_task() {
    local task_id="$1"
    local request_file="$2"
    
    # Read the task content
    local task_content=$(cat "$request_file")
    
    # Parse JSON task (using jq if available, or basic parsing)
    if command -v jq &> /dev/null; then
        local command=$(echo "$task_content" | jq -r '.command')
        local params=$(echo "$task_content" | jq -r '.params[]')
    else
        # Basic parsing without jq
        local command=$(echo "$task_content" | grep -oP '"command"\s*:\s*"\K[^"]+')
        local params=$(echo "$task_content" | grep -oP '"params"\s*:\s*\[\K[^\]]+')
    fi
    
    echo "[TaskHandler] Executing command: $command"
    
    # Execute the command handler
    local response=""
    local error_occurred=false
    
    if [[ -f "$AGENT_DIR/handlers/$command.sh" ]]; then
        # Execute handler script
        response=$("$AGENT_DIR/handlers/$command.sh" $params 2>&1) || error_occurred=true
    elif [[ -f "$AGENT_DIR/manifest.json" ]]; then
        # Check manifest for command mapping
        local handler=$(get_command_handler "$command")
        if [[ -n "$handler" ]]; then
            response=$(eval "$handler" $params 2>&1) || error_occurred=true
        else
            error_occurred=true
            response='{"error": true, "message": "Unknown command", "code": "COMMAND_NOT_FOUND"}'
        fi
    else
        error_occurred=true
        response='{"error": true, "message": "No handler found", "code": "NO_HANDLER"}'
    fi
    
    # Write response
    if [[ "$error_occurred" == true ]]; then
        echo "$response" > "$TASK_DIR/errors/$task_id"
    else
        echo "$response" > "$TASK_DIR/responses/$task_id"
    fi
}

# Cancel a task
cancel_task() {
    local task_id="$1"
    
    # Remove from request queue if still pending
    rm -f "$TASK_DIR/requests/$task_id"
    
    # Create cancellation response
    echo '{"cancelled": true}' > "$TASK_DIR/responses/$task_id"
}

# Get command handler from manifest
get_command_handler() {
    local command="$1"
    
    if [[ -f "$AGENT_DIR/manifest.json" ]]; then
        if command -v jq &> /dev/null; then
            jq -r ".commands[\"$command\"]" "$AGENT_DIR/manifest.json"
        else
            grep -oP "\"$command\"\s*:\s*\"\K[^\"]+\" "$AGENT_DIR/manifest.json"
        fi
    fi
}