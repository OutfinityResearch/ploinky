const path = require('path');
const fs = require('fs').promises;
const { spawn } = require('child_process');
const crypto = require('crypto');

class ContainerManager {
    constructor(options = {}) {
        this.workingDir = options.workingDir;
        this.config = options.config;
        this.containers = new Map();
        this.gitManager = options.gitManager;
        this.runtime = this.detectContainerRuntime();
    }

    detectContainerRuntime() {
        try {
            require('child_process').execSync('which podman', { stdio: 'ignore' });
            return 'podman';
        } catch {
            return 'docker';
        }
    }

    async getContainerConfig(deployment) {
        const containerName = `ploinky-${deployment.domain}-${deployment.path}`.replace(/[^a-zA-Z0-9-]/g, '-');
        const agentPath = path.join(this.workingDir, 'agents', deployment.domain, deployment.path);
        const codePath = path.join(agentPath, 'code');
        const agentCorePath = path.join(this.workingDir, 'agentCore');
        const queuePath = path.join(agentPath, '.ploinky', 'queue');
        
        await fs.mkdir(agentPath, { recursive: true });
        await fs.mkdir(codePath, { recursive: true });
        await fs.mkdir(queuePath, { recursive: true });
        
        const config = {
            name: containerName,
            image: deployment.image || 'docker.io/library/node:18-alpine',
            volumes: [
                `${codePath}:/agent:rw`,
                `${agentCorePath}:/agentCore:ro`,
                `${queuePath}:/agent/.ploinky/queue:rw`
            ],
            environment: {
                PLOINKY_AGENT: deployment.agent,
                PLOINKY_DOMAIN: deployment.domain,
                PLOINKY_PATH: deployment.path,
                AGENT_DIR: '/agent'
            },
            workdir: '/agent',
            command: deployment.command || '/agentCore/run.sh'
        };

        return config;
    }

    async ensureContainer(deployment) {
        const config = await this.getContainerConfig(deployment);
        const existingContainer = await this.getContainer(config.name);
        
        if (existingContainer && existingContainer.running) {
            return config.name;
        }
        
        if (existingContainer && !existingContainer.running) {
            await this.removeContainer(config.name);
        }
        
        await this.createContainer(config);
        return config.name;
    }

    async createContainer(config) {
        const args = [
            'run',
            '-d',
            '--name', config.name,
            '--restart', 'unless-stopped'
        ];
        
        for (const volume of config.volumes) {
            args.push('-v', volume);
        }
        
        for (const [key, value] of Object.entries(config.environment)) {
            args.push('-e', `${key}=${value}`);
        }
        
        args.push('-w', config.workdir);
        args.push(config.image);
        
        if (config.command) {
            args.push(...config.command.split(' '));
        }
        
        await this.exec(this.runtime, args);
        this.containers.set(config.name, { config, running: true });
    }

    async getContainer(name) {
        try {
            const output = await this.exec(this.runtime, [
                'inspect',
                name,
                '--format',
                '{{json .State}}'
            ]);
            
            const state = JSON.parse(output);
            return {
                name,
                running: state.Running,
                status: state.Status,
                startedAt: state.StartedAt
            };
        } catch {
            return null;
        }
    }

    async removeContainer(name) {
        try {
            await this.exec(this.runtime, ['stop', name]);
            await this.exec(this.runtime, ['rm', name]);
            this.containers.delete(name);
        } catch (err) {
            console.error(`Failed to remove container ${name}:`, err);
        }
    }

    async restartContainer(name) {
        await this.exec(this.runtime, ['restart', name]);
    }

    async exec(command, args) {
        return new Promise((resolve, reject) => {
            const proc = spawn(command, args);
            let stdout = '';
            let stderr = '';
            
            proc.stdout.on('data', data => stdout += data);
            proc.stderr.on('data', data => stderr += data);
            
            proc.on('close', code => {
                if (code === 0) {
                    resolve(stdout.trim());
                } else {
                    reject(new Error(`Command failed: ${stderr || stdout}`));
                }
            });
        });
    }

    async stopAll() {
        for (const [name] of this.containers) {
            await this.removeContainer(name);
        }
    }
}

module.exports = { ContainerManager };