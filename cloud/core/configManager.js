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
            // Try alternative path
            const altPath = path.join(path.dirname(this.configPath), '.ploinky', 'config.json');
            try {
                const altData = await fs.readFile(altPath, 'utf-8');
                this.config = JSON.parse(altData);
                this.configPath = altPath; // Use the found path
            } catch (altErr) {
                // Config doesn't exist, create default
                await this.createDefault();
                await this.save();
            }
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
                metricsRetention: 7, // days
                logLevel: 'info'
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

    async removeRepository(repoUrl) {
        this.config.repositories = this.config.repositories.filter(r => r.url !== repoUrl);
        await this.save();
    }

    async addDeployment(deployment) {
        // Validate deployment
        if (!deployment.domain || !deployment.path || !deployment.agent) {
            throw new Error('Invalid deployment: missing required fields');
        }

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
        this.config.deployments = this.config.deployments.filter(d => 
            !(d.domain === domain && d.path === path)
        );
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

module.exports = { ConfigManager };