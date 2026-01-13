# Agent/client/MCPBrowserClient.js - Browser MCP Client

## Overview

Browser-based MCP client for WebChat and other browser interfaces. Implements JSON-RPC 2.0 over HTTP with SSE streaming support and async task polling for long-running operations.

## Source File

`Agent/client/MCPBrowserClient.js`

## Constants

```javascript
const DEFAULT_PROTOCOL_VERSION = '2025-06-18';
const JSONRPC_VERSION = '2.0';
const TASK_POLL_INTERVAL_MS = 30000;
```

## Factory Function

### createAgentClient(baseUrl)

**Purpose**: Creates MCP client instance for browser environment

**Parameters**:
- `baseUrl` (string): Base URL for MCP endpoint

**Returns**: (Object) Client interface

```javascript
function createAgentClient(baseUrl) {
    const endpoint = resolveBaseUrl(baseUrl);

    let connected = false;
    let sessionId = null;
    let protocolVersion = null;
    let abortController = null;
    let streamTask = null;
    let streamUnsupported = false;
    let messageId = 0;

    const pending = new Map();
    const taskPollers = new Map();

    let serverCapabilities = null;
    let serverInfo = null;
    let instructions = null;

    // ... methods ...

    return {
        connect,
        listTools,
        callTool,
        listResources,
        readResource,
        ping,
        close,
        getCapabilities: () => serverCapabilities,
        getServerInfo: () => serverInfo,
        getInstructions: () => instructions
    };
}

export { createAgentClient };
```

## Internal State

```javascript
let connected = false;           // Connection established
let sessionId = null;            // MCP session ID
let protocolVersion = null;      // Negotiated protocol version
let abortController = null;      // SSE abort controller
let streamTask = null;           // SSE stream promise
let streamUnsupported = false;   // Server doesn't support SSE
let messageId = 0;               // Auto-incrementing message ID

const pending = new Map();       // Pending request promises (id -> {resolve, reject})
const taskPollers = new Map();   // Active async task pollers (taskId -> poller)

let serverCapabilities = null;   // Server capabilities from initialize
let serverInfo = null;           // Server info from initialize
let instructions = null;         // Server instructions from initialize
```

## URL Resolution

### resolveBaseUrl(baseUrl)

**Purpose**: Resolves base URL relative to window.location

```javascript
function resolveBaseUrl(baseUrl) {
    try {
        if (typeof window !== 'undefined' && window.location) {
            return new URL(baseUrl, window.location.href).toString();
        }
    } catch {
        // Fall through to absolute resolution
    }
    return new URL(baseUrl).toString();
}
```

## Headers Management

### buildHeaders(options)

**Purpose**: Builds request headers with session and protocol info

**Parameters**:
- `options.acceptStream` (boolean): Accept SSE responses
- `options.includeContentType` (boolean): Include JSON content type

```javascript
function buildHeaders(options = {}) {
    const { acceptStream = false, includeContentType = false } = options;

    const headers = new Headers();
    if (includeContentType) {
        headers.set('content-type', 'application/json');
    }
    headers.set('accept', acceptStream ? 'text/event-stream' : 'application/json, text/event-stream');
    if (sessionId) {
        headers.set('mcp-session-id', sessionId);
    }
    if (protocolVersion) {
        headers.set('mcp-protocol-version', protocolVersion);
    }
    return headers;
}
```

## Message Handling

### handleJsonrpcMessage(message)

**Purpose**: Routes JSON-RPC response to pending request

```javascript
function handleJsonrpcMessage(message) {
    const id = message.id !== undefined && message.id !== null ? String(message.id) : null;

    if (id && pending.has(id)) {
        const { resolve, reject } = pending.get(id);
        pending.delete(id);

        if ('error' in message && message.error) {
            reject(new Error(message.error.message ?? 'Unknown MCP error'));
        } else {
            resolve(message.result);
        }
        return;
    }
    // Notifications are ignored
}
```

### parseJsonResponse(response)

**Purpose**: Parses JSON response and handles messages

```javascript
async function parseJsonResponse(response) {
    const data = await response.json();
    const messages = Array.isArray(data) ? data : [data];
    for (const message of messages) {
        handleJsonrpcMessage(message);
    }
}
```

