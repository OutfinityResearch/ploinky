#!/bin/bash
# Complete cleanup of ploinky test artifacts: watchdogs, routers, and containers.

set -euo pipefail

TESTS_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)

echo "[clean] Killing watchdog and router processes..."
pkill -9 -f "Watchdog.js" 2>/dev/null || true
pkill -9 -f "RoutingServer.js" 2>/dev/null || true
sleep 1

# Double-check: any survivors get a second round
if pgrep -f "Watchdog.js|RoutingServer.js" >/dev/null 2>&1; then
  pkill -9 -f "Watchdog.js" 2>/dev/null || true
  pkill -9 -f "RoutingServer.js" 2>/dev/null || true
  sleep 1
fi

remaining=$(pgrep -c -f "Watchdog.js|RoutingServer.js" 2>/dev/null) || remaining=0
if [[ "$remaining" -gt 0 ]]; then
  echo "[clean] WARNING: $remaining watchdog/router processes still running." >&2
fi

echo "[clean] Killing orphaned conmon processes for ploinky containers..."
pkill -9 -f "conmon.*ploinky" 2>/dev/null || true
sleep 0.5

echo "[clean] Removing all podman containers..."
podman rm -f -a 2>/dev/null || true
sleep 0.5
.
# Retry: conmon teardown may race with the first rm pass.
count=$(podman ps -a --format '{{.Names}}' 2>/dev/null | grep -c ploinky) || count=0
if [[ "$count" -gt 0 ]]; then
  echo "[clean] $count ploinky containers survived first pass, retrying..."
  podman rm -f -a 2>/dev/null || true
  sleep 0.5
  count=$(podman ps -a --format '{{.Names}}' 2>/dev/null | grep -c ploinky) || count=0
fi

if [[ "$count" -gt 0 ]]; then
  echo "[clean] WARNING: $count ploinky containers remain." >&2
else
  echo "[clean] All containers removed."
fi

echo "[clean] Removing test workspace temp directories..."
rm -rf /tmp/ploinky-fast-* 2>/dev/null || true

echo "[clean] Done."
