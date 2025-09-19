#!/bin/sh
# AgentServer.sh
# Behavior:
# - If a command (the agent app) is provided as arguments, set CHILD_CMD to that command
#   and supervise AgentServer.js which will invoke CHILD_CMD on each request with a base64 payload.
# - If no command is provided, supervise AgentServer.js which replies with {ok:false, error:'not implemented'}.

if [ $# -gt 0 ]; then
  export CHILD_CMD="$@"
  echo "[AgentServer.sh] Supervising AgentServer.js with child command: $CHILD_CMD"
else
  echo "[AgentServer.sh] No custom app provided. Supervising default AgentServer.js on port ${PORT:-7000}"
fi

while :; do
  node /Agent/server/AgentServer.js
  code=$?
  echo "[AgentServer.sh] AgentServer.js exited with code $code. Restarting in 60s..."
  sleep 60
done
