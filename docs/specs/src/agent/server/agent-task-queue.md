# Agent/server/TaskQueue.mjs - Async Task Queue

## Overview

Persistent asynchronous task queue for MCP agent tools. Manages task lifecycle from pending through running to completed/failed states with disk persistence, concurrent execution limits, and timeout handling.

## Source File

`Agent/server/TaskQueue.mjs`

## Dependencies

```javascript
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
```

## Class Definition

### TaskQueue

```javascript
export class TaskQueue {
    constructor({ maxConcurrent = 10, storagePath, executor }) {
        if (typeof executor !== 'function') {
            throw new Error('TaskQueue requires an executor function');
        }
        this.maxConcurrent = maxConcurrent;
        this.storagePath = storagePath;
        this.executor = executor;
        this.tasks = new Map();
        this.pending = [];
        this.running = new Set();
        this.initialized = false;
    }
}
```

**Constructor Parameters**:
- `maxConcurrent` (number): Maximum concurrent tasks (default: 10)
- `storagePath` (string): Path for persistent task storage
- `executor` (Function): Task execution function `(spec, payload, options) => Promise`

**Instance Properties**:
- `tasks` (Map<string, Task>): All known tasks by ID
- `pending` (Array<string>): Queue of pending task IDs
- `running` (Set<string>): Currently executing task IDs
- `initialized` (boolean): Whether queue has been initialized

## Task Data Structure

```javascript
/**
 * @typedef {Object} Task
 * @property {string} id - Unique task identifier (16 hex chars)
 * @property {string} toolName - Name of the tool being executed
 * @property {Object} commandSpec - Command specification
 * @property {string} commandSpec.command - Path to executable
 * @property {string} commandSpec.cwd - Working directory
 * @property {Object} commandSpec.env - Environment variables
 * @property {number} [commandSpec.timeoutMs] - Execution timeout
 * @property {Object} payload - Tool invocation payload
 * @property {string} status - 'pending' | 'running' | 'completed' | 'failed'
 * @property {number|null} timeoutMs - Task-level timeout
 * @property {string} createdAt - ISO timestamp
 * @property {string} updatedAt - ISO timestamp
 * @property {string|null} error - Error message if failed
 * @property {Object|null} result - Execution result if completed
 */
```

## Public API

### initialize()

**Purpose**: Initializes queue, restores from disk, marks interrupted tasks as failed

**Implementation**:
```javascript
initialize() {
    if (this.initialized) {
        return;
    }
    this.initialized = true;
    this.restoreFromDisk();

    let needsPersist = false;
    const restartable = [...this.tasks.values()].sort((a, b) => {
        const aTime = Date.parse(a.createdAt || 0);
        const bTime = Date.parse(b.createdAt || 0);
        return aTime - bTime;
    });

    for (const task of restartable) {
        if (task.status === 'pending' || task.status === 'running') {
            task.status = 'failed';
            task.error = 'Task interrupted before completion (agent restart)';
            task.updatedAt = new Date().toISOString();
            task.result = null;
            needsPersist = true;
        }
    }

    if (needsPersist) {
        this.persistTasks();
    }
    this.processQueue();
}
```

### enqueueTask(options)

**Purpose**: Adds new task to queue

**Parameters**:
- `options.toolName` (string): Tool identifier
- `options.commandSpec` (Object): Command specification
- `options.payload` (Object): Tool invocation payload
- `options.timeoutMs` (number): Optional timeout in milliseconds

**Returns**: (Object) Task info `{ id, toolName, status, createdAt, updatedAt }`

```javascript
enqueueTask({ toolName, commandSpec, payload, timeoutMs }) {
    this.initialize();
    const id = this.generateId();
    const payloadWithId = { ...payload, taskId: id };
    const task = {
        id,
        toolName,
        commandSpec: {
            command: commandSpec.command,
            cwd: commandSpec.cwd,
            env: { ...(commandSpec.env || {}) },
            timeoutMs: commandSpec.timeoutMs
        },
        payload: payloadWithId,
        timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : null,
        status: 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        error: null,
        result: null
    };
    this.tasks.set(task.id, task);
    this.pending.push(task.id);
    this.persistTasks();
    this.processQueue();
    return {
        id: task.id,
        toolName: task.toolName,
        status: task.status,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt
    };
}
```

