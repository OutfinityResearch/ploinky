const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');

/**
 * AgentSupervisor - Monitors and manages agent container lifecycle
 */
class AgentSupervisor {
    constructor(options = {}) {
        this.workingDir = options.workingDir;
        this.config = options.config;
        this.agents = new Map(); // agentId -> agentProcess
        this.healthCheckInterval = options.healthCheckInterval || 30000; // 30 seconds
        this.restartAttempts = new Map(); // agentId -> attempt count
        this.maxRestartAttempts = options.maxRestartAttempts || 3;
    }

    async init() {
        // Start health check monitoring
        this.startHealthMonitoring();
        
        // Load and start existing deployments
        await this.startExistingAgents();
    }

    /**
     * Start an agent container
     */
    async startAgent(deployment) {
        const agentId = deployment.name;
        
        if (this.agents.has(agentId)) {
            console.log(`[Supervisor] Agent ${agentId} is already running`);
            return;
        }

        try {
            const agentPath = deployment.agentPath || 
                path.join(this.workingDir, 'agents', deployment.domain, deployment.path);
            
            // Ensure agent directory exists
            await fs.mkdir(agentPath, { recursive: true });
            
            // Load manifest if exists
            const manifestPath = path.join(agentPath, 'manifest.json');
            let manifest = {};
            try {
                const manifestData = await fs.readFile(manifestPath, 'utf-8');
                manifest = JSON.parse(manifestData);
            } catch (err) {
                // No manifest yet
            }

            // Prepare container command
            const containerImage = manifest.container || 'docker.io/library/node:18-alpine';
            const runCommand = manifest.run || '/agentCore/run.sh';
            
            // Build podman/docker command
            const containerCmd = this.getContainerCommand();
            const args = [
                'run',
                '-d', // Detached
                '--name', `ploinky-${agentId}`,
                '-v', `${agentPath}:/agent`,
                '-v', `${path.join(this.workingDir, 'agentCore')}:/agentCore:ro`,
                '-e', `AGENT_DIR=/agent`,
                containerImage,
                runCommand
            ];

            console.log(`[Supervisor] Starting agent ${agentId} with ${containerCmd}`);
            
            // Start the container
            const agentProcess = spawn(containerCmd, args, {
                stdio: 'inherit'
            });

            this.agents.set(agentId, {
                process: agentProcess,
                deployment,
                startTime: Date.now(),
                restarts: 0
            });

            // Handle process exit
            agentProcess.on('exit', (code, signal) => {
                console.log(`[Supervisor] Agent ${agentId} exited with code ${code}, signal ${signal}`);
                this.handleAgentExit(agentId);
            });

            console.log(`[Supervisor] Agent ${agentId} started successfully`);
            
        } catch (err) {
            console.error(`[Supervisor] Failed to start agent ${agentId}:`, err);
            throw err;
        }
    }

    /**
     * Stop an agent container
     */
    async stopAgent(agentId) {
        const agent = this.agents.get(agentId);
        if (!agent) {
            console.log(`[Supervisor] Agent ${agentId} is not running`);
            return;
        }

        try {
            const containerCmd = this.getContainerCommand();
            
            // Stop the container
            const stopProcess = spawn(containerCmd, ['stop', `ploinky-${agentId}`]);
            
            await new Promise((resolve, reject) => {
                stopProcess.on('exit', (code) => {
                    if (code === 0) resolve();
                    else reject(new Error(`Failed to stop container: exit code ${code}`));
                });
            });

            // Remove the container
            const rmProcess = spawn(containerCmd, ['rm', `ploinky-${agentId}`]);
            
            await new Promise((resolve) => {
                rmProcess.on('exit', () => resolve());
            });

            this.agents.delete(agentId);
            console.log(`[Supervisor] Agent ${agentId} stopped successfully`);
            
        } catch (err) {
            console.error(`[Supervisor] Failed to stop agent ${agentId}:`, err);
            throw err;
        }
    }

