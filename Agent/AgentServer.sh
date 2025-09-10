#!/bin/sh
# AgentServer.sh: if a command is provided, exec it; otherwise run the default AgentServer.js

if [ $# -gt 0 ]; then
  echo "[AgentServer.sh] Executing custom agent app: $@"
  exec /bin/sh -lc "$@"
else
  echo "[AgentServer.sh] No custom app provided. Supervising default AgentServer.js on port ${PORT:-7000}"
  while :; do
    node /Agent/AgentServer.js
    code=$?
    echo "[AgentServer.sh] AgentServer.js exited with code $code. Restarting in 60s..."
    sleep 60
  done
fi
