const cluster = require('cluster');
const http = require('http');
const path = require('path');
const fs = require('fs').promises;
const { RequestRouter } = require('./requestRouter');
const { ConfigManager } = require('./configManager');
const { MetricsCollector } = require('./metrics');

class PloinkyCloudServer {
    constructor(options = {}) {
        this.port = options.port || 8000;
        this.workingDir = options.workingDir || process.cwd();
        this.configPath = path.join(this.workingDir, 'config.json');
        
        this.config = null;
        this.router = null;
        this.metrics = new MetricsCollector();
        this.server = null;
    }

    async init() {
        // Ensure required directories exist
        await this.ensureDirectories();
        
        // Load or create configuration
        this.config = new ConfigManager(this.configPath);
        await this.config.load();

        // Initialize request router
        this.router = new RequestRouter({
            workingDir: this.workingDir,
            config: this.config,
            metrics: this.metrics
        });
        await this.router.init();

        // Create HTTP server
        this.server = http.createServer(async (req, res) => {
            await this.handleRequest(req, res);
        });
    }
    
    async ensureDirectories() {
        const fs = require('fs').promises;
        const dirs = [
            this.workingDir,
            path.join(this.workingDir, '.ploinky'),
            path.join(this.workingDir, 'agents'),
            path.join(this.workingDir, 'activeUsers'),
            path.join(this.workingDir, 'metrics')
        ];
        
        for (const dir of dirs) {
            await fs.mkdir(dir, { recursive: true });
        }
        
        console.log(`[Server] Initialized working directory: ${this.workingDir}`);
    }

    async handleRequest(req, res) {
        const startTime = Date.now();
        
        try {
            // Log request
            console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
            
            // Route the request
            await this.router.route(req, res);
            
            // Record metrics
            const duration = Date.now() - startTime;
            this.metrics.recordRequest(req.url, duration, res.statusCode);
            
        } catch (error) {
            console.error('Request handling error:', error);
            res.statusCode = 500;
            res.end(JSON.stringify({ 
                error: true, 
                message: 'Internal server error' 
            }));
            
            this.metrics.recordError(req.url, error);
        }
    }

    async start() {
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