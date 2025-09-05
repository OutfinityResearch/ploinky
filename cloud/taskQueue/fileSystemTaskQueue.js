const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

/**
 * FileSystemTaskQueue - Default implementation using local file system
 * Implements the Strategy Pattern for task queue management
 */
class FileSystemTaskQueue {
    constructor(agentPath) {
        this.agentPath = agentPath;
        this.dirs = {
            requests: path.join(agentPath, '.tasks', 'requests'),
            responses: path.join(agentPath, '.tasks', 'responses'),
            errors: path.join(agentPath, '.tasks', 'errors'),
            locks: path.join(agentPath, '.tasks', 'locks'),
            urgent: path.join(agentPath, '.tasks', 'urgent')
        };
    }

    async init() {
        // Create all necessary directories
        for (const dir of Object.values(this.dirs)) {
            await fs.mkdir(dir, { recursive: true });
        }
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
            metadata: {
                ...metadata,
                enqueuedAt: new Date().toISOString()
            }
        };

        const taskPath = path.join(this.dirs.requests, taskId);
        await fs.writeFile(taskPath, JSON.stringify(task, null, 2));
        
        return taskId;
    }

    /**
     * Dequeue a task (get next pending task)
     */
    async dequeue() {
        try {
            const files = await fs.readdir(this.dirs.requests);
            if (files.length === 0) {
                return null;
            }

            // Get the oldest task
            const taskId = files[0];
            const lockAcquired = await this.acquireLock(taskId);
            
            if (!lockAcquired) {
                return null; // Another process got the lock
            }

            const taskPath = path.join(this.dirs.requests, taskId);
            const taskContent = await fs.readFile(taskPath, 'utf-8');
            const task = JSON.parse(taskContent);
            
            return task;
        } catch (err) {
            return null;
        }
    }

    /**
     * Mark a task as complete with response
     */
    async markComplete(taskId, response) {
        const responsePath = path.join(this.dirs.responses, taskId);
        const responseData = {
            taskId,
            response,
            completedAt: new Date().toISOString()
        };
        
        await fs.writeFile(responsePath, JSON.stringify(responseData, null, 2));
        
        // Remove request file and release lock
        await this.cleanup(taskId);
    }

    /**
     * Mark a task as failed with error
     */
    async markError(taskId, error) {
        const errorPath = path.join(this.dirs.errors, taskId);
        const errorData = {
            taskId,
            error: {
                error: true,
                message: error.message || error,
                code: error.code || 'UNKNOWN_ERROR',
                details: error.details || {},
                stack: error.stack
            },
            failedAt: new Date().toISOString()
        };
        
        await fs.writeFile(errorPath, JSON.stringify(errorData, null, 2));
        
        // Remove request file and release lock
        await this.cleanup(taskId);
    }

    /**
     * Cancel a task
     */
    async cancel(taskId) {
        // Create urgent cancellation marker
        const urgentPath = path.join(this.dirs.urgent, taskId);
        await fs.writeFile(urgentPath, '');
        
        // Try to remove from request queue
        try {
            const requestPath = path.join(this.dirs.requests, taskId);
            await fs.unlink(requestPath);
        } catch (err) {
            // Task might already be processing
        }
    }

    /**
     * Check for task response (polling)
     */
    async checkResponse(taskId, timeout = 30000) {
        const startTime = Date.now();
        const checkInterval = 100; // ms
        
        while (Date.now() - startTime < timeout) {
            // Check for normal response
            try {
                const responsePath = path.join(this.dirs.responses, taskId);
                const responseContent = await fs.readFile(responsePath, 'utf-8');
                const response = JSON.parse(responseContent);
                
                // Clean up response file
                await fs.unlink(responsePath);
                
                return {
                    success: true,
                    data: response.response
                };
            } catch (err) {
                // Response not ready yet
            }

            // Check for error response
            try {
                const errorPath = path.join(this.dirs.errors, taskId);
                const errorContent = await fs.readFile(errorPath, 'utf-8');
                const error = JSON.parse(errorContent);
                
                // Clean up error file
                await fs.unlink(errorPath);
                
                return {
                    success: false,
                    error: error.error
                };
            } catch (err) {
                // No error yet
            }

            // Check if cancelled
            try {
                const urgentPath = path.join(this.dirs.urgent, taskId);
                await fs.access(urgentPath);
                await fs.unlink(urgentPath);
                
                return {
                    success: false,
                    error: {
                        error: true,
                        message: 'Task was cancelled',
                        code: 'CANCELLED'
                    }
                };
            } catch (err) {
                // Not cancelled
            }

            // Wait before next check
            await new Promise(resolve => setTimeout(resolve, checkInterval));
        }

        // Timeout reached
        throw new Error(`Task ${taskId} timed out after ${timeout}ms`);
    }

    /**
     * Acquire lock for a task
     */
    async acquireLock(taskId) {
        const lockPath = path.join(this.dirs.locks, taskId);
        try {
            await fs.mkdir(lockPath);
            return true;
        } catch (err) {
            // Lock already exists
            return false;
        }
    }

    /**
     * Release lock for a task
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
     * Clean up task files
     */
    async cleanup(taskId) {
        // Remove request file
        try {
            const requestPath = path.join(this.dirs.requests, taskId);
            await fs.unlink(requestPath);
        } catch (err) {
            // File might already be removed
        }

        // Release lock
        await this.releaseLock(taskId);

        // Remove urgent marker if exists
        try {
            const urgentPath = path.join(this.dirs.urgent, taskId);
            await fs.unlink(urgentPath);
        } catch (err) {
            // No urgent marker
        }
    }

    /**
     * Generate unique task ID
     */
    generateTaskId() {
        const timestamp = Date.now();
        const random = crypto.randomBytes(8).toString('hex');
        return `${timestamp}_${random}`;
    }

    /**
     * Get queue statistics
     */
    async getStats() {
        const stats = {
            pending: 0,
            processing: 0,
            completed: 0,
            errors: 0
        };

        try {
            const requests = await fs.readdir(this.dirs.requests);
            stats.pending = requests.length;

            const locks = await fs.readdir(this.dirs.locks);
            stats.processing = locks.length;

            const responses = await fs.readdir(this.dirs.responses);
            stats.completed = responses.length;

            const errors = await fs.readdir(this.dirs.errors);
            stats.errors = errors.length;
        } catch (err) {
            // Directory might not exist yet
        }

        return stats;
    }

    /**
     * Clear all queues (for testing/reset)
     */
    async clear() {
        for (const dir of Object.values(this.dirs)) {
            try {
                const files = await fs.readdir(dir);
                for (const file of files) {
                    const filePath = path.join(dir, file);
                    const stat = await fs.stat(filePath);
                    if (stat.isDirectory()) {
                        await fs.rmdir(filePath);
                    } else {
                        await fs.unlink(filePath);
                    }
                }
            } catch (err) {
                // Directory might not exist
            }
        }
    }
}

module.exports = { FileSystemTaskQueue };