### parseSseStream(stream)

**Purpose**: Parses SSE event stream for JSON-RPC messages

```javascript
async function parseSseStream(stream) {
    if (!stream) return;

    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        let boundaryIndex;
        while (
            (boundaryIndex = buffer.indexOf('\n\n')) !== -1 ||
            (boundaryIndex = buffer.indexOf('\r\n\r\n')) !== -1
        ) {
            const delimiterLength = buffer.startsWith('\r\n\r\n', boundaryIndex) ? 4 : 2;
            const rawEvent = buffer.slice(0, boundaryIndex);
            buffer = buffer.slice(boundaryIndex + delimiterLength);

            const eventLines = rawEvent.split(/\r?\n/);
            let eventId = null;
            const dataLines = [];

            for (const line of eventLines) {
                if (line.startsWith('id:')) {
                    eventId = line.slice(3).trimStart();
                } else if (line.startsWith('data:')) {
                    dataLines.push(line.slice(5).trimStart());
                }
            }

            if (dataLines.length === 0) continue;

            const payload = dataLines.join('\n');
            try {
                const parsed = JSON.parse(payload);
                if (Array.isArray(parsed)) {
                    for (const item of parsed) {
                        handleJsonrpcMessage(item);
                    }
                } else {
                    handleJsonrpcMessage(parsed);
                }
            } catch (error) {
                console.warn('Failed to parse SSE message', error);
            }
        }
    }
    // Handle remaining buffer
}
```

## SSE Stream Management

### ensureStreamTask()

**Purpose**: Establishes SSE connection for async responses

```javascript
function ensureStreamTask() {
    if (streamTask || streamUnsupported) return;

    if (abortController?.signal.aborted) {
        abortController = null;
    }

    if (!abortController) {
        abortController = new AbortController();
    }

    streamTask = (async () => {
        try {
            const headers = buildHeaders({ acceptStream: true });
            const response = await fetch(endpoint, {
                method: 'GET',
                headers,
                signal: abortController.signal
            });

            if (response.status === 405) {
                streamUnsupported = true;
                console.warn('[MCPBrowserClient] SSE stream not supported; falling back to POST responses.');
                return;
            }

            if (!response.ok) {
                throw new Error(`Failed to open MCP SSE stream: HTTP ${response.status}`);
            }

            await parseSseStream(response.body);
        } catch (error) {
            if (!abortController.signal.aborted) {
                console.warn('MCP SSE stream error', error);
            }
        } finally {
            streamTask = null;
        }
    })();
}
```

## Request/Response

### sendMessage(message)

**Purpose**: Sends JSON-RPC message via POST

```javascript
async function sendMessage(message) {
    const optimisticallyAccepted = message.id === undefined;
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: buildHeaders({ includeContentType: true }),
        body: JSON.stringify(message)
    });

    const receivedSession = response.headers.get('mcp-session-id');
    if (receivedSession) {
        sessionId = receivedSession;
    }

    const receivedProtocol = response.headers.get('mcp-protocol-version');
    if (receivedProtocol) {
        protocolVersion = receivedProtocol;
    }

    if (response.status === 202 || response.status === 204) {
        // Asynchronous response via SSE
        return;
    }

    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`MCP request failed: HTTP ${response.status}${text ? ` - ${text}` : ''}`);
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
        await parseJsonResponse(response);
        return;
    }

    if (contentType.includes('text/event-stream')) {
        await parseSseStream(response.body);
        return;
    }

    if (!optimisticallyAccepted) {
        throw new Error(`Unsupported MCP response content type: ${contentType || '<none>'}`);
    }
}
```

### sendRequest(method, params)

**Purpose**: Sends JSON-RPC request and awaits response

```javascript
async function sendRequest(method, params) {
    ensureStreamTask();

    const id = nextId();

    const deferred = {};
    const promise = new Promise((resolve, reject) => {
        deferred.resolve = resolve;
        deferred.reject = reject;
    });

    pending.set(id, deferred);

    try {
        await sendMessage({ jsonrpc: JSONRPC_VERSION, id, method, params });
    } catch (error) {
        pending.delete(id);
        deferred.reject(error);
    }

    return promise;
}
```

