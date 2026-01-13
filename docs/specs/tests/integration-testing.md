# Integration Testing Guidelines

## Overview

Guidelines for writing and maintaining integration tests for Ploinky. Integration tests verify that multiple components work together correctly with real dependencies.

## Scope

Integration tests cover:

- Multi-module interactions
- Container orchestration
- Network communication
- File system operations
- Database interactions
- External service integration

## Test Environment

### Prerequisites

```bash
# Required tools
docker --version  # or podman
node --version    # 18+
npm --version
```

### Environment Setup

```bash
# Start test environment
./scripts/test-env-start.sh

# Run integration tests
npm run test:integration

# Stop test environment
./scripts/test-env-stop.sh
```

### Docker Compose

```yaml
# docker-compose.test.yml
version: '3.8'

services:
  test-agent:
    build: .
    environment:
      - PORT=7000
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:7000/health"]
      interval: 5s
      timeout: 3s
      retries: 3

  router:
    build:
      context: .
      dockerfile: Dockerfile.router
    ports:
      - "8080:8080"
    depends_on:
      test-agent:
        condition: service_healthy
```

## Test Structure

### Directory Organization

```
tests/
├── integration/
│   ├── setup/
│   │   ├── global-setup.js
│   │   └── global-teardown.js
│   ├── agent-lifecycle/
│   │   ├── start-stop.test.js
│   │   └── restart.test.js
│   ├── mcp-communication/
│   │   ├── tool-calls.test.js
│   │   └── resource-access.test.js
│   └── multi-agent/
│       └── orchestration.test.js
```

### Test Template

```javascript
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';

describe('Agent Lifecycle Integration', () => {
    let agentProcess;
    const PORT = 7100;

    beforeAll(async () => {
        // Start agent
        agentProcess = spawn('node', ['Agent/server/AgentServer.mjs'], {
            env: { ...process.env, PORT: String(PORT) }
        });

        // Wait for ready
        await waitForHealthy(`http://localhost:${PORT}/health`);
    }, 30000);

    afterAll(async () => {
        // Stop agent
        if (agentProcess) {
            agentProcess.kill('SIGTERM');
            await waitForExit(agentProcess);
        }
    });

    test('agent responds to health check', async () => {
        const response = await fetch(`http://localhost:${PORT}/health`);
        const data = await response.json();

        expect(response.ok).toBe(true);
        expect(data.ok).toBe(true);
    });

    test('agent handles MCP initialize', async () => {
        const response = await fetch(`http://localhost:${PORT}/mcp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: '1',
                method: 'initialize',
                params: {
                    protocolVersion: '2025-06-18',
                    capabilities: {},
                    clientInfo: { name: 'test', version: '1.0.0' }
                }
            })
        });

        const data = await response.json();
        expect(data.result).toHaveProperty('capabilities');
    });
});
```

## Helper Functions

### Wait Utilities

```javascript
async function waitForHealthy(url, timeout = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        try {
            const res = await fetch(url);
            if (res.ok) return;
        } catch {
            // Keep trying
        }
        await sleep(500);
    }
    throw new Error(`Timeout waiting for ${url}`);
}

async function waitForExit(process, timeout = 10000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            process.kill('SIGKILL');
            reject(new Error('Timeout waiting for process exit'));
        }, timeout);

        process.on('exit', () => {
            clearTimeout(timer);
            resolve();
        });
    });
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
```

### Container Utilities

```javascript
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

async function startContainer(name, image, options = {}) {
    const { port, env = {} } = options;
    const envArgs = Object.entries(env)
        .map(([k, v]) => `-e ${k}=${v}`)
        .join(' ');
    const portArg = port ? `-p ${port}:${port}` : '';

    await execAsync(
        `docker run -d --name ${name} ${portArg} ${envArgs} ${image}`
    );

    await waitForContainer(name);
}

async function stopContainer(name) {
    try {
        await execAsync(`docker stop ${name}`);
        await execAsync(`docker rm ${name}`);
    } catch {
        // Container may not exist
    }
}

async function waitForContainer(name, timeout = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        const { stdout } = await execAsync(
            `docker inspect -f '{{.State.Running}}' ${name}`
        );
        if (stdout.trim() === 'true') return;
        await sleep(500);
    }
    throw new Error(`Timeout waiting for container ${name}`);
}
```

## Test Categories

### Agent Lifecycle

```javascript
describe('Agent Lifecycle', () => {
    test('start/stop cycle completes cleanly', async () => {
        await startAgent('test-agent');
        expect(await isRunning('test-agent')).toBe(true);

        await stopAgent('test-agent');
        expect(await isRunning('test-agent')).toBe(false);
    });

    test('restart preserves configuration', async () => {
        await setConfig('test-agent', { key: 'value' });
        await restartAgent('test-agent');

        const config = await getConfig('test-agent');
        expect(config.key).toBe('value');
    });
});
```

### MCP Communication

```javascript
describe('MCP Communication', () => {
    test('tool call returns result', async () => {
        const client = await createMCPClient(AGENT_URL);
        await client.connect();

        const result = await client.callTool('echo', { message: 'hello' });

        expect(result.content[0].text).toBe('hello');
        await client.close();
    });

    test('resource read returns content', async () => {
        const client = await createMCPClient(AGENT_URL);
        await client.connect();

        const content = await client.readResource('file:///test.txt');

        expect(content).toBeDefined();
        await client.close();
    });
});
```

### Multi-Agent

```javascript
describe('Multi-Agent Orchestration', () => {
    let agentA, agentB;

    beforeAll(async () => {
        agentA = await startAgent('agent-a');
        agentB = await startAgent('agent-b');
    });

    afterAll(async () => {
        await stopAgent('agent-a');
        await stopAgent('agent-b');
    });

    test('agent A can call tool on agent B', async () => {
        const clientA = await createMCPClient(agentA.url);
        await clientA.connect();

        // Agent A calls tool that invokes Agent B
        const result = await clientA.callTool('delegate-to-b', {
            action: 'process'
        });

        expect(result.content[0].text).toContain('processed by B');
    });
});
```

## Timeouts

Configure appropriate timeouts for integration tests:

```javascript
// vitest.config.js
export default {
    test: {
        testTimeout: 60000,      // 60s per test
        hookTimeout: 120000,     // 2min for setup/teardown
    }
};
```

## Cleanup

Always ensure cleanup runs:

```javascript
import { afterAll, afterEach } from 'vitest';

const resources = [];

function trackResource(resource) {
    resources.push(resource);
    return resource;
}

afterEach(async () => {
    // Clean up per-test resources
});

afterAll(async () => {
    // Clean up all tracked resources
    for (const resource of resources.reverse()) {
        try {
            await resource.cleanup();
        } catch (err) {
            console.error('Cleanup failed:', err);
        }
    }
});
```

## Related Documentation

- [unit-testing.md](./unit-testing.md) - Unit tests
- [cli/README.md](./cli/README.md) - CLI tests
- [smoke/README.md](./smoke/README.md) - Smoke tests
