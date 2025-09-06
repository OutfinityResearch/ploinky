#!/bin/bash
set -e

echo "--- Running Test: p-cli client commands ---"

# --- Helper Functions ---
info() {
    echo "[INFO] $1"
}

pass() {
    echo "✅ PASS: $1"
}

fail() {
    echo "❌ FAIL: $1"
    # Stop background processes if they exist
    [ ! -z "$CORE_APP_PID" ] && kill $CORE_APP_PID 2>/dev/null
    exit 1
}

# --- Test Setup ---
TEST_DIR=$(mktemp -d -t ploinky-client-test-XXXXXX)
info "Running test in temporary directory: $TEST_DIR"
cd "$TEST_DIR"

TEST_PORT=9876
P_CLI="$(pwd)/../../bin/p-cli"

# Ensure cleanup happens on script exit
trap 'cd /; rm -rf "$TEST_DIR"; [ ! -z "$CORE_APP_PID" ] && kill $CORE_APP_PID 2>/dev/null' EXIT

# --- Create the dummy core app ---
CORE_APP_SCRIPT="$TEST_DIR/core_app.js"
cat > "$CORE_APP_SCRIPT" <<EOF
const http = require('http');

const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    jsonrpc: '2.0',
                    id: data.id,
                    result: `Response for ${data.method} with params: ${JSON.stringify(data.params)}`
                }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid JSON' }));
            }
        });
    } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
    }
});

server.listen($TEST_PORT, '127.0.0.1', () => {
    console.log(`Dummy core app listening on port $TEST_PORT`);
});
EOF

# --- Test Execution ---

# 1. Start the dummy core app in the background
info "Starting dummy core app..."
node "$CORE_APP_SCRIPT" > "$TEST_DIR/core_app.log" 2>&1 &
CORE_APP_PID=$!
sleep 1 # Give it a moment to start

# Check if the server started
if ! ps -p $CORE_APP_PID > /dev/null; then
    fail "Dummy core app did not start. Log: $(cat "$TEST_DIR/core_app.log")"
fi
info "Dummy core app started with PID $CORE_APP_PID"

# 2. Connect the client
info "Connecting p-cli to dummy app..."
$P_CLI client connect "http://127.0.0.1:$TEST_PORT/api"

# Verify connection info was saved
if [ ! -f ".ploinky/client.json" ]; then
    fail "Client connection file was not created."
fi
pass "p-cli connect successfully created config file."

# 3. Call a method
info "Calling a method using p-cli..."
CALL_OUTPUT=$($P_CLI client call testMethod '{"param1": "value1"}')

# 4. Verify the output
info "Output from call: $CALL_OUTPUT"
if ! echo "$CALL_OUTPUT" | grep -q "Response for testMethod"; then
    fail "Did not receive correct response from core app."
fi
if ! echo "$CALL_OUTPUT" | grep -q '"param1":"value1"'; then
    fail "Response did not contain the correct parameters."
fi
pass "p-cli call works as expected."

# --- Test Success ---
info "Stopping dummy core app..."
kill $CORE_APP_PID
wait $CORE_APP_PID 2>/dev/null

echo ""
echo "--- p-cli client test completed successfully ---"
exit 0
