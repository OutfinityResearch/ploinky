# Smoke Test Specifications

## Overview

Smoke tests for Ploinky verify basic functionality works correctly. These are quick sanity checks that should pass before any deployment or release.

## Purpose

Smoke tests answer:
- Does the system start?
- Do basic operations work?
- Are critical paths functional?

They are NOT designed for:
- Complete coverage
- Edge cases
- Performance testing

## Test Cases

### smoke-basic

Verify basic CLI operations work.

```
tests/smoke-basic/
├── manifest.json
├── test.sh
└── expected/
```

**Steps**:
1. Initialize workspace
2. Create simple agent
3. Start agent
4. Verify health
5. Stop agent
6. Clean up

**Duration**: < 2 minutes

---

### smoke-web

Verify web interfaces are accessible.

```
tests/smoke-web/
├── manifest.json
├── test.sh
└── expected/
```

**Steps**:
1. Start agent with web interface
2. Verify HTTP endpoint accessible
3. Check static assets load
4. Verify WebSocket connection
5. Clean up

**Duration**: < 2 minutes

---

### smoke-mcp

Verify MCP protocol basic operations.

```
tests/smoke-mcp/
├── manifest.json
├── test.sh
└── expected/
```

**Steps**:
1. Start MCP server
2. Send initialize request
3. List tools
4. Call simple tool
5. Verify response
6. Clean up

**Duration**: < 1 minute

---

### smoke-multi-agent

Verify multi-agent basic operations.

```
tests/smoke-multi-agent/
├── manifest.json
├── test.sh
└── expected/
```

**Steps**:
1. Start router
2. Start 2 agents
3. Verify both registered
4. Cross-agent tool call
5. Verify response
6. Clean up

**Duration**: < 3 minutes

## Implementation

### Test Script Template

```bash
#!/bin/bash
# Smoke test: <name>

set -e

echo "=== Smoke Test: <name> ==="

# Setup
WORK_DIR=$(mktemp -d)
cd "$WORK_DIR"

cleanup() {
    echo "Cleaning up..."
    cd /
    rm -rf "$WORK_DIR"
    # Additional cleanup
}
trap cleanup EXIT

# Test steps
echo "Step 1: <description>"
# ... commands ...

echo "Step 2: <description>"
# ... commands ...

echo "=== SMOKE TEST PASSED ==="
```

### Manifest Format

```json
{
    "name": "smoke-basic",
    "description": "Basic smoke test",
    "type": "smoke",
    "timeout": 120,
    "requires": ["docker", "node"],
    "priority": 0
}
```

## Running Smoke Tests

### All Smoke Tests

```bash
ploinky test smoke
```

### Pre-commit Hook

```bash
#!/bin/bash
# .git/hooks/pre-commit

echo "Running smoke tests..."
ploinky test smoke-basic || exit 1
echo "Smoke tests passed"
```

### CI Integration

```yaml
smoke-tests:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - name: Run smoke tests
      run: ploinky test smoke
      timeout-minutes: 10
```

## Success Criteria

All smoke tests must:
- Complete within timeout
- Exit with code 0
- Clean up resources
- Produce expected output

## Failure Response

If smoke tests fail:

1. **Do not deploy** - Block release pipeline
2. **Investigate immediately** - Core functionality broken
3. **Fix before proceeding** - Do not work around
4. **Verify fix** - Re-run smoke tests

## Test Priority

| Test | Priority | Run On |
|------|----------|--------|
| smoke-basic | P0 | Every commit |
| smoke-web | P0 | Every commit |
| smoke-mcp | P0 | Every commit |
| smoke-multi-agent | P1 | Before release |

## Environment Requirements

### Minimum Requirements

- Docker/Podman running
- Node.js 18+
- Network access (localhost)
- 1GB free disk space

### Verification

```bash
# Check requirements before running
docker info > /dev/null 2>&1 || { echo "Docker not running"; exit 1; }
node --version | grep -q "v18\|v19\|v20\|v21\|v22" || { echo "Node 18+ required"; exit 1; }
```

## Related Documentation

- [../README.md](../README.md) - Testing overview
- [../cli/README.md](../cli/README.md) - CLI tests
- [../../evals/](../../evals/) - Evaluation scenarios