### getTask(taskId)

**Purpose**: Retrieves task status and result

**Parameters**:
- `taskId` (string): Task identifier

**Returns**: (Object|null) Task info or null

```javascript
getTask(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) {
        return null;
    }
    return {
        id: task.id,
        toolName: task.toolName,
        status: task.status,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        error: task.error,
        result: task.result
    };
}
```

## Internal Methods

### generateId()

**Purpose**: Generates unique 16-character hex task ID

```javascript
generateId() {
    return randomBytes(8).toString('hex');
}
```

### processQueue()

**Purpose**: Starts pending tasks up to max concurrent limit

```javascript
processQueue() {
    while (this.running.size < this.maxConcurrent && this.pending.length > 0) {
        const nextId = this.pending.shift();
        if (!nextId) continue;
        const task = this.tasks.get(nextId);
        if (!task) continue;
        if (task.status !== 'pending') continue;
        this.startTask(task);
    }
}
```

### startTask(task)

**Purpose**: Transitions task to running and executes

```javascript
startTask(task) {
    if (!task) return;
    task.status = 'running';
    task.updatedAt = new Date().toISOString();
    this.running.add(task.id);
    this.persistTasks();

    const runPromise = this.executeTask(task);
    runPromise.finally(() => {
        this.running.delete(task.id);
        if (task.status === 'pending') {
            if (!this.pending.includes(task.id)) {
                this.pending.push(task.id);
            }
        }
        this.processQueue();
    }).catch((err) => {
        console.error('[AgentServer/MCP] Task execution failed:', err);
    });
}
```

### executeTask(task)

**Purpose**: Executes task with timeout handling

```javascript
async executeTask(task) {
    let timer = null;
    let timedOut = false;
    try {
        if (!task.commandSpec || !task.commandSpec.command) {
            throw new Error('Missing command specification for task');
        }

        const result = await this.executor(task.commandSpec, task.payload, {
            onSpawn: (child) => {
                if (Number.isFinite(task.timeoutMs) && task.timeoutMs > 0) {
                    timer = setTimeout(() => {
                        if (!child.killed) {
                            timedOut = true;
                            try {
                                child.kill('SIGKILL');
                            } catch (err) {
                                console.error('[AgentServer/MCP] Failed to kill timed-out task:', err);
                            }
                        }
                    }, task.timeoutMs);
                }
            }
        });

        if (timer) {
            clearTimeout(timer);
        }

        const success = !timedOut && result.code === 0;
        if (success) {
            const textOut = result.stdout?.length ? result.stdout : '(no output)';
            const content = [{ type: 'text', text: textOut }];
            if (result.stderr && result.stderr.trim()) {
                content.push({ type: 'text', text: `stderr:\n${result.stderr}` });
            }
            task.status = 'completed';
            task.result = {
                content,
                metadata: { agent: process.env.AGENT_NAME || task.toolName }
            };
            task.error = null;
        } else {
            const message = timedOut
                ? `Task timed out after ${task.timeoutMs}ms`
                : (result.stderr?.trim() || `command exited with code ${result.code}`);
            task.status = 'failed';
            task.error = message;
            task.result = null;
        }
    } catch (err) {
        if (timer) {
            clearTimeout(timer);
        }
        task.status = 'failed';
        task.error = err?.message || 'Task execution failed';
        task.result = null;
    } finally {
        task.updatedAt = new Date().toISOString();
        this.persistTasks();
    }
}
```

### restoreFromDisk()

**Purpose**: Loads persisted tasks from storage file

