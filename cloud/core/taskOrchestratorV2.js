const path = require('path');
const crypto = require('crypto');
const { AgentCoreTaskExecutor } = require('../task/agentCoreTaskExecutor');
const { DeploymentManager } = require('../deployment/deploymentManager');

class TaskOrchestratorV2 {
    constructor(options) {
        this.workingDir = options.workingDir;
        this.config = options.config;
        
        this.deploymentManager = new DeploymentManager({
            workingDir: this.workingDir,
            config: this.config
        });
        
        this.taskExecutor = new AgentCoreTaskExecutor({
            workingDir: this.workingDir,
            containerManager: this.deploymentManager.containerManager,
            deploymentManager: this.deploymentManager
        });
        
        this.activeTasks = new Map();
    }

    async init() {
        await this.deploymentManager.init();
    }

    async createTask(options) {
        const { deployment, request, securityContext, query } = options;
        
        let body = '';
        if (request.method === 'POST' || request.method === 'PUT') {
            body = await this.readRequestBody(request);
        }

        const { command, params } = this.parseRequest(request, body, query);
        const enhancedParams = [securityContext.userId, ...params];

        const task = {
            id: this.generateTaskId(),
            deployment,
            command,
            params: enhancedParams,
            metadata: {
                method: request.method,
                url: request.url,
                headers: request.headers,
                timestamp: new Date().toISOString(),
                securityContext
            }
        };

        return task;
    }

    async executeTask(task) {
        try {
            this.activeTasks.set(task.id, {
                task,
                status: 'running',
                startTime: Date.now()
            });
            
            const deployment = this.deploymentManager.getDeployment(
                task.deployment.domain,
                task.deployment.path
            );
            
            if (!deployment) {
                throw new Error('Deployment not found');
            }
            
            const result = await this.taskExecutor.executeTask(deployment, task);
            
            this.activeTasks.delete(task.id);
            
            return result;
            
        } catch (error) {
            this.activeTasks.delete(task.id);
            
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
        
        let command = pathParts[pathParts.length - 1] || 'index';
        let params = [];

        if (body) {
            try {
                const parsed = JSON.parse(body);
                if (parsed.command) {
                    command = parsed.command;
                }
                if (parsed.params) {
                    params = Array.isArray(parsed.params) ? parsed.params : [parsed.params];
                } else {
                    params = Object.entries(parsed)
                        .filter(([key]) => key !== 'command')
                        .map(([, value]) => value);
                }
            } catch {
                params = [body];
            }
        }

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

    async getTaskStatus(taskId) {
        const activeTask = this.activeTasks.get(taskId);
        if (activeTask) {
            return {
                id: taskId,
                status: activeTask.status,
                duration: Date.now() - activeTask.startTime
            };
        }
        return { id: taskId, status: 'unknown' };
    }

    async cancelTask(taskId) {
        const activeTask = this.activeTasks.get(taskId);
        if (activeTask) {
            // TODO: Implement task cancellation in container
            this.activeTasks.delete(taskId);
            return { success: true, message: 'Task cancelled' };
        }
        return { success: false, message: 'Task not found' };
    }

    getActiveTasks() {
        return Array.from(this.activeTasks.values()).map(t => ({
            id: t.task.id,
            command: t.task.command,
            status: t.status,
            duration: Date.now() - t.startTime
        }));
    }

    async stop() {
        await this.deploymentManager.stopAll();
    }
}

module.exports = { TaskOrchestratorV2 };