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
            // Use the agent's specific deployment folder OR the repo folder for the agent code
            let agentCodePath;
            if (deployment.repository && deployment.agent) {
                // For repo-based agents, use the global repo path + agent subfolder
                agentCodePath = path.join(this.workingDir, 'repos', path.basename(deployment.repository, '.git'), deployment.agent);
            } else {
                // For custom deployments, use the agent's individual folder
                agentCodePath = path.join(this.workingDir, 'agents', deployment.domain || 'localhost', deployment.path || deployment.agent || 'default', 'code');
            }
            
            // Ensure agent directory exists
            await fs.mkdir(agentCodePath, { recursive: true });
            
            // Load manifest if exists
            const manifestPath = path.join(agentCodePath, 'manifest.json');
            let manifest = {};
            try {
                const manifestData = await fs.readFile(manifestPath, 'utf-8');
                manifest = JSON.parse(manifestData);
            } catch (err) {
                // No manifest yet
            }

            // Prepare container command
            const containerImage = manifest.container || 'docker.io/library/node:18-alpine';
            const internalPort = 7070;
            const hostPort = await this.findFreePort();
            // When RUN_TASK provided in manifest, pass to agentCore server
            const runTaskPath = manifest.runTask || '';
            const envVars = [
                '-e', `CODE_DIR=/code`,
                '-e', `RUN_TASK=${runTaskPath ? '/code/' + runTaskPath.replace(/^\/?code\/?/, '').replace(/^\//, '') : ''}`,
                '-e', `PORT=${internalPort}`
            ];
            
            // Build podman/docker command
            const containerCmd = this.getContainerCommand();
            const args = [
                'run',
                '-d',
                '--name', `ploinky-${agentId}`,
                '-p', `127.0.0.1:${hostPort}:${internalPort}`,
                '-v', `${agentCodePath}:/code:ro`,
                '-v', `${path.join(this.workingDir, 'agentCore')}:/agentCore:ro`,
                ...envVars,
                containerImage,
                'node', '/agentCore/server.js'
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
                restarts: 0,
                hostPort
            });

            // Wait for port to become available before saving runtime (readiness)
            const ready = await this.waitForPort('127.0.0.1', hostPort, 15000);
            if (!ready) {
                console.error(`[Supervisor] Agent ${agentId} did not become ready on port ${hostPort}`);
                // Best effort cleanup
                try { spawn(containerCmd, ['rm', '-f', `ploinky-${agentId}`], { stdio: 'inherit' }); } catch {}
                this.agents.delete(agentId);
                throw new Error('Agent did not become ready in time');
            }

            await this.saveRuntime(agentId, { containerName: `ploinky-${agentId}`, hostPort });

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
            await this.saveRuntime(agentId, null);
            console.log(`[Supervisor] Agent ${agentId} stopped successfully`);
            
        } catch (err) {
            console.error(`[Supervisor] Failed to stop agent ${agentId}:`, err);
            throw err;
        }
    }

    async saveRuntime(agentId, data) {
        try {
            const agentsDir = path.join(this.workingDir, '.ploinky', 'agents');
            await fs.mkdir(agentsDir, { recursive: true });
            const file = path.join(agentsDir, `${agentId}.runtime.json`);
            if (data) await fs.writeFile(file, JSON.stringify(data, null, 2));
            else await fs.unlink(file).catch(() => {});
        } catch (e) {
            console.error('[Supervisor] saveRuntime error:', e.message);
        }
    }

    async findFreePort(start = 10000, end = 20000) {
        const net = require('net');
        function check(port) {
            return new Promise((resolve) => {
                const srv = net.createServer();
                srv.once('error', () => resolve(false));
                srv.once('listening', () => srv.close(() => resolve(true)));
                srv.listen(port, '127.0.0.1');
            });
        }
        for (let p = start; p <= end; p++) {
            // eslint-disable-next-line no-await-in-loop
            if (await check(p)) return p;
        }
        return 18080;
    }

    async waitForPort(host, port, timeoutMs = 10000) {
        const net = require('net');
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            const ok = await new Promise((resolve) => {
                const socket = new net.Socket();
                socket.setTimeout(1000);
                socket.once('connect', () => { socket.destroy(); resolve(true); });
                socket.once('timeout', () => { socket.destroy(); resolve(false); });
                socket.once('error', () => { resolve(false); });
                socket.connect(port, host);
            });
            if (ok) return true;
            await new Promise(r => setTimeout(r, 200));
        }
        return false;
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
