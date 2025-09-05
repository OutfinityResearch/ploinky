const path = require('path');
const crypto = require('crypto');
const { FileSystemTaskQueue } = require('../taskQueue/fileSystemTaskQueue');

class TaskOrchestrator {
    constructor(options) {
        this.workingDir = options.workingDir;
        this.config = options.config;
        this.taskQueues = new Map();
    }

    async init() {
        // Initialize task queues for existing deployments
        const deployments = await this.config.getDeployments();
        for (const deployment of deployments) {
            await this.initTaskQueue(deployment);
        }
    }

    async initTaskQueue(deployment) {
        const agentPath = deployment.agentPath || 
            path.join(this.workingDir, 'agents', deployment.domain, deployment.path);
        
        const queue = new FileSystemTaskQueue(agentPath);
        await queue.init();
        
        this.taskQueues.set(deployment.name, queue);
        return queue;
    }

    async createTask(options) {
        const { deployment, request, securityContext, query } = options;
        
        // Parse request body if present
        let body = '';
        if (request.method === 'POST' || request.method === 'PUT') {
            body = await this.readRequestBody(request);
        }

        // Extract command and parameters from request
        const { command, params } = this.parseRequest(request, body, query);

        // Inject security context
        const enhancedParams = [securityContext.userId, ...params];

        // Create task object
        const task = {
            id: this.generateTaskId(),
            deployment,
            command,
            params: enhancedParams,
            metadata: {
                method: request.method,
                url: request.url,
                headers: request.headers,
                timestamp: new Date().toISOString()
            }
        };

        return task;
    }

    async executeTask(task) {
        try {
            // Get or create task queue for this deployment
            let queue = this.taskQueues.get(task.deployment.name);
            if (!queue) {
                queue = await this.initTaskQueue(task.deployment);
            }

            // Enqueue the task
            const taskId = await queue.enqueue(task.command, task.params, task.metadata);

            // Wait for response
            const result = await queue.checkResponse(taskId);
            
            return result;
        } catch (error) {
            return {
                success: false,
                error: {
                    error: true,
                    message: error.message,
                    code: 'TASK_EXECUTION_ERROR'
                }
            };
        }
    }

    parseRequest(request, body, query) {
        const url = request.url;
        const pathParts = url.split('/').filter(Boolean);
        
        // Default command is the last part of the path
        let command = pathParts[pathParts.length - 1] || 'index';
        let params = [];

        // If body is JSON, parse it
        if (body) {
            try {
                const parsed = JSON.parse(body);
                if (parsed.command) {
                    command = parsed.command;
                }
                if (parsed.params) {
                    params = Array.isArray(parsed.params) ? parsed.params : [parsed.params];
                } else {
                    // Use all non-command fields as parameters
                    params = Object.entries(parsed)
                        .filter(([key]) => key !== 'command')
                        .map(([, value]) => value);
                }
            } catch (err) {
                // Body is not JSON, treat as single parameter
                params = [body];
            }
        }

        // Add query parameters
        if (query) {
            Object.values(query).forEach(value => {
                params.push(value);
            });
        }

        return { command, params };
    }

    readRequestBody(request) {
        return new Promise((resolve) => {
            let body = '';
            request.on('data', chunk => {
                body += chunk.toString();
            });
            request.on('end', () => {
                resolve(body);
            });
        });
    }

    generateTaskId() {
        return crypto.randomBytes(16).toString('hex') + '_' + Date.now();
    }

    async cancelTask(taskId, deploymentName) {
        const queue = this.taskQueues.get(deploymentName);
        if (queue) {
            await queue.cancel(taskId);
        }
    }
}

module.exports = { TaskOrchestrator };