    /**
     * Restart an agent
     */
    async restartAgent(agentId) {
        const agent = this.agents.get(agentId);
        if (!agent) {
            console.log(`[Supervisor] Agent ${agentId} not found for restart`);
            return;
        }

        console.log(`[Supervisor] Restarting agent ${agentId}`);
        
        await this.stopAgent(agentId);
        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
        await this.startAgent(agent.deployment);
    }

    /**
     * Check agent health
     */
    async checkAgentHealth(agentId) {
        const agent = this.agents.get(agentId);
        if (!agent) {
            return false;
        }

        try {
            const containerCmd = this.getContainerCommand();
            
            // Check if container is running
            const inspectProcess = spawn(containerCmd, [
                'inspect', 
                `ploinky-${agentId}`,
                '--format', 
                '{{.State.Running}}'
            ]);

            const output = await new Promise((resolve) => {
                let data = '';
                inspectProcess.stdout.on('data', (chunk) => {
                    data += chunk.toString();
                });
                inspectProcess.on('exit', () => {
                    resolve(data.trim());
                });
            });

            return output === 'true';
            
        } catch (err) {
            console.error(`[Supervisor] Health check failed for ${agentId}:`, err);
            return false;
        }
    }

    /**
     * Handle agent process exit
     */
    async handleAgentExit(agentId) {
        const agent = this.agents.get(agentId);
        if (!agent) return;

        // Update restart attempts
        const attempts = (this.restartAttempts.get(agentId) || 0) + 1;
        this.restartAttempts.set(agentId, attempts);

        if (attempts <= this.maxRestartAttempts) {
            console.log(`[Supervisor] Attempting to restart ${agentId} (attempt ${attempts}/${this.maxRestartAttempts})`);
            
            // Wait before restarting
            await new Promise(resolve => setTimeout(resolve, 5000 * attempts)); // Exponential backoff
            
            try {
                await this.restartAgent(agentId);
                // Reset attempts on successful restart
                this.restartAttempts.delete(agentId);
            } catch (err) {
                console.error(`[Supervisor] Failed to restart ${agentId}:`, err);
            }
        } else {
            console.error(`[Supervisor] Agent ${agentId} exceeded max restart attempts`);
            this.agents.delete(agentId);
            this.restartAttempts.delete(agentId);
        }
    }

    /**
     * Start health monitoring
     */
    startHealthMonitoring() {
        setInterval(async () => {
            for (const [agentId] of this.agents) {
                const healthy = await this.checkAgentHealth(agentId);
                if (!healthy) {
                    console.log(`[Supervisor] Agent ${agentId} is unhealthy, restarting...`);
                    await this.handleAgentExit(agentId);
                }
            }
        }, this.healthCheckInterval);
    }

    /**
     * Start existing agents from config
     */
    async startExistingAgents() {
        const deployments = await this.config.getDeployments();
        
        for (const deployment of deployments) {
            if (deployment.enabled !== false) {
                try {
                    await this.startAgent(deployment);
                } catch (err) {
                    console.error(`[Supervisor] Failed to start agent ${deployment.name}:`, err);
                }
            }
        }
    }

    /**
     * Get container runtime command (podman or docker)
     */
    getContainerCommand() {
        // Check for podman first (preferred)
        try {
            require('child_process').execSync('which podman', { stdio: 'ignore' });
            return 'podman';
        } catch (err) {
            // Fall back to docker
            return 'docker';
        }
    }

    /**
     * Get status of all agents
     */
    getStatus() {
        const status = {};
        
        for (const [agentId, agent] of this.agents) {
            status[agentId] = {
                running: true,
                startTime: agent.startTime,
                uptime: Date.now() - agent.startTime,
                restarts: agent.restarts
            };
        }
        
        return status;
    }

    /**
     * Stop all agents
     */
    async stopAll() {
        console.log('[Supervisor] Stopping all agents...');
        
        const stopPromises = [];
        for (const [agentId] of this.agents) {
            stopPromises.push(this.stopAgent(agentId));
        }
        
        await Promise.all(stopPromises);
        console.log('[Supervisor] All agents stopped');
    }
}

module.exports = { AgentSupervisor };