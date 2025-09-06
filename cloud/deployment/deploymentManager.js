const path = require('path');
const fs = require('fs').promises;
const { ContainerManager } = require('../container/containerManager');
const { GitRepoManager } = require('../container/gitRepoManager');

class DeploymentManager {
    constructor(options = {}) {
        this.workingDir = options.workingDir;
        this.config = options.config;
        this.deployments = new Map();
        
        this.gitManager = new GitRepoManager({
            workingDir: this.workingDir
        });
        
        this.containerManager = new ContainerManager({
            workingDir: this.workingDir,
            config: this.config,
            gitManager: this.gitManager
        });
    }

    async init() {
        await this.gitManager.init();
        await this.loadDeployments();
    }

    async loadDeployments() {
        const deployments = await this.config.getDeployments();
        
        for (const deployment of deployments) {
            const key = this.getDeploymentKey(deployment.domain, deployment.path);
            this.deployments.set(key, deployment);
        }
    }

    async deployAgent(domain, path, agentConfig) {
        const key = this.getDeploymentKey(domain, path);
        
        if (this.deployments.has(key)) {
            throw new Error(`Deployment already exists for ${domain}${path}`);
        }
        
        const deployment = {
            domain,
            path,
            agent: agentConfig.agent,
            repository: agentConfig.repository,
            branch: agentConfig.branch || 'main',
            subPath: agentConfig.subPath || '',
            image: agentConfig.image || 'docker.io/library/node:18-alpine',
            command: agentConfig.command,
            environment: agentConfig.environment || {},
            enabled: true,
            createdAt: new Date().toISOString()
        };
        
        await this.prepareDeployment(deployment);
        
        const containerName = await this.containerManager.ensureContainer(deployment);
        
        deployment.container = containerName;
        this.deployments.set(key, deployment);
        
        await this.config.addDeployment(deployment);
        
        return deployment;
    }

    async prepareDeployment(deployment) {
        const agentPath = path.join(this.workingDir, 'agents', deployment.domain, deployment.path);
        const codePath = path.join(agentPath, 'code');
        const tasksPath = path.join(agentPath, 'tasks');
        const responsesPath = path.join(agentPath, 'responses');
        
        await fs.mkdir(agentPath, { recursive: true });
        await fs.mkdir(codePath, { recursive: true });
        await fs.mkdir(tasksPath, { recursive: true });
        await fs.mkdir(responsesPath, { recursive: true });
        
        if (deployment.repository) {
            await this.gitManager.syncToContainer(
                deployment.repository,
                deployment.branch,
                codePath,
                deployment.subPath
            );
        }
        
        const manifest = {
            agent: deployment.agent,
            domain: deployment.domain,
            path: deployment.path,
            repository: deployment.repository,
            branch: deployment.branch,
            subPath: deployment.subPath,
            image: deployment.image,
            command: deployment.command,
            environment: deployment.environment,
            createdAt: deployment.createdAt,
            updatedAt: new Date().toISOString()
        };
        
        await fs.writeFile(
            path.join(agentPath, 'manifest.json'),
            JSON.stringify(manifest, null, 2)
        );
    }

    async updateDeployment(domain, path, updates) {
        const key = this.getDeploymentKey(domain, path);
        const deployment = this.deployments.get(key);
        
        if (!deployment) {
            throw new Error(`Deployment not found for ${domain}${path}`);
        }
        
        const updatedDeployment = { ...deployment, ...updates };
        
        if (updates.repository || updates.branch || updates.subPath) {
            await this.prepareDeployment(updatedDeployment);
        }
        
        if (deployment.container) {
            await this.containerManager.restartContainer(deployment.container);
        }
        
        this.deployments.set(key, updatedDeployment);
        await this.config.updateDeployment(domain, path, updatedDeployment);
        
        return updatedDeployment;
    }

    async removeDeployment(domain, path) {
        const key = this.getDeploymentKey(domain, path);
        const deployment = this.deployments.get(key);
        
        if (!deployment) {
            throw new Error(`Deployment not found for ${domain}${path}`);
        }
        
        if (deployment.container) {
            await this.containerManager.removeContainer(deployment.container);
        }
        
        const agentPath = path.join(this.workingDir, 'agents', domain, path);
        await fs.rm(agentPath, { recursive: true, force: true });
        
        this.deployments.delete(key);
        await this.config.removeDeployment(domain, path);
    }

    async syncDeployment(domain, path) {
        const key = this.getDeploymentKey(domain, path);
        const deployment = this.deployments.get(key);
        
        if (!deployment) {
            throw new Error(`Deployment not found for ${domain}${path}`);
        }
        
        if (deployment.repository) {
            const codePath = path.join(this.workingDir, 'agents', domain, path, 'code');
            await this.gitManager.syncToContainer(
                deployment.repository,
                deployment.branch,
                codePath,
                deployment.subPath
            );
        }
        
        if (deployment.container) {
            await this.containerManager.restartContainer(deployment.container);
        }
        
        return { success: true, message: 'Deployment synced successfully' };
    }

    getDeployment(domain, path) {
        const key = this.getDeploymentKey(domain, path);
        return this.deployments.get(key);
    }

    getAllDeployments() {
        return Array.from(this.deployments.values());
    }

    getDeploymentKey(domain, path) {
        return `${domain}:${path}`;
    }

    async stopAll() {
        await this.containerManager.stopAll();
    }
}

module.exports = { DeploymentManager };