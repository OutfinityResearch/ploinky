const cluster = require('cluster');
const http = require('http');
const path = require('path');
const fs = require('fs').promises;
const { RequestRouter } = require('./requestRouter');
const { ConfigManager } = require('./configManager');
const { MetricsCollector } = require('./metrics');
const { AgentSupervisor } = require('../supervisor/agentSupervisor');
const { Logger } = require('./logger');

class PloinkyCloudServer {
    constructor(options = {}) {
        this.port = options.port || 8000;
        this.baseDir = options.workingDir || process.cwd();
        this.workingDir = path.join(this.baseDir, '.ploinky-cloud');
        this.configPath = path.join(this.workingDir, 'config.json');
        
        this.config = null;
        this.router = null;
        this.metrics = new MetricsCollector({ metricsDir: path.join(this.workingDir, 'metrics') });
        this.server = null;
        this.logger = null;
        this.supervisor = null;
    }

    async init() {
        // Ensure required directories exist
        await this.ensureDirectories();
        
        // Load or create configuration
        this.config = new ConfigManager(this.configPath);
        await this.config.load();

        // Sync repositories (clone if missing)
        await this.syncRepositories();

        // Initialize request router
        const settings = this.config.getSettings();
        this.logger = new Logger(this.workingDir, settings.logLevel || 'info');
        this.metrics.retentionDays = settings.metricsRetention || this.metrics.retentionDays;
        await this.metrics.init();

        // Initialize supervisor (containers for deployments)
        this.supervisor = new AgentSupervisor({ workingDir: this.workingDir, config: this.config });
        await this.supervisor.init();

        this.router = new RequestRouter({
            workingDir: this.workingDir,
            baseDir: this.baseDir,
            config: this.config,
            metrics: this.metrics,
            logger: this.logger,
            supervisor: this.supervisor
        });
        await this.router.init();

        // Create HTTP server
        this.server = http.createServer(async (req, res) => {
            await this.handleRequest(req, res);
        });
    }

    async syncRepositories() {
        try {
            const repos = this.config.getRepositories();
            const { spawn } = require('child_process');
            for (const repo of repos) {
                if (!repo || !repo.name || !repo.url) continue;
                const target = path.join(this.workingDir, 'repos', repo.name);
                try { await fs.access(target); }
                catch {
                    await fs.mkdir(path.dirname(target), { recursive: true });
                    await new Promise((resolve) => {
                        const git = spawn('git', ['clone', '--depth', '1', repo.url, target], { stdio: 'inherit' });
                        git.on('exit', () => resolve());
                    });
                }
            }
        } catch (e) {
            console.error('[Server] Repo sync failed:', e.message);
        }
    }
    
    async ensureDirectories() {
        const fs = require('fs').promises;
        const dirs = [
            this.workingDir,
            path.join(this.workingDir, 'agents'),
            path.join(this.workingDir, 'activeUsers'),
            path.join(this.workingDir, 'metrics'),
            path.join(this.workingDir, 'logs'),
            path.join(this.workingDir, 'repos')
        ];
        
        for (const dir of dirs) {
            await fs.mkdir(dir, { recursive: true });
        }
        
        console.log(`[Server] Initialized working directory: ${this.workingDir}`);
    }

    async handleRequest(req, res) {
        const startTime = Date.now();
        
        try {
            // Log the incoming request
            await this.logger.log('info', `${req.method} ${req.url}`, {
                method: req.method,
                url: req.url,
                headers: req.headers,
                ip: req.socket.remoteAddress
            });
            
            // Route the request
            await this.router.route(req, res);
            
            // Record metrics
            const duration = Date.now() - startTime;
            this.metrics.recordRequest(req.url, duration, res.statusCode);
            
            // Log the response
            await this.logger.log('info', `Response ${res.statusCode} for ${req.method} ${req.url}`, {
                statusCode: res.statusCode,
                duration: duration,
                url: req.url
            });
            
        } catch (error) {
            console.error('Request handling error:', error);
            res.statusCode = 500;
            res.end(JSON.stringify({ 
                error: true, 
                message: 'Internal server error' 
            }));
            
            this.metrics.recordError(req.url, error);
            
            // Log the error
            await this.logger.log('error', `Error handling ${req.method} ${req.url}`, {
                error: error.message,
                stack: error.stack,
                url: req.url
            });
        }
    }

    async start() {
        if (process.env.PLOINKY_FORCE_SINGLE === '1') {
            await this.init();
            this.server.listen(this.port, () => {
                console.log(`[Single ${process.pid}] Server listening on port ${this.port}`);
            });
            return;
        }
        if (cluster.isMaster) {
            await this.startMaster();
        } else {
            await this.startWorker();
        }
    }

    async startMaster() {
        console.log(`[Master ${process.pid}] Starting Ploinky Cloud Server`);
        
        // Fork workers
        const numWorkers = require('os').cpus().length;
        console.log(`[Master] Forking ${numWorkers} workers`);
        
        for (let i = 0; i < numWorkers; i++) {
            cluster.fork();
        }
        
        // Handle worker events
        cluster.on('exit', (worker, code, signal) => {
            console.log(`[Master] Worker ${worker.process.pid} died`);
            console.log('[Master] Starting a new worker');
            cluster.fork();
        });
        
        cluster.on('online', (worker) => {
            console.log(`[Master] Worker ${worker.process.pid} is online`);
        });
    }

    async startWorker() {
        await this.init();
        
        this.server.listen(this.port, () => {
            console.log(`[Worker ${process.pid}] Server listening on port ${this.port}`);
        });
        
        // Graceful shutdown
        process.on('SIGTERM', async () => {
            console.log(`[Worker ${process.pid}] SIGTERM received, shutting down gracefully`);
            this.server.close(() => {
                process.exit(0);
            });
        });
    }

    async stop() {
        if (this.server) {
            return new Promise((resolve) => {
                this.server.close(() => {
                    console.log('Server stopped');
                    resolve();
                });
            });
        }
    }
}

module.exports = { PloinkyCloudServer };
