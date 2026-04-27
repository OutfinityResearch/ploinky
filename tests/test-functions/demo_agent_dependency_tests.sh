fast_check_moderator_get() {
  local routing_file=".ploinky/routing.json"
  local moderator_port
  if ! moderator_port=$(node -e "
    const fs = require('fs');
    try {
      const raw = fs.readFileSync('$routing_file', 'utf8');
      const data = JSON.parse(raw || '{}');
      const port = (data.routes || {}).moderator?.hostPort;
      if (!port) throw new Error('moderator port not found in $routing_file');
      process.stdout.write(String(port));
    } catch (e) {
      process.stderr.write(e.message);
      process.exit(1);
    }
  "); then
    echo "Failed to get moderator port: $moderator_port" >&2
    return 1
  fi

  # Use curl to send a GET request. -f fails on HTTP errors. -S shows errors, -v is verbose.
  curl -f -S -v -X GET "http://127.0.0.1:${moderator_port}/"
}

fast_check_explorer_dependencies() {
  load_state
  require_runtime || return 1

  local container
  # Explorer is in the fileExplorer repo, not demo repo
  container=$(compute_container_name "explorer" "fileExplorer") || return 1

  # Retry up to 30s — the explorer's install hook (npm install) may still be running
  local attempts=30
  local i
  for (( i=0; i<attempts; i++ )); do
    if is_bwrap_agent "$container"; then
      local output
      output=$( { echo 'test -d "${PLOINKY_CODE_DIR:-/code}/node_modules/mcp-sdk" && echo EXISTS'; echo exit; } | ploinky shell "explorer" 2>&1 ) || true
      if echo "$output" | grep -q "EXISTS"; then
        return 0
      fi
    else
      if $FAST_CONTAINER_RUNTIME exec "$container" sh -c 'test -d "/code/node_modules/mcp-sdk"' 2>/dev/null; then
        return 0
      fi
    fi
    sleep 1
  done

  echo "Explorer runtime deps missing: /code/node_modules/mcp-sdk not found after ${attempts}s." >&2
  return 1
}
