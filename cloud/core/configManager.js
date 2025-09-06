const fs = require('fs').promises;
const path = require('path');

class ConfigManager {
    constructor(configPath) {
        this.configPath = configPath;
        this.config = {
            domains: [],
            repositories: [],
            deployments: [],
            settings: {
                port: 8000,
                workersCount: 'auto'
            }
        };
    }

    async load() {
        try {
            const data = await fs.readFile(this.configPath, 'utf-8');
            this.config = JSON.parse(data);
        } catch (err) {
            // Config doesn't exist, create default
            await this.createDefault();
            await this.save();
        }
        if(!this.config.repositories || this.config.repositories.length === 0) {
            this.config.repositories = [
                { 
                    name: 'PloinkyDemo',
                    url: 'https://github.com/PloinkyRepos/PloinkyDemo.git',
                    enabled: true
                }
            ];
            await this.save();
        }
        return this.config;
    }

    async save() {
        await fs.writeFile(this.configPath, JSON.stringify(this.config, null, 2));
    }

    async createDefault() {
        this.config = {
            domains: [
                { name: 'localhost', enabled: true }
            ],
            repositories: [
                { 
                    name: 'PloinkyDemo',
                    url: 'https://github.com/PloinkyRepos/PloinkyDemo.git',
                    enabled: true
                }
            ],
            deployments: [],
            settings: {
                port: 8000,
                workersCount: 'auto',
                metricsRetention: 365, // days
                logLevel: 'info',
                lastLogsLines: 200
            }
        };
    }

    async addDomain(domain) {
        if (!this.config.domains.find(d => d.name === domain.name)) {
            this.config.domains.push(domain);
            await this.save();
        }
    }

    async removeDomain(domainName) {
        this.config.domains = this.config.domains.filter(d => d.name !== domainName);
        await this.save();
    }

    async addRepository(repo) {
        if (!this.config.repositories.find(r => r.url === repo.url)) {
            this.config.repositories.push(repo);
            await this.save();
        }
    }

    async removeRepository(identifier) {
        this.config.repositories = this.config.repositories.filter(r => r.url !== identifier && r.name !== identifier);
        await this.save();
    }

    async addDeployment(deployment) {
        // Validate deployment
        if (!deployment.domain || !deployment.path || !deployment.agent) {
            throw new Error('Invalid deployment: missing required fields');
        }
        // Normalize path
        deployment.path = this.normalizePath(deployment.path);

        // Check for conflicts
        const existing = this.config.deployments.find(d => 
            d.domain === deployment.domain && d.path === deployment.path
        );

        if (existing) {
            throw new Error(`Deployment already exists for ${deployment.domain}${deployment.path}`);
        }

        // Generate unique name if not provided
        if (!deployment.name) {
            deployment.name = `${deployment.domain}_${deployment.path}`.replace(/\//g, '_');
        }

        this.config.deployments.push(deployment);
        await this.save();
    }

    async removeDeployment(domain, path) {
        const target = this.normalizePath(path);
        this.config.deployments = this.config.deployments.filter(d => {
            const dp = this.normalizePath(d.path);
            return !(d.domain === domain && dp === target);
        });
        await this.save();
    }

    async updateDeployment(domain, path, updates) {
        const deployment = this.config.deployments.find(d => 
            d.domain === domain && d.path === path
        );

        if (deployment) {
            Object.assign(deployment, updates);
            await this.save();
        }
    }

    getDomains() {
        return this.config.domains.filter(d => d.enabled);
    }

    getRepositories() {
        return this.config.repositories.filter(r => r.enabled);
    }

    getDeployments() {
        return this.config.deployments;
    }

    getSettings() {
        return this.config.settings;
    }

    async updateSettings(settings) {
        Object.assign(this.config.settings, settings);
        await this.save();
    }
}

ConfigManager.prototype.normalizePath = function(p) {
    if (p == null) return '/';
    const s = String(p).trim();
    if (s === '' || s === '/') return '/';
    const noLead = s.replace(/^\/+/, '');
    const noTrail = noLead.replace(/\/+$/, '');
    return '/' + noTrail;
}

module.exports = { ConfigManager };
