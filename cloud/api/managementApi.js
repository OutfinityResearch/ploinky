const url = require('url');
const path = require('path');
const fs = require('fs').promises;

class ManagementApi {
    constructor(options) {
        this.config = options.config;
        this.metrics = options.metrics;
        this.logger = options.logger;
        this.guardian = options.guardian;
        this.deploymentManager = options.deploymentManager;
        this.gitRepoManager = options.gitRepoManager;
    }

    async handleRequest(req, res, endpoint) {
        const method = req.method;
        
        switch (endpoint) {
            case 'init':
                return this.handleInit(req, res);
            case 'check-auth':
                return this.handleCheckAuth(req, res);
            case 'settings':
                return this.handleSettings(req, res, method);
            case 'health':
                return this.handleHealth(req, res);
            case 'logs':
                return this.handleLogs(req, res);
            case 'logs/list':
                return this.handleLogsList(req, res);
            case 'logs/download':
                return this.handleLogsDownload(req, res);
            case 'overview':
                return this.handleOverview(req, res);
            case 'metrics':
                return this.handleMetrics(req, res);
            case 'config':
                return this.handleConfig(req, res);
            case 'domains':
                return this.handleDomains(req, res, method);
            case 'repositories':
                return this.handleRepositories(req, res, method);
            case endpoint.match(/^repositories\/.*\/agents$/)?.input:
                return this.handleRepositoryAgents(req, res, endpoint);
            case 'deployments':
                return this.handleDeployments(req, res, method);
            case 'agents':
                return this.handleAgents(req, res);
            default:
                if (endpoint.startsWith('deployments/')) {
                    return this.handleDeploymentAction(req, res, endpoint);
                }
                res.statusCode = 404;
                res.end(JSON.stringify({ error: 'Not found' }));
        }
    }

    async handleInit(req, res) {
        if (req.method !== 'POST') {
            res.statusCode = 405;
            return res.end(JSON.stringify({ error: 'Method Not Allowed' }));
        }
        
        const initialized = await this.guardian.isInitialized();
        if (initialized) {
            res.statusCode = 409;
            return res.end(JSON.stringify({ error: 'Already initialized' }));
        }
        
        const apiKey = await this.guardian.generateAdminApiKey();
        res.statusCode = 200;
        return res.end(JSON.stringify({ success: true, apiKey }));
    }

    async handleCheckAuth(req, res) {
        const isAdmin = await this.guardian.checkAdminAuth(req);
        res.end(JSON.stringify({ authenticated: isAdmin }));
    }

