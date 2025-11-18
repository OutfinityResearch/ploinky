import { randomBytes } from 'node:crypto';
import fs from 'node:fs';

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
            if (task.status === 'pending') {
                this.pending.push(task.id);
            } else if (task.status === 'running') {
                task.status = 'pending';
                task.updatedAt = new Date().toISOString();
                this.pending.push(task.id);
                needsPersist = true;
            }
        }
        if (needsPersist) {
            this.persistTasks();
        }
        this.processQueue();
    }

    restoreFromDisk() {
        if (!this.storagePath) {
            return;
        }
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
                        result: entry.result ?? null
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

    persistTasks() {
        if (!this.storagePath) {
            return;
        }
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
                error: task.error,
                result: task.result
            }));
            fs.writeFileSync(this.storagePath, JSON.stringify(snapshot, null, 2));
        } catch (err) {
            console.error('[AgentServer/MCP] Failed to persist task queue:', err);
        }
    }

    generateId() {
        return randomBytes(8).toString('hex');
    }

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
        return { id: task.id, status: task.status };
    }

    processQueue() {
        while (this.running.size < this.maxConcurrent && this.pending.length > 0) {
            const nextId = this.pending.shift();
            if (!nextId) {
                continue;
            }
            const task = this.tasks.get(nextId);
            if (!task) {
                continue;
            }
            if (task.status !== 'pending') {
                continue;
            }
            this.startTask(task);
        }
    }

    startTask(task) {
        if (!task) {
            return;
        }
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
                task.result = { content };
                task.error = null;
            } else {
                const message = timedOut
                    ? `Task timed out after ${task.timeoutMs}ms`
                    : (result.stderr?.trim() || `command exited with code ${result.code}`);
                task.status = 'failed';
                task.error = message;
                task.result = {
                    stdout: result.stdout,
                    stderr: result.stderr
                };
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
}

