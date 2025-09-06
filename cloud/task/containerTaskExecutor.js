const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const { spawn } = require('child_process');

class ContainerTaskExecutor {
    constructor(options = {}) {
        this.workingDir = options.workingDir;
        this.containerManager = options.containerManager;
        this.deploymentManager = options.deploymentManager;
        this.taskTimeout = options.taskTimeout || 300000; // 5 minutes default
        this.pendingTasks = new Map();
    }

    async executeTask(deployment, task) {
        const taskId = this.generateTaskId();
        const containerName = await this.containerManager.ensureContainer(deployment);
        
        const agentPath = path.join(this.workingDir, 'agents', deployment.domain, deployment.path);
        const tasksPath = path.join(agentPath, 'tasks');
        const responsesPath = path.join(agentPath, 'responses');
        
        const taskFile = path.join(tasksPath, `${taskId}.json`);
        const responseFile = path.join(responsesPath, `${taskId}.json`);
        
        const taskData = {
            id: taskId,
            command: task.command,
            params: task.params,
            metadata: task.metadata || {},
            createdAt: new Date().toISOString()
        };
        
        await fs.writeFile(taskFile, JSON.stringify(taskData, null, 2));
        
        const execCommand = [
            'exec',
            containerName,
            '/coreAgent/runTask.sh',
            taskId,
            task.command,
            ...task.params.map(p => JSON.stringify(p))
        ];
        
        const runtime = this.containerManager.runtime;
        
        try {
            const result = await this.execInContainer(runtime, execCommand, this.taskTimeout);
            
            let response;
            try {
                const responseData = await fs.readFile(responseFile, 'utf-8');
                response = JSON.parse(responseData);
            } catch {
                response = { output: result, success: true };
            }
            
            await this.cleanup(taskFile, responseFile);
            
            return {
                success: true,
                taskId,
                data: response
            };
            
        } catch (error) {
            await this.cleanup(taskFile, responseFile);
            
            return {
                success: false,
                taskId,
                error: {
                    message: error.message,
                    code: 'TASK_EXECUTION_ERROR'
                }
            };
        }
    }

    async execInContainer(runtime, args, timeout) {
        return new Promise((resolve, reject) => {
            const proc = spawn(runtime, args);
            let stdout = '';
            let stderr = '';
            let timedOut = false;
            
            const timer = setTimeout(() => {
                timedOut = true;
                proc.kill('SIGTERM');
                setTimeout(() => proc.kill('SIGKILL'), 5000);
            }, timeout);
            
            proc.stdout.on('data', data => stdout += data);
            proc.stderr.on('data', data => stderr += data);
            
            proc.on('close', code => {
                clearTimeout(timer);
                
                if (timedOut) {
                    reject(new Error('Task execution timeout'));
                } else if (code === 0) {
                    resolve(stdout.trim());
                } else {
                    reject(new Error(`Task failed: ${stderr || stdout}`));
                }
            });
        });
    }

    async createTaskQueue(deployment) {
        const agentPath = path.join(this.workingDir, 'agents', deployment.domain, deployment.path);
        const queuePath = path.join(agentPath, 'queue');
        
        await fs.mkdir(queuePath, { recursive: true });
        
        return {
            async enqueue(task) {
                const taskId = crypto.randomBytes(16).toString('hex');
                const taskFile = path.join(queuePath, `${taskId}.json`);
                
                await fs.writeFile(taskFile, JSON.stringify({
                    ...task,
                    id: taskId,
                    status: 'pending',
                    enqueuedAt: new Date().toISOString()
                }, null, 2));
                
                return taskId;
            },
            
            async dequeue() {
                const files = await fs.readdir(queuePath);
                const taskFiles = files.filter(f => f.endsWith('.json'));
                
                if (taskFiles.length === 0) {
                    return null;
                }
                
                taskFiles.sort();
                const taskFile = path.join(queuePath, taskFiles[0]);
                
                try {
                    const data = await fs.readFile(taskFile, 'utf-8');
                    const task = JSON.parse(data);
                    
                    if (task.status === 'pending') {
                        task.status = 'processing';
                        task.startedAt = new Date().toISOString();
                        await fs.writeFile(taskFile, JSON.stringify(task, null, 2));
                        return task;
                    }
                } catch (err) {
                    console.error('Failed to dequeue task:', err);
                }
                
                return null;
            },
            
            async complete(taskId, result) {
                const taskFile = path.join(queuePath, `${taskId}.json`);
                
                try {
                    const data = await fs.readFile(taskFile, 'utf-8');
                    const task = JSON.parse(data);
                    
                    task.status = 'completed';
                    task.completedAt = new Date().toISOString();
                    task.result = result;
                    
                    const completedPath = path.join(agentPath, 'completed');
                    await fs.mkdir(completedPath, { recursive: true });
                    
                    await fs.writeFile(
                        path.join(completedPath, `${taskId}.json`),
                        JSON.stringify(task, null, 2)
                    );
                    
                    await fs.unlink(taskFile);
                } catch (err) {
                    console.error('Failed to complete task:', err);
                }
            }
        };
    }

    generateTaskId() {
        return crypto.randomBytes(16).toString('hex') + '_' + Date.now();
    }

    async cleanup(taskFile, responseFile) {
        try {
            await fs.unlink(taskFile);
        } catch {}
        
        try {
            await fs.unlink(responseFile);
        } catch {}
    }

    async getTaskStatus(taskId) {
        return this.pendingTasks.get(taskId) || { status: 'unknown' };
    }
}

module.exports = { ContainerTaskExecutor };