### sendNotification(method, params)

**Purpose**: Sends JSON-RPC notification (no response expected)

```javascript
async function sendNotification(method, params) {
    ensureStreamTask();
    await sendMessage({ jsonrpc: JSONRPC_VERSION, method, params });
}
```

## Public API

### connect()

**Purpose**: Initializes MCP session

```javascript
async function connect() {
    if (connected) return;

    ensureStreamTask();

    const initResult = await sendRequest('initialize', {
        protocolVersion: DEFAULT_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: {
            name: 'ploinky-router',
            version: '1.0.0'
        }
    });

    protocolVersion = initResult.protocolVersion ?? DEFAULT_PROTOCOL_VERSION;
    serverCapabilities = initResult.capabilities ?? null;
    serverInfo = initResult.serverInfo ?? null;
    instructions = initResult.instructions ?? null;

    await sendNotification('notifications/initialized');
    connected = true;
}
```

### listTools()

**Purpose**: Lists available tools

```javascript
async function listTools() {
    await connect();
    const result = await sendRequest('tools/list', {});
    return result?.tools ?? [];
}
```

### callTool(name, args)

**Purpose**: Invokes a tool with async task handling

```javascript
async function callTool(name, args) {
    await connect();
    const params = {
        name,
        arguments: args ?? {}
    };
    const result = await sendRequest('tools/call', params);

    // Check for async task
    const taskMetadata = result?.metadata && typeof result.metadata === 'object' ? result.metadata : null;
    const taskId = typeof taskMetadata?.taskId === 'string' && taskMetadata.taskId.trim().length
        ? taskMetadata.taskId.trim()
        : null;

    if (!taskId) {
        return result;
    }

    const statusAgent = typeof taskMetadata?.agent === 'string' && taskMetadata.agent.trim().length
        ? taskMetadata.agent.trim()
        : null;

    // Poll for async task completion
    const finalTask = await new Promise((resolve, reject) => {
        startTaskPolling(taskId, (task) => {
            if (!task) return;
            const status = typeof task.status === 'string' ? task.status.toLowerCase() : '';
            if (status === 'completed') {
                resolve(task);
            } else if (status === 'failed') {
                const error = new Error(task.error || 'Task failed');
                error.task = task;
                reject(error);
            }
        }, { statusPath: statusAgent ? `/mcps/${statusAgent}/task` : undefined });
    });

    const metadata = {
        ...finalTask.result.metadata,
        taskId: finalTask.id,
        toolName: finalTask.toolName,
        status: finalTask.status,
        createdAt: finalTask.createdAt,
        updatedAt: finalTask.updatedAt
    };
    return { content: finalTask.result.content, metadata };
}
```

### listResources()

**Purpose**: Lists available resources

```javascript
async function listResources() {
    await connect();
    const result = await sendRequest('resources/list', {});
    return result?.resources ?? [];
}
```

### readResource(uri, meta)

**Purpose**: Reads a resource by URI

```javascript
async function readResource(uri, meta) {
    await connect();
    const params = { uri };
    if (meta && typeof meta === 'object') {
        params._meta = meta;
    }
    const result = await sendRequest('resources/read', params);
    return result?.resource ?? result;
}
```

### ping(meta)

**Purpose**: Pings the MCP server

```javascript
async function ping(meta) {
    await connect();
    const params = meta && typeof meta === 'object' ? { _meta: meta } : undefined;
    return await sendRequest('ping', params);
}
```

### close()

**Purpose**: Closes connection and cleans up

```javascript
async function close() {
    if (abortController) {
        abortController.abort();
    }
    streamTask = null;
    abortController = null;
    streamUnsupported = false;

    try {
        if (sessionId) {
            await fetch(endpoint, {
                method: 'DELETE',
                headers: buildHeaders()
            });
        }
    } catch {
        // Ignore close errors
    }

    for (const { reject } of pending.values()) {
        reject(new Error('MCP client closed'));
    }
    pending.clear();

    stopAllTaskPollers();

    connected = false;
    sessionId = null;
    protocolVersion = null;
}
```

## Async Task Polling

### Task Status Path Resolution

