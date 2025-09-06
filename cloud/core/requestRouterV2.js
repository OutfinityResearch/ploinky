const path = require('path');
const url = require('url');
const { Guardian } = require('../guardian/guardian');
const { TaskOrchestratorV2 } = require('./taskOrchestratorV2');
const { ManagementApi } = require('../api/managementApi');
const { StaticFileServer } = require('./staticFileServer');

class RequestRouterV2 {
    constructor(options) {
        this.workingDir = options.workingDir;
        this.baseDir = options.baseDir;
        this.config = options.config;
        this.metrics = options.metrics;
        this.logger = options.logger;
        this.gitRepoManager = options.gitRepoManager;
        
        this.guardian = new Guardian({
            config: this.config,
            workingDir: this.workingDir,
            baseDir: this.baseDir
        });
        
        this.orchestrator = new TaskOrchestratorV2({
            workingDir: this.workingDir,
            config: this.config
        });
        
        this.managementApi = new ManagementApi({
            config: this.config,
            metrics: this.metrics,
            logger: this.logger,
            guardian: this.guardian,
            deploymentManager: this.orchestrator.deploymentManager,
            gitRepoManager: this.gitRepoManager
        });
        
        this.staticServer = new StaticFileServer({
            workingDir: this.workingDir
        });
        
        this.deployments = new Map();
    }

    async init() {
        await this.guardian.init();
        await this.orchestrator.init();
        await this.loadDeployments();
    }

    async loadDeployments() {
        const deployments = await this.config.getDeployments();
        for (const deployment of deployments) {
            const key = `${deployment.domain}${deployment.path}`;
            this.deployments.set(key, deployment);
        }
    }

    async route(req, res) {
        const parsedUrl = url.parse(req.url, true);
        const hostname = req.headers.host?.split(':')[0] || 'localhost';
        const pathname = parsedUrl.pathname;

        // Root redirect
        if (pathname === '/') {
            res.statusCode = 302;
            res.setHeader('Location', '/management');
            res.end();
            return;
        }

        // Management UI
        if (pathname === '/management' || pathname.startsWith('/management/')) {
            return this.handleManagement(req, res, pathname);
        }

        // Authentication endpoint
        if (pathname === '/auth' || pathname.startsWith('/auth/')) {
            return this.handleAuth(req, res);
        }

        // Client library
        if (pathname.startsWith('/client/')) {
            return this.staticServer.serveFile(req, res, pathname);
        }

        // Find and execute deployment
        const deployment = this.findDeployment(hostname, pathname);
        
        if (!deployment) {
            return this.staticServer.serveStatic(req, res, hostname, pathname);
        }

        // Process task through deployment
        await this.processDeploymentRequest(req, res, deployment, parsedUrl.query);
    }

    async handleManagement(req, res, pathname) {
        // API endpoints
        if (pathname.startsWith('/management/api/')) {
            const endpoint = pathname.replace('/management/api/', '');
            
            // Special case: init doesn't require auth
            if (endpoint === 'init') {
                return this.managementApi.handleRequest(req, res, endpoint);
            }
            
            // Check admin auth
            const isAdmin = await this.guardian.checkAdminAuth(req);
            if (!isAdmin && endpoint !== 'check-auth') {
                res.statusCode = 401;
                res.end(JSON.stringify({ error: 'Unauthorized' }));
                this.metrics.recordUnauthorized(req.url);
                return;
            }
            
            return this.managementApi.handleRequest(req, res, endpoint);
        }
        
        // Login POST
        if (pathname === '/management/login' && req.method === 'POST') {
            return this.handleManagementLogin(req, res);
        }
        
        // Serve dashboard files
        return this.serveDashboard(req, res, pathname);
    }