    async handleSettings(req, res, method) {
        if (method === 'GET') {
            const config = await this.config.load();
            res.end(JSON.stringify(config.settings || {}));
        } else if (method === 'POST') {
            const body = await this.readBody(req);
            try {
                const data = JSON.parse(body);
                await this.config.updateSettings(data);
                res.end(JSON.stringify({ success: true }));
            } catch (e) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: 'Invalid request body' }));
            }
        } else {
            res.statusCode = 405;
            res.end(JSON.stringify({ error: 'Method Not Allowed' }));
        }
    }

    async handleHealth(req, res) {
        const deployments = this.deploymentManager.getAllDeployments();
        res.end(JSON.stringify({ 
            status: 'ok', 
            server: true, 
            agents: deployments.length,
            deployments: deployments.map(d => ({
                domain: d.domain,
                path: d.path,
                enabled: d.enabled
            }))
        }));
    }

    async handleLogs(req, res) {
        const q = url.parse(req.url, true).query;
        const lines = parseInt(q.lines || '200', 10);
        const text = await this.logger.tail(Math.max(1, Math.min(lines, 5000)));
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/plain');
        res.end(text);
    }

    async handleLogsList(req, res) {
        const dates = await this.logger.listDates();
        res.end(JSON.stringify({ dates }));
    }

    async handleLogsDownload(req, res) {
        const q = url.parse(req.url, true).query;
        const date = q.date;
        if (!date) {
            res.statusCode = 400;
            return res.end(JSON.stringify({ error: 'date required' }));
        }
        const text = await this.logger.readByDate(date);
        const zlib = require('zlib');
        const gz = zlib.gzipSync(Buffer.from(text || '', 'utf-8'));
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/gzip');
        res.setHeader('Content-Disposition', `attachment; filename="p-cloud-${date}.log.gz"`);
        res.end(gz);
    }

    async handleOverview(req, res) {
        const deployments = this.deploymentManager.getAllDeployments();
        const overview = {
            totalRequests: this.metrics.totalRequests,
            activeAgents: deployments.filter(d => d.enabled).length,
            totalDeployments: deployments.length,
            errorRate: this.metrics.getSummary().errorRate,
            unauthorizedRequests: this.metrics.unauthorizedRequests,
            uptime: Date.now() - this.metrics.startTime
        };
        res.end(JSON.stringify(overview));
    }

    async handleMetrics(req, res) {
        const q = url.parse(req.url, true).query;
        const range = String(q.range || '7d');
        const days = range.endsWith('d') ? parseInt(range) : (range === '24h' ? 1 : 7);
        const summary = this.metrics.getSummary();
        const series = await this.metrics.getHistoricalMetrics(days);
        res.end(JSON.stringify({ ...summary, series }));
    }

    async handleConfig(req, res) {
        const config = await this.config.load();
        res.end(JSON.stringify(config));
    }

    async handleDomains(req, res, method) {
        if (method === 'GET') {
            const domains = this.config.getDomains();
            res.end(JSON.stringify({ domains }));
        } else if (method === 'POST') {
            const body = await this.readBody(req);
            try {
                const data = JSON.parse(body);
                await this.config.addDomain({ 
                    name: data.name, 
                    enabled: data.enabled !== false 
                });
                res.end(JSON.stringify({ success: true }));
            } catch (e) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: 'Invalid request body' }));
            }
        } else if (method === 'DELETE') {
            const parsed = url.parse(req.url);
            const parts = parsed.pathname.split('/');
            const name = parts[parts.length - 1];
            await this.config.removeDomain(name);
            res.end(JSON.stringify({ success: true }));
        } else {
            res.statusCode = 405;
            res.end(JSON.stringify({ error: 'Method Not Allowed' }));
        }
    }

    async handleRepositories(req, res, method) {
        if (method === 'GET') {
            const repos = this.config.getRepositories();
            res.end(JSON.stringify({ repositories: repos }));
        } else if (method === 'POST') {
            const body = await this.readBody(req);
            try {
                const data = JSON.parse(body);
                await this.config.addRepository({ 
                    name: data.name, 
                    url: data.url, 
                    enabled: data.enabled !== false 
                });
                res.end(JSON.stringify({ success: true }));
            } catch (e) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: 'Invalid request body' }));
            }
        } else if (method === 'DELETE') {
            const body = await this.readBody(req);
            try {
                const data = JSON.parse(body);
                await this.config.removeRepository(data.url || data.name);
                res.end(JSON.stringify({ success: true }));
            } catch (e) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: 'Invalid request' }));
            }
        } else {
            res.statusCode = 405;
            res.end(JSON.stringify({ error: 'Method Not Allowed' }));
        }
    }

    async handleRepositoryAgents(req, res, endpoint) {
        const parts = endpoint.split('/');
        const repoUrl = Buffer.from(parts[1], 'base64').toString('utf-8');
        
        await this.logger.log('info', `Getting agents for repository: ${repoUrl}`);
        
        try {
            const repoPath = await this.gitRepoManager.cloneOrUpdate(repoUrl);
            await this.logger.log('info', `Repository path: ${repoPath}`);
            
            const agents = await this.scanForAgents(repoPath);
            await this.logger.log('info', `Found ${agents.length} agents`);
            
            res.end(JSON.stringify({ agents }));
        } catch (err) {
            await this.logger.log('error', `Failed to get agents: ${err.message}`);
            res.statusCode = 500;
            res.end(JSON.stringify({ error: `Failed to get agents: ${err.message}` }));
        }
    }

    async scanForAgents(repoPath) {
        await this.logger.log('info', `Scanning for agents in: ${repoPath}`);
        const agents = [];
        const files = await fs.readdir(repoPath, { withFileTypes: true });
        await this.logger.log('debug', `Files in repo: ${files.map(f => f.name).join(', ')}`);

        // Simply list all directories as agents (by convention)
        for (const file of files) {
            if (file.isDirectory() && !file.name.startsWith('.')) {
                agents.push({
                    name: file.name,
                    about: `Agent: ${file.name}`
                });
                await this.logger.log('debug', `Found agent folder: ${file.name}`);
            }
        }
        return agents;
    }

    async handleDeployments(req, res, method) {
        if (method === 'GET') {
            const deployments = this.deploymentManager.getAllDeployments();
            res.end(JSON.stringify({ deployments }));
        } else if (method === 'POST') {
            const body = await this.readBody(req);
            try {
                const data = JSON.parse(body);
                const deployment = await this.deploymentManager.deployAgent(
                    data.domain,
                    data.path,
                    {
                        agent: data.agent,
                        repository: data.repository,
                        branch: data.branch,
                        subPath: data.subPath,
                        image: data.image,
                        command: data.command,
                        environment: data.environment
                    }
                );
                res.end(JSON.stringify({ success: true, deployment }));
            } catch (e) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: e.message || 'Invalid request body' }));
            }
        } else if (method === 'DELETE') {
            const body = await this.readBody(req);
            try {
                const data = JSON.parse(body);
                await this.deploymentManager.removeDeployment(data.domain, data.path);
                res.end(JSON.stringify({ success: true }));
            } catch (e) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: 'Invalid request body' }));
            }
        } else {
            res.statusCode = 405;
            res.end(JSON.stringify({ error: 'Method Not Allowed' }));
        }
    }

    async handleDeploymentAction(req, res, endpoint) {
        const parts = endpoint.split('/');
        const action = parts[1];
        
        const body = await this.readBody(req);
        const data = JSON.parse(body);
        
        switch (action) {
            case 'sync':
                const result = await this.deploymentManager.syncDeployment(data.domain, data.path);
                res.end(JSON.stringify(result));
                break;
            case 'update':
                const updated = await this.deploymentManager.updateDeployment(
                    data.domain,
                    data.path,
                    data.updates
                );
                res.end(JSON.stringify({ success: true, deployment: updated }));
                break;
            default:
                res.statusCode = 404;
                res.end(JSON.stringify({ error: 'Action not found' }));
        }
    }

    async handleAgents(req, res) {
        // List available agents from repositories
        const repos = this.config.getRepositories();
        const allAgents = [];
        
        for (const repo of repos) {
            try {
                const repoPath = await this.gitRepoManager.cloneOrUpdate(repo.url);
                const agents = await this.scanForAgents(repoPath);
                allAgents.push(...agents.map(a => ({ ...a, repository: repo.url })));
            } catch (err) {
                this.logger.error(`Failed to get agents from repo ${repo.url}: ${err.message}`);
            }
        }
        
        res.end(JSON.stringify({ agents: allAgents }));
    }

    async readBody(req) {
        return new Promise((resolve) => {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => resolve(body));
        });
    }
}

module.exports = { ManagementApi };