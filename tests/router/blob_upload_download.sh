#!/bin/bash
set -euo pipefail

source "$(dirname -- "${BASH_SOURCE[0]}")/../cli/testUtils.sh"

TEST_WORKSPACE_DIR=$(mktemp -d -t ploinky-blobs-XXXXXX)
trap cleanup EXIT
trap 'handle_error $LINENO "$BASH_COMMAND"' ERR

cd "$TEST_WORKSPACE_DIR"
echo "Created temporary workspace at: $TEST_WORKSPACE_DIR"

PORT=8099

wait_router() {
  local port="$1"
  for i in {1..60}; do
    if curl -fsS "http://127.0.0.1:${port}/status" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
  done
  return 1
}

echo "--- Blob Upload/Download Test (1MB file) ---"

# Start router with demo as static agent
ploinky enable repo demo
ploinky start demo "$PORT"
wait_router "$PORT"

AGENT_NAME="demo"

# Generate a 1MB test file
FILE_PATH="test_1MB.bin"
dd if=/dev/urandom of="$FILE_PATH" bs=1M count=1 2>/dev/null
if [[ ! -f "$FILE_PATH" ]]; then
  echo "✗ Failed to create test file: $FILE_PATH"
  exit 1
fi

FILE_SIZE=$(stat -c %s "$FILE_PATH" 2>/dev/null || stat -f %z "$FILE_PATH")

# Upload using streaming from file
RESP=$(curl -sS -X POST --data-binary @"$FILE_PATH" \
  -H 'Content-Type: application/octet-stream' \
  -H 'X-Mime-Type: application/octet-stream' \
  "http://127.0.0.1:${PORT}/blobs/${AGENT_NAME}")
echo "Upload response: $RESP"
ID=$(node -e "const r=process.argv[1]; try{const j=JSON.parse(r); if(j&&j.id) process.stdout.write(j.id);}catch(e){}" "$RESP")
URL=$(node -e "const r=process.argv[1]; try{const j=JSON.parse(r); if(j&&j.url) process.stdout.write(j.url);}catch(e){}" "$RESP")
RESP_AGENT=$(node -e "const r=process.argv[1]; try{const j=JSON.parse(r); if(j&&j.agent) process.stdout.write(j.agent);}catch(e){}" "$RESP")

if [[ -z "$ID" || -z "$URL" ]]; then
  echo "✗ Failed to parse upload response"
  exit 1
fi

if [[ "$RESP_AGENT" != "$AGENT_NAME" ]]; then
  echo "✗ Upload response agent mismatch: expected '$AGENT_NAME' got '${RESP_AGENT:-<none>}'"
  exit 1
fi

if [[ "$URL" != "/blobs/${AGENT_NAME}/"* ]]; then
  echo "✗ Upload URL missing agent segment: $URL"
  exit 1
fi

# HEAD with size validation
HEAD_INFO=$(curl -sS -I "http://127.0.0.1:${PORT}${URL}")
HEAD_OK=$(echo "$HEAD_INFO" | awk 'NR==1{print $2}')
if [[ "$HEAD_OK" != "200" ]]; then
  echo "✗ HEAD failed with code $HEAD_OK"
  echo "$HEAD_INFO"
  exit 1
fi
REMOTE_CL=$(echo "$HEAD_INFO" | grep -i '^Content-Length:' | awk '{print $2}' | tr -d '\r')
if [[ -z "$REMOTE_CL" || "$REMOTE_CL" != "$FILE_SIZE" ]]; then
  echo "✗ Content-Length mismatch: remote=$REMOTE_CL local=$FILE_SIZE"
  exit 1
fi

# Range GET first 16 bytes only (avoid downloading full 100MB)
PART=$(curl -sS -H 'Range: bytes=0-15' "http://127.0.0.1:${PORT}${URL}" | hexdump -v -e '/1 "%02X"')
LOCAL_PART=$(head -c 16 "$FILE_PATH" | hexdump -v -e '/1 "%02X"')
if [[ "$PART" != "$LOCAL_PART" ]]; then
  echo "✗ Range bytes mismatch between remote and local"
  echo "remote: $PART"
  echo "local : $LOCAL_PART"
  exit 1
fi

echo "✓ Blob upload + HEAD (size) + partial GET match (first 16 bytes)."

# Full download and verification
echo "--- Full Download and Verification ---"
DOWNLOADED_FILE="downloaded_file.bin"
curl -sS -o "$DOWNLOADED_FILE" "http://127.0.0.1:${PORT}${URL}"

# Verify file size
DOWNLOADED_SIZE=$(stat -c %s "$DOWNLOADED_FILE" 2>/dev/null || stat -f %z "$DOWNLOADED_FILE")
if [[ "$FILE_SIZE" != "$DOWNLOADED_SIZE" ]]; then
  echo "✗ Downloaded file size mismatch: expected=$FILE_SIZE got=$DOWNLOADED_SIZE"
  exit 1
fi

# Verify checksum
ORIGINAL_CHECKSUM=$(sha256sum "$FILE_PATH" | awk '{print $1}')
DOWNLOADED_CHECKSUM=$(sha256sum "$DOWNLOADED_FILE" | awk '{print $1}')

if [[ "$ORIGINAL_CHECKSUM" != "$DOWNLOADED_CHECKSUM" ]]; then
  echo "✗ Checksum mismatch"
  echo "Original:   $ORIGINAL_CHECKSUM"
  echo "Downloaded: $DOWNLOADED_CHECKSUM"
  exit 1
fi

echo "✓ Full download size and checksum match."
