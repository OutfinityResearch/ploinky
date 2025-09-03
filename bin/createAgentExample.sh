#!/bin/bash

# This script provides an example of how to create a new Ploinky agent.
# It can be run from any directory.

# Exit immediately if a command exits with a non-zero status.
set -e

# --- Robustly find the script's absolute directory ---
# This allows the script to be run from anywhere, even if it's in the system's PATH.
SOURCE=${BASH_SOURCE[0]}
while [ -L "$SOURCE" ]; do # resolve $SOURCE until the file is no longer a symlink
  DIR=$( cd -P "$( dirname "$SOURCE" )" >/dev/null 2>&1 && pwd )
  SOURCE=$(readlink "$SOURCE")
  [[ $SOURCE != /* ]] && SOURCE=$DIR/$SOURCE # if $SOURCE was a relative symlink, we need to resolve it relative to the path where the symlink file was located
done
SCRIPT_DIR=$( cd -P "$( dirname "$SOURCE" )" >/dev/null 2>&1 && pwd )
# ---

# Define the absolute path to the ploinky main script, which is in the parent directory of this script
PLOINKY_EXECUTABLE="${SCRIPT_DIR}/../src/index.js"

# Check if the main script exists
if [ ! -f "$PLOINKY_EXECUTABLE" ]; then
    echo "Error: Could not find the main ploinky script at ${PLOINKY_EXECUTABLE}"
    exit 1
fi

PLOINKY_CMD="node ${PLOINKY_EXECUTABLE}"

echo "--- Creating the 'simpleBash' example agent ---"
echo "(This will create a .ploinky environment in your current directory: $(pwd))"

# 1. Run the ploinky command to initialize the environment and create the agent.
#    The ploinky tool itself will operate in the current working directory.
$PLOINKY_CMD new agent standard simpleBash

# 2. Set the 'run' command for the agent.
$PLOINKY_CMD set run simpleBash "bash"

# 3. Set a placeholder 'install' command.
$PLOINKY_CMD set install simpleBash "echo 'No installation needed for simpleBash.'"

echo ""
echo "✅ Successfully created the 'simpleBash' agent."
echo "You can now run it with: ploinky run agent simpleBash"
echo "This will start an interactive bash session inside the agent's container."
