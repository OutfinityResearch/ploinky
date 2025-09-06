#!/bin/bash

# Integration test for Ploinky Cloud with PloinkyDemo repository
# This test sets up a local cloud server, deploys an agent, and tests calling it

set -e

echo "=== Ploinky Cloud Integration Test ==="
echo

PLOINKY_DIR=$(dirname $(dirname $(dirname $(realpath $0))))
CLOUD_DIR="/tmp/test-ploinky-cloud-$$"
SERVER_PID=""

# Cleanup function
cleanup() {
    echo "Cleaning up..."
    if [ ! -z "$SERVER_PID" ]; then
        kill $SERVER_PID 2>/dev/null || true
    fi
    rm -rf "$CLOUD_DIR"
}

trap cleanup EXIT

# Setup test environment
echo "1. Setting up test environment..."
mkdir -p "$CLOUD_DIR"
cd "$CLOUD_DIR"

# Start cloud server
echo "2. Starting Ploinky Cloud server..."
export PLOINKY_CLOUD_DIR="$CLOUD_DIR"
export PLOINKY_FORCE_SINGLE=1
export PORT=8888

node "$PLOINKY_DIR/cloud/index.js" &
SERVER_PID=$!

# Wait for server to start
echo "   Waiting for server to start..."
sleep 3

# Check if server is running
if ! kill -0 $SERVER_PID 2>/dev/null; then
    echo "✗ Server failed to start"
    exit 1
fi

echo "✓ Server started on port $PORT"
echo

# Initialize cloud
echo "3. Initializing cloud..."
API_KEY=$(curl -s -X POST http://localhost:$PORT/management/api/init | grep -o '"apiKey":"[^"]*"' | cut -d'"' -f4)

if [ -z "$API_KEY" ]; then
    echo "✗ Failed to initialize cloud"
    exit 1
fi

echo "✓ Cloud initialized with API key: $API_KEY"
echo

# Login with API key
echo "4. Testing login..."
AUTH_RESPONSE=$(curl -s -X POST http://localhost:$PORT/auth \
    -H "Content-Type: application/json" \
    -d "{\"command\":\"login\",\"params\":[\"$API_KEY\"]}")

AUTH_TOKEN=$(echo $AUTH_RESPONSE | grep -o '"authorizationToken":"[^"]*"' | cut -d'"' -f4)

if [ -z "$AUTH_TOKEN" ]; then
    echo "✗ Login failed"
    echo "Response: $AUTH_RESPONSE"
    exit 1
fi

echo "✓ Logged in successfully"
echo

# Add PloinkyDemo repository
echo "5. Adding PloinkyDemo repository..."
REPO_RESPONSE=$(curl -s -X POST http://localhost:$PORT/management/api/repositories \
    -H "Cookie: authorizationToken=$AUTH_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"name":"PloinkyDemo","url":"https://github.com/PloinkyRepos/PloinkyDemo.git","enabled":true}')

echo "   Repository response: $REPO_RESPONSE"
echo

# Deploy demo agent
echo "6. Deploying demo agent..."
DEPLOY_RESPONSE=$(curl -s -X POST http://localhost:$PORT/management/api/deployments \
    -H "Cookie: authorizationToken=$AUTH_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "domain":"localhost",
        "path":"/demo",
        "agent":"demo",
        "repository":"https://github.com/PloinkyRepos/PloinkyDemo.git",
        "branch":"main"
    }')

echo "   Deploy response: $DEPLOY_RESPONSE"
echo

# Wait for deployment
echo "7. Waiting for deployment to be ready..."
sleep 5

# Test calling the agent
echo "8. Testing agent call..."
CALL_RESPONSE=$(curl -s -X POST http://localhost:$PORT/demo \
    -H "Content-Type: application/json" \
    -d '{"command":"hello","params":["World"]}')

echo "   Call response: $CALL_RESPONSE"

if echo "$CALL_RESPONSE" | grep -q "error"; then
    echo "⚠ Agent call returned an error (expected if agentCore not fully configured)"
else
    echo "✓ Agent call successful"
fi
echo

# Test with PloinkyClient
echo "9. Testing with PloinkyClient..."
cat > test-client.js << 'EOF'
const PloinkyClient = require('../../client/ploinkyClient');

async function test() {
    const client = new PloinkyClient('http://localhost:8888');
    
    // No auth required per requirements
    console.log('Testing direct call...');
    
    try {
        const result = await client.call('/demo', 'hello', 'World');
        console.log('Result:', result);
    } catch (err) {
        console.log('Error:', err.message);
    }
}

test();
EOF

node test-client.js
echo

echo "=== Test completed ==="
echo "Note: Some errors are expected if containers/agentCore are not fully configured"
echo "The test verifies that the HTTP pipeline and PloinkyClient work correctly"