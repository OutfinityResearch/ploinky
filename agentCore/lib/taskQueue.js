const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

/**
 * Task Queue Interface for Ploinky Agents
 */
class TaskQueue {
    constructor(basePath) {
        this.basePath = basePath;
        this.dirs = {
            requests: path.join(basePath, '.tasks', 'requests'),
            responses: path.join(basePath, '.tasks', 'responses'),
            errors: path.join(basePath, '.tasks', 'errors'),
            locks: path.join(basePath, '.tasks', 'locks'),
            urgent: path.join(basePath, '.tasks', 'urgent')
        };
    }

    async init() {
        // Create all necessary directories
        for (const dir of Object.values(this.dirs)) {
            await fs.mkdir(dir, { recursive: true });
        }
    }

    /**
     * Generate a unique task ID
     */
    generateTaskId() {
        return crypto.randomBytes(16).toString('hex') + '_' + Date.now();
    }

    /**
     * Enqueue a new task
     */
    async enqueue(command, params = [], metadata = {}) {
        const taskId = this.generateTaskId();
        const task = {
            id: taskId,
            command,
            params,
            metadata,
            timestamp: new Date().toISOString()
        };

        const taskPath = path.join(this.dirs.requests, taskId);
        await fs.writeFile(taskPath, JSON.stringify(task, null, 2));
        
        return taskId;
    }

    /**
     * Check if a task is complete
     */
    async checkResponse(taskId, timeout = 30000) {
        const startTime = Date.now();
        
        while (Date.now() - startTime < timeout) {
            // Check for response
            const responsePath = path.join(this.dirs.responses, taskId);
            try {
                const response = await fs.readFile(responsePath, 'utf-8');
                await fs.unlink(responsePath); // Clean up
                return { success: true, data: JSON.parse(response) };
            } catch (err) {
                // Response not ready yet
            }

            // Check for error
            const errorPath = path.join(this.dirs.errors, taskId);
            try {
                const error = await fs.readFile(errorPath, 'utf-8');
                await fs.unlink(errorPath); // Clean up
                return { success: false, error: JSON.parse(error) };
            } catch (err) {
                // No error yet
            }

            // Wait a bit before checking again
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        throw new Error(`Task ${taskId} timed out after ${timeout}ms`);
    }

    /**
     * Cancel a task
     */
    async cancel(taskId) {
        const urgentPath = path.join(this.dirs.urgent, taskId);
        await fs.writeFile(urgentPath, '');
    }

    /**
     * Acquire a lock for a task
     */
    async acquireLock(taskId) {
        const lockPath = path.join(this.dirs.locks, taskId);
        try {
            await fs.mkdir(lockPath);
            return true;
        } catch (err) {
            return false;
        }
    }

    /**
     * Release a lock for a task
     */
    async releaseLock(taskId) {
        const lockPath = path.join(this.dirs.locks, taskId);
        try {
            await fs.rmdir(lockPath);
        } catch (err) {
            // Lock might already be released
        }
    }

    /**
     * Get pending tasks
     */
    async getPendingTasks() {
        try {
            const files = await fs.readdir(this.dirs.requests);
            return files;
        } catch (err) {
            return [];
        }
    }

    /**
     * Process a single task (for Node.js agents)
     */
    async processTask(taskId, handler) {
        const requestPath = path.join(this.dirs.requests, taskId);
        
        try {
            // Acquire lock
            const locked = await this.acquireLock(taskId);
            if (!locked) {
                return false; // Another process is handling this task
            }

            // Read task
            const taskContent = await fs.readFile(requestPath, 'utf-8');
            const task = JSON.parse(taskContent);

            // Execute handler
            try {
                const response = await handler(task.command, task.params, task.metadata);
                const responsePath = path.join(this.dirs.responses, taskId);
                await fs.writeFile(responsePath, JSON.stringify(response));
            } catch (error) {
                const errorPath = path.join(this.dirs.errors, taskId);
                await fs.writeFile(errorPath, JSON.stringify({
                    error: true,
                    message: error.message,
                    code: error.code || 'HANDLER_ERROR',
                    details: error.details || {}
                }));
            }

            // Clean up
            await fs.unlink(requestPath);
            await this.releaseLock(taskId);
            
            return true;
        } catch (err) {
            await this.releaseLock(taskId);
            throw err;
        }
    }
}

module.exports = TaskQueue;