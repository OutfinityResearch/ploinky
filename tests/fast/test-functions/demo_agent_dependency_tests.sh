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
