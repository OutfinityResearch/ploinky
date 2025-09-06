const cluster = require('cluster');
const http = require('http');
const path = require('path');
const fs = require('fs').promises;
const { RequestRouterV2 } = require('./requestRouterV2');
const { ConfigManager } = require('./configManager');
const { MetricsCollector } = require('./metrics');
const { GitRepoManager } = require('../container/gitRepoManager');
const { Logger } = require('./logger');

class PloinkyCloudServerV2 {
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
        this.gitRepoManager = null;
    }

    async init() {
        await this.ensureDirectories();
        
        this.config = new ConfigManager(this.configPath);
        await this.config.load();

        const settings = this.config.getSettings();
        this.logger = new Logger(this.workingDir, settings.logLevel || 'info');
        this.metrics.retentionDays = settings.metricsRetention || this.metrics.retentionDays;
        await this.metrics.init();

        this.gitRepoManager = new GitRepoManager({ workingDir: this.workingDir });
        await this.gitRepoManager.init();

        this.router = new RequestRouterV2({
            workingDir: this.workingDir,
            baseDir: this.baseDir,
            config: this.config,
            metrics: this.metrics,
            logger: this.logger,
            gitRepoManager: this.gitRepoManager
        });
        await this.router.init();

        this.server = http.createServer(async (req, res) => {
            await this.handleRequest(req, res);
        });
    }
    
    async ensureDirectories() {
        const dirs = [
            this.workingDir,
            path.join(this.workingDir, 'repos'),
            path.join(this.workingDir, 'agents'),
            path.join(this.workingDir, 'activeUsers'),
            path.join(this.workingDir, 'metrics'),
            path.join(this.workingDir, 'logs'),
            path.join(this.workingDir, 'coreAgent')
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
            
            await this.router.route(req, res);
            
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
        if (process.env.PLOINKY_FORCE_SINGLE === '1' || process.env.NODE_ENV === 'development') {
            await this.startSingle();
        } else if (cluster.isMaster) {
            await this.startMaster();
        } else {
            await this.startWorker();
        }
    }

    async startSingle() {
        await this.init();
        this.server.listen(this.port, () => {
            console.log(`[Single Process] Server listening on port ${this.port}`);
            console.log(`[Single Process] PID: ${process.pid}`);
            console.log(`[Single Process] Working directory: ${this.workingDir}`);
        });
    }

    async startMaster() {
        console.log(`[Master ${process.pid}] Starting Ploinky Cloud Server V2`);
        
        const numWorkers = require('os').cpus().length;
        console.log(`[Master] Forking ${numWorkers} workers`);
        
        for (let i = 0; i < numWorkers; i++) {
            cluster.fork();
        }
        
        cluster.on('exit', (worker, code, signal) => {
            console.log(`[Master] Worker ${worker.process.pid} died (${signal || code})`);
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
        
        process.on('SIGTERM', async () => {
            console.log(`[Worker ${process.pid}] SIGTERM received, shutting down gracefully`);
            this.server.close(() => {
                process.exit(0);
            });
        });
        
        process.on('SIGINT', async () => {
            console.log(`[Worker ${process.pid}] SIGINT received, shutting down gracefully`);
            this.server.close(() => {
                process.exit(0);
            });
        });
    }

    async stop() {
        if (this.router && this.router.orchestrator) {
            await this.router.orchestrator.stop();
        }
        
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

module.exports = { PloinkyCloudServerV2 };