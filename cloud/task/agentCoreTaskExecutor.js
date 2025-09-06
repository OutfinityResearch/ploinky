const path = require('path');
const fs = require('fs').promises;
const AgentCoreClient = require('../../agentCoreClient/lib/client');

/**
 * Task executor that uses AgentCoreClient to communicate with containers
 * via filesystem-based task queues
 */
class AgentCoreTaskExecutor {
    constructor(options = {}) {
        this.workingDir = options.workingDir;
        this.containerManager = options.containerManager;
        this.deploymentManager = options.deploymentManager;
        this.clients = new Map();
        this.taskTimeout = options.taskTimeout || 30000;
    }

    /**
     * Get or create an AgentCoreClient for a specific deployment
     */
    async getClient(deployment) {
        const agentPath = path.join(this.workingDir, 'agents', deployment.domain, deployment.path);
        const clientKey = `${deployment.domain}:${deployment.path}`;
        
        if (!this.clients.has(clientKey)) {
            const client = new AgentCoreClient(agentPath);
            await client.init();
            this.clients.set(clientKey, client);
        }
        
        return this.clients.get(clientKey);
    }

    /**
     * Execute a task using AgentCoreClient
     */
    async executeTask(deployment, task) {
        try {
            // Ensure container is running
            const containerName = await this.containerManager.ensureContainer(deployment);
            
            // Get or create client for this deployment
            const client = await this.getClient(deployment);
            
            // Enqueue the task
            const taskId = await client.enqueue(
                task.command,
                task.params,
                task.metadata
            );
            
            console.log(`[AgentCoreTaskExecutor] Task ${taskId} enqueued for ${deployment.domain}${deployment.path}`);
            
            // Wait for result
            const result = await client.waitForResult(taskId, this.taskTimeout);
            
            console.log(`[AgentCoreTaskExecutor] Task ${taskId} completed with success=${result.success}`);
            
            if (result.success) {
                return {
                    success: true,
                    taskId,
                    data: result.data
                };
            } else {
                return {
                    success: false,
                    taskId,
                    error: result.error
                };
            }
            
        } catch (error) {
            console.error(`[AgentCoreTaskExecutor] Task execution error:`, error);
            
            return {
                success: false,
                error: {
                    message: error.message,
                    code: 'TASK_EXECUTION_ERROR'
                }
            };
        }
    }

    /**
     * Execute a task and return immediately without waiting
     */
    async executeTaskAsync(deployment, task) {
        try {
            // Ensure container is running
            await this.containerManager.ensureContainer(deployment);
            
            // Get or create client for this deployment
            const client = await this.getClient(deployment);
            
            // Enqueue the task
            const taskId = await client.enqueue(
                task.command,
                task.params,
                task.metadata
            );
            
            console.log(`[AgentCoreTaskExecutor] Task ${taskId} enqueued (async) for ${deployment.domain}${deployment.path}`);
            
            return {
                success: true,
                taskId,
                status: 'queued'
            };
            
        } catch (error) {
            console.error(`[AgentCoreTaskExecutor] Async task execution error:`, error);
            
            return {
                success: false,
                error: {
                    message: error.message,
                    code: 'TASK_ENQUEUE_ERROR'
                }
            };
        }
    }

    /**
     * Check the status of a task
     */
    async checkTaskStatus(deployment, taskId) {
        try {
            const client = await this.getClient(deployment);
            
            const queuePath = path.join(client.queuePath);
            const taskPath = path.join(queuePath, 'tasks', taskId);
            const resultPath = path.join(queuePath, 'results', taskId);
            const errorPath = path.join(queuePath, 'errors', taskId);
            
            // Check if still in queue
            try {
                await fs.access(taskPath);
                return { status: 'queued', taskId };
            } catch {}
            
            // Check if result exists
            try {
                const result = await fs.readFile(resultPath, 'utf-8');
                return { 
                    status: 'completed', 
                    taskId,
                    success: true,
                    data: JSON.parse(result)
                };
            } catch {}
            
            // Check if error exists
            try {
                const error = await fs.readFile(errorPath, 'utf-8');
                return { 
                    status: 'failed', 
                    taskId,
                    success: false,
                    error: JSON.parse(error)
                };
            } catch {}
            
            return { status: 'unknown', taskId };
            
        } catch (error) {
            return { 
                status: 'error', 
                taskId,
                error: error.message
            };
        }
    }

    /**
     * Clean up clients
     */
    async cleanup() {
        this.clients.clear();
    }
}

module.exports = { AgentCoreTaskExecutor };