    async handleManagementLogin(req, res) {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            const params = new URLSearchParams(body);
            const apiKey = params.get('apiKey');
            const token = apiKey ? await this.guardian.authenticateAdminApiKey(apiKey) : null;
            
            if (token) {
                res.statusCode = 302;
                res.setHeader('Set-Cookie', `authorizationToken=${token}; Path=/; HttpOnly`);
                res.setHeader('Location', '/management/landingPage.html');
                res.end();
            } else {
                this.serveLoginPage(res);
            }
        });
    }

    async serveDashboard(req, res, pathname) {
        const isAdmin = await this.guardian.checkAdminAuth(req);
        
        if (!isAdmin && pathname !== '/management/login') {
            return this.serveLoginPage(res);
        }
        
        return this.staticServer.serveDashboardFile(req, res, pathname);
    }

    serveLoginPage(res) {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html');
        res.end(this.getLoginPageHTML());
    }

    async handleAuth(req, res) {
        if (req.method !== 'POST') {
            res.writeHead(405, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Method not allowed' }));
            return;
        }

        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', async () => {
            try {
                const body = Buffer.concat(chunks).toString();
                const data = JSON.parse(body);
                const { command, params } = data;
                
                if (command === 'login' && params && params.length >= 1) {
                    const apiKey = params[0];
                    const authToken = await this.guardian.authenticateAdminApiKey(apiKey);
                    
                    if (authToken) {
                        res.setHeader('Set-Cookie', 
                            `authorizationToken=${authToken}; Path=/; HttpOnly`);
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({
                            success: true,
                            authorizationToken: authToken,
                            userId: 'admin'
                        }));
                    } else {
                        res.writeHead(401, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ 
                            success: false,
                            error: 'Invalid API key' 
                        }));
                    }
                } else {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ 
                        error: 'Invalid request format' 
                    }));
                }
            } catch (err) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    error: 'Invalid JSON',
                    details: err.message
                }));
            }
        });
    }

    async processDeploymentRequest(req, res, deployment, query) {
        const securityContext = await this.guardian.processRequest(req);
        
        const task = await this.orchestrator.createTask({
            deployment,
            request: req,
            securityContext,
            query
        });

        const result = await this.orchestrator.executeTask(task);
        
        this.sendResponse(res, result);
    }

    findDeployment(hostname, pathname) {
        let key = `${hostname}${pathname}`;
        if (this.deployments.has(key)) {
            return this.deployments.get(key);
        }

        const paths = pathname.split('/').filter(Boolean);
        while (paths.length > 0) {
            const testPath = '/' + paths.join('/');
            key = `${hostname}${testPath}`;
            if (this.deployments.has(key)) {
                return this.deployments.get(key);
            }
            paths.pop();
        }

        return null;
    }

    sendResponse(res, result) {
        if (result.success) {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(result.data));
        } else {
            res.statusCode = result.error.code === 'NOT_FOUND' ? 404 : 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(result.error));
        }
    }

    getLoginPageHTML() {
        return `<!DOCTYPE html>
<html>
<head>
    <title>Ploinky Cloud - Login</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
        }
        .container { width: 100%; max-width: 400px; padding: 20px; }
        .login-box {
            background: white;
            padding: 2.5rem;
            border-radius: 16px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.15);
        }
        h1 { color: #2c3e50; margin-bottom: 2rem; text-align: center; }
        .form-group { margin-bottom: 1.5rem; }
        label {
            display: block;
            color: #2c3e50;
            margin-bottom: 0.5rem;
            font-weight: 500;
        }
        input {
            width: 100%;
            padding: 0.875rem;
            border: 2px solid #e1e8ed;
            border-radius: 8px;
            font-size: 1rem;
        }
        button {
            width: 100%;
            padding: 1rem;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            border-radius: 8px;
            font-size: 1rem;
            font-weight: 600;
            cursor: pointer;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="login-box">
            <h1>Ploinky Cloud</h1>
            <form action="/management/login" method="POST">
                <div class="form-group">
                    <label for="apiKey">API Key</label>
                    <input type="text" id="apiKey" name="apiKey" required>
                </div>
                <button type="submit">Sign In</button>
            </form>
        </div>
    </div>
</body>
</html>`;
    }
}

module.exports = { RequestRouterV2 };