```javascript
restoreFromDisk() {
    if (!this.storagePath) return;
    try {
        const raw = fs.readFileSync(this.storagePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            for (const entry of parsed) {
                if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string') {
                    continue;
                }
                const task = {
                    id: entry.id,
                    toolName: entry.toolName,
                    commandSpec: entry.commandSpec,
                    payload: entry.payload,
                    status: entry.status || 'pending',
                    timeoutMs: entry.timeoutMs ?? null,
                    createdAt: entry.createdAt || new Date().toISOString(),
                    updatedAt: entry.updatedAt || entry.createdAt || new Date().toISOString(),
                    error: entry.error ?? null,
                    result: null
                };
                this.tasks.set(task.id, task);
            }
        }
    } catch (err) {
        if (err?.code !== 'ENOENT') {
            console.error('[AgentServer/MCP] Failed to restore task queue:', err);
        }
    }
}
```

### persistTasks()

**Purpose**: Saves current tasks to storage file

```javascript
persistTasks() {
    if (!this.storagePath) return;
    try {
        const snapshot = [...this.tasks.values()].map(task => ({
            id: task.id,
            toolName: task.toolName,
            commandSpec: task.commandSpec,
            payload: task.payload,
            status: task.status,
            timeoutMs: task.timeoutMs,
            createdAt: task.createdAt,
            updatedAt: task.updatedAt,
            error: task.error
        }));
        fs.writeFileSync(this.storagePath, JSON.stringify(snapshot, null, 2));
    } catch (err) {
        console.error('[AgentServer/MCP] Failed to persist task queue:', err);
    }
}
```

## Task States

```
┌─────────────────────────────────────────────────────────┐
│                    Task Lifecycle                        │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  enqueueTask()                                          │
│       │                                                 │
│       ▼                                                 │
│   ┌─────────┐                                           │
│   │ pending │ ──────────────────────────────────────┐   │
│   └────┬────┘                                       │   │
│        │ processQueue() [if slots available]        │   │
│        ▼                                            │   │
│   ┌─────────┐                                       │   │
│   │ running │                                       │   │
│   └────┬────┘                                       │   │
│        │                                            │   │
│        ├──────────────┬─────────────────────────────┤   │
│        │ exit 0       │ exit != 0 / timeout / error │   │
│        ▼              ▼                             │   │
│   ┌───────────┐  ┌─────────┐                        │   │
│   │ completed │  │ failed  │◄───────────────────────┘   │
│   └───────────┘  └─────────┘     (on restart)           │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## Storage Format

File: `.tasksQueue` (in process.cwd())

```json
[
    {
        "id": "a1b2c3d4e5f6g7h8",
        "toolName": "my-tool",
        "commandSpec": {
            "command": "/code/tool.sh",
            "cwd": "/code",
            "env": {},
            "timeoutMs": null
        },
        "payload": {
            "tool": "my-tool",
            "input": { "arg": "value" },
            "metadata": {},
            "taskId": "a1b2c3d4e5f6g7h8"
        },
        "status": "completed",
        "timeoutMs": 60000,
        "createdAt": "2024-01-01T00:00:00.000Z",
        "updatedAt": "2024-01-01T00:00:05.000Z",
        "error": null
    }
]
```

## Result Format

Completed tasks include MCP-compatible result:

```javascript
{
    content: [
        { type: 'text', text: 'Command output' },
        { type: 'text', text: 'stderr:\nWarning message' }
    ],
    metadata: {
        agent: 'agent-name'
    }
}
```

## Concurrency Control

- `maxConcurrent` limits simultaneous `running` tasks
- `processQueue()` called after each task completes
- Pending queue processed FIFO
- Tasks not re-queued on failure (except restart detection)

## Error Handling

| Condition | Behavior |
|-----------|----------|
| Command exits non-zero | Status: `failed`, error: stderr or exit code |
| Timeout exceeded | Status: `failed`, error: timeout message, child SIGKILL |
| Execution exception | Status: `failed`, error: exception message |
| Agent restart | All running/pending tasks marked `failed` |
| Storage read error (ENOENT) | Silently ignored |
| Storage read error (other) | Logged, continue without persistence |

## Related Modules

- [agent-server.md](./agent-server.md) - Uses TaskQueue for async tools