```javascript
function resolveTaskStatusPath(pathname) {
    if (typeof pathname !== 'string' || pathname.length === 0) {
        return '/getTaskStatus';
    }
    let normalized = pathname;
    if (normalized.endsWith('/')) {
        normalized = normalized.slice(0, -1);
    }
    const match = normalized.match(/^(.*\/mcps\/[^/]+)\/mcp$/);
    if (match && match[1]) {
        return `${match[1]}/task`;
    }
    return '/getTaskStatus';
}
```

### fetchTaskStatus(taskId, poller)

**Purpose**: Fetches current task status

**Returns**: (Object) `{ state, task?, error? }`
- `state`: 'ok', 'not_found', 'http_error', 'network_error'

### startTaskPolling(taskId, callback, options)

**Purpose**: Starts polling for task completion

**Parameters**:
- `taskId` (string): Task identifier
- `callback` (Function): Called with task updates
- `options.statusPath` (string): Custom status endpoint path

### pollTaskStatus(taskId, callback)

**Purpose**: Single poll iteration with retry scheduling

```javascript
async function pollTaskStatus(taskId, callback) {
    const poller = taskPollers.get(taskId);
    if (!poller) return;

    try {
        const result = await fetchTaskStatus(taskId, poller);

        if (result.state === 'not_found') {
            stopTaskPoller(taskId);
            callback({ id: taskId, status: 'failed', error: 'task not found' });
            return;
        }

        if (result.task) {
            const task = result.task;
            const status = typeof task.status === 'string' ? task.status : null;
            const isTerminal = status === 'completed' || status === 'failed';
            if (poller.lastStatus !== status) {
                poller.lastStatus = status;
                callback(task);
            }
            if (isTerminal) {
                stopTaskPoller(taskId);
                return;
            }
        }
    } catch (error) {
        poller.lastError = error;
        console.warn('[MCPBrowserClient] Task status poll failed', error);
    }

    // Schedule next poll
    if (taskPollers.has(taskId)) {
        const timer = setTimeout(() => {
            void pollTaskStatus(taskId, callback);
        }, TASK_POLL_INTERVAL_MS);
        const pollerRef = taskPollers.get(taskId);
        if (pollerRef) {
            pollerRef.timer = timer;
        }
    }
}
```

### stopTaskPoller(taskId) / stopAllTaskPollers()

**Purpose**: Stops task polling timers

## Communication Flow

```
┌─────────────────────────────────────────────────────────┐
│                Browser MCP Client Flow                   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Browser                           Server               │
│     │                                 │                 │
│     │ POST initialize                 │                 │
│     ├────────────────────────────────►│                 │
│     │◄────────────────────────────────┤                 │
│     │ { sessionId, capabilities }     │                 │
│     │                                 │                 │
│     │ GET (SSE stream) [optional]     │                 │
│     ├────────────────────────────────►│                 │
│     │◄═══════════════════════════════ │ (keep-alive)   │
│     │                                 │                 │
│     │ POST tools/call                 │                 │
│     ├────────────────────────────────►│                 │
│     │◄────────────────────────────────┤                 │
│     │ { result } or { taskId }        │                 │
│     │                                 │                 │
│     │ [If async task]                 │                 │
│     │ GET /getTaskStatus?taskId=x     │                 │
│     ├────────────────────────────────►│                 │
│     │◄────────────────────────────────┤                 │
│     │ { task: { status, result } }    │ (poll every 30s)│
│     │                                 │                 │
│     │ DELETE (close session)          │                 │
│     ├────────────────────────────────►│                 │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## Error Handling

| Condition | Behavior |
|-----------|----------|
| HTTP error response | Throws Error with status and body |
| SSE 405 response | Disables streaming, uses POST responses |
| SSE stream error | Logs warning, continues without stream |
| Task not found | Stops polling, rejects with error |
| Network error | Logs warning, retries next poll interval |
| Client closed | Rejects all pending requests |

## Related Modules

- [agent-mcp-client.md](./agent-mcp-client.md) - Node.js version
- [../../cli/server/webchat/server-webchat-index.md](../../cli/server/webchat/server-webchat-index.md) - WebChat integration
