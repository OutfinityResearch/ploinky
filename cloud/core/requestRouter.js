const path = require('path');
const url = require('url');
const { Guardian } = require('../guardian/guardian');
const { TaskOrchestrator } = require('./taskOrchestrator');

class RequestRouter {
    constructor(options) {
        this.workingDir = options.workingDir;
        this.config = options.config;
        this.metrics = options.metrics;
        
        this.guardian = new Guardian({
            config: this.config,
            workingDir: this.workingDir
        });
        
        this.orchestrator = new TaskOrchestrator({
            workingDir: this.workingDir,
            config: this.config
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

        // Root path - redirect to management
        if (pathname === '/') {
            res.statusCode = 302;
            res.setHeader('Location', '/management');
            res.end();
            return;
        }

        // Special reserved paths
        if (pathname === '/management' || pathname.startsWith('/management/')) {
            return this.handleManagementUI(req, res);
        }

        if (pathname === '/auth' || pathname.startsWith('/auth/')) {
            return this.handleAuthAgent(req, res);
        }

        // Static resources for dashboard
        if (pathname.startsWith('/client/')) {
            return this.serveClientLibrary(req, res, pathname);
        }

        // Find deployment
        const deployment = this.findDeployment(hostname, pathname);
        
        if (!deployment) {
            // Try to serve static files or return 404
            return this.handleStaticAgent(req, res, hostname, pathname);
        }

        // Process through Guardian for security
        const securityContext = await this.guardian.processRequest(req);
        
        // Convert HTTP request to task
        const task = await this.orchestrator.createTask({
            deployment,
            request: req,
            securityContext,
            query: parsedUrl.query
        });

        // Execute task and wait for response
        const result = await this.orchestrator.executeTask(task);
        
        // Send response
        this.sendResponse(res, result);
    }

    findDeployment(hostname, pathname) {
        // Try exact match first
        let key = `${hostname}${pathname}`;
        if (this.deployments.has(key)) {
            return this.deployments.get(key);
        }

        // Try to find the longest matching path
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

    async handleManagementUI(req, res) {
        const parsedUrl = url.parse(req.url, true);
        const pathname = parsedUrl.pathname;
        
        // Handle API endpoints
        if (pathname.startsWith('/management/api/')) {
            return this.handleManagementAPI(req, res, pathname.replace('/management/api/', ''));
        }
        
        // Handle login POST
        if (pathname === '/management/login' && req.method === 'POST') {
            return this.handleManagementLogin(req, res);
        }
        
        // Check admin authentication for UI access
        const isAdmin = await this.guardian.checkAdminAuth(req);
        
        if (!isAdmin && pathname !== '/management/login') {
            // Serve login page
            return this.serveLoginPage(res);
        }

        // Serve dashboard files
        const fs = require('fs').promises;
        const dashboardPath = path.join(__dirname, '../../dashboard');
        
        let filePath;
        if (pathname === '/management' || pathname === '/management/') {
            filePath = path.join(dashboardPath, 'login.html');
        } else {
            const requestedFile = pathname.replace('/management/', '');
            filePath = path.join(dashboardPath, requestedFile);
        }
        
        try {
            const content = await fs.readFile(filePath);
            const ext = path.extname(filePath);
            const contentType = this.getContentType(ext);
            
            res.statusCode = 200;
            res.setHeader('Content-Type', contentType);
            res.end(content);
        } catch (err) {
            // File not found, serve login.html as fallback
            try {
                const indexContent = await fs.readFile(path.join(dashboardPath, 'login.html'));
                res.statusCode = 200;
                res.setHeader('Content-Type', 'text/html');
                res.end(indexContent);
            } catch (e) {
                res.statusCode = 404;
                res.end('Dashboard not found');
            }
        }
    }
    
    async serveLoginPage(res) {
        const fs = require('fs').promises;
        const loginPath = path.join(__dirname, '../../dashboard/login.html');
        
        try {
            const content = await fs.readFile(loginPath);
            res.statusCode = 200;
            res.setHeader('Content-Type', 'text/html');
            res.end(content);
        } catch (err) {
            // Fallback to beautiful modern login page
            res.statusCode = 200;
            res.setHeader('Content-Type', 'text/html');
            res.end(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Ploinky Cloud - Welcome</title>
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <style>
                        * { margin: 0; padding: 0; box-sizing: border-box; }
                        
                        body { 
                            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
                            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                            min-height: 100vh;
                            display: flex;
                            justify-content: center;
                            align-items: center;
                            padding: 20px;
                        }
                        
                        .container {
                            width: 100%;
                            max-width: 400px;
                        }
                        
                        .logo {
                            text-align: center;
                            margin-bottom: 2rem;
                            color: white;
                        }
                        
                        .logo h1 {
                            font-size: 2.5rem;
                            font-weight: 700;
                            margin-bottom: 0.5rem;
                            text-shadow: 2px 2px 4px rgba(0,0,0,0.2);
                        }
                        
                        .logo p {
                            font-size: 1rem;
                            opacity: 0.9;
                        }
                        
                        .login-box {
                            background: white;
                            padding: 2.5rem;
                            border-radius: 16px;
                            box-shadow: 0 20px 40px rgba(0,0,0,0.15);
                            animation: slideUp 0.5s ease;
                        }
                        
                        @keyframes slideUp {
                            from {
                                opacity: 0;
                                transform: translateY(30px);
                            }
                            to {
                                opacity: 1;
                                transform: translateY(0);
                            }
                        }
                        
                        .login-box h2 {
                            color: #2c3e50;
                            margin-bottom: 0.5rem;
                            font-size: 1.5rem;
                        }
                        
                        .subtitle {
                            color: #7f8c8d;
                            margin-bottom: 2rem;
                            font-size: 0.9rem;
                        }
                        
                        .form-group {
                            margin-bottom: 1.5rem;
                        }
                        
                        label {
                            display: block;
                            color: #2c3e50;
                            margin-bottom: 0.5rem;
                            font-size: 0.9rem;
                            font-weight: 500;
                        }
                        
                        input {
                            width: 100%;
                            padding: 0.875rem;
                            border: 2px solid #e1e8ed;
                            border-radius: 8px;
                            font-size: 1rem;
                            transition: all 0.3s;
                            background: #f8f9fa;
                        }
                        
                        input:focus {
                            outline: none;
                            border-color: #667eea;
                            background: white;
                            box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
                        }
                        
                        .password-notice {
                            background: #fffbf0;
                            border: 1px solid #f0e1b4;
                            padding: 0.75rem;
                            border-radius: 6px;
                            margin-bottom: 1.5rem;
                            font-size: 0.85rem;
                            color: #856404;
                        }
                        
                        .password-notice strong {
                            display: block;
                            margin-bottom: 0.25rem;
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
                            transition: all 0.3s;
                            text-transform: uppercase;
                            letter-spacing: 0.5px;
                        }
                        
                        button:hover {
                            transform: translateY(-2px);
                            box-shadow: 0 10px 20px rgba(102, 126, 234, 0.3);
                        }
                        
                        button:active {
                            transform: translateY(0);
                        }
                        
                        .features {
                            margin-top: 2rem;
                            padding-top: 2rem;
                            border-top: 1px solid #e1e8ed;
                        }
                        
                        .feature {
                            display: flex;
                            align-items: center;
                            margin-bottom: 1rem;
                            color: #5a6c7d;
                            font-size: 0.9rem;
                        }
                        
                        .feature-icon {
                            width: 20px;
                            height: 20px;
                            margin-right: 0.75rem;
                            color: #667eea;
                        }
                        
                        .footer {
                            text-align: center;
                            margin-top: 2rem;
                            color: white;
                            font-size: 0.85rem;
                            opacity: 0.8;
                        }
                        
                        .footer a {
                            color: white;
                            text-decoration: none;
                            font-weight: 500;
                        }
                        
                        .footer a:hover {
                            text-decoration: underline;
                        }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <div class="logo">
                            <h1>🚀 Ploinky Cloud</h1>
                            <p>Container Orchestration Made Simple</p>
                        </div>
                        
                        <div class="login-box">
                            <h2>Welcome Back</h2>
                            <p class="subtitle">Sign in to manage your cloud</p>
                            
                            <div class="password-notice">
                                <strong>⚠️ First Time Setup</strong>
                                Default password is pre-filled. Please change it after login!
                            </div>
                            
                            <form action="/management/login" method="POST" onsubmit="handleLogin(event)">
                                <div class="form-group">
                                    <label for="username">Username</label>
                                    <input type="text" id="username" name="username" 
                                           value="admin" readonly 
                                           style="background: #f0f0f0; cursor: not-allowed;">
                                </div>
                                
                                <div class="form-group">
                                    <label for="password">Password</label>
                                    <input type="password" id="password" name="password" 
                                           value="admin" 
                                           placeholder="Enter password">
                                </div>
                                
                                <button type="submit">Sign In</button>
                            </form>
                            
                            <div class="features">
                                <div class="feature">
                                    <svg class="feature-icon" fill="currentColor" viewBox="0 0 20 20">
                                        <path d="M10 2a8 8 0 100 16 8 8 0 000-16zM8 12l-2-2 1-1 1 1 3-3 1 1-4 4z"/>
                                    </svg>
                                    Deploy agents to custom paths
                                </div>
                                <div class="feature">
                                    <svg class="feature-icon" fill="currentColor" viewBox="0 0 20 20">
                                        <path d="M3 12v3c0 1.657 3.134 3 7 3s7-1.343 7-3v-3c0 1.657-3.134 3-7 3s-7-1.343-7-3z"/>
                                        <path d="M3 7v3c0 1.657 3.134 3 7 3s7-1.343 7-3V7c0 1.657-3.134 3-7 3S3 8.657 3 7z"/>
                                        <path d="M17 5c0 1.657-3.134 3-7 3S3 6.657 3 5s3.134-3 7-3 7 1.343 7 3z"/>
                                    </svg>
                                    Monitor performance metrics
                                </div>
                                <div class="feature">
                                    <svg class="feature-icon" fill="currentColor" viewBox="0 0 20 20">
                                        <path d="M10 12a2 2 0 100-4 2 2 0 000 4z"/>
                                        <path d="M10 4a8 8 0 100 16 8 8 0 000-16zm0 14a6 6 0 110-12 6 6 0 010 12z"/>
                                    </svg>
                                    Manage multiple hosts
                                </div>
                            </div>
                        </div>
                        
                        <div class="footer">
                            <p>Powered by Ploinky • <a href="/docs">Documentation</a></p>
                        </div>
                    </div>
                    
                    <script>
                        function handleLogin(e) {
                            // Auto-clear the password field if it's still default
                            const passwordField = document.getElementById('password');
                            if (passwordField.value === 'admin') {
                                // Show a reminder
                                if (!sessionStorage.getItem('passwordWarningShown')) {
                                    sessionStorage.setItem('passwordWarningShown', 'true');
                                }
                            }
                        }
                        
                        // Focus on password field if it's default
                        window.onload = function() {
                            const passwordField = document.getElementById('password');
                            if (passwordField.value === 'admin') {
                                passwordField.select();
                            }
                        }
                    </script>
                </body>
                </html>
            `);
        }
    }
    
    async handleManagementLogin(req, res) {
        // Parse POST body
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            const params = new URLSearchParams(body);
            const username = params.get('username') || 'admin';
            const password = params.get('password');
            
            const token = await this.guardian.authenticateAdmin(password);
            
            if (token) {
                res.statusCode = 302;
                res.setHeader('Set-Cookie', `authorizationToken=${token}; Path=/; HttpOnly`);
                res.setHeader('Location', '/management');
                res.end();
            } else {
                this.serveLoginPage(res);
            }
        });
    }
    
    async handleManagementAPI(req, res, endpoint) {
        // Check admin auth for API
        const isAdmin = await this.guardian.checkAdminAuth(req);
        if (!isAdmin && endpoint !== 'check-auth' && endpoint !== 'is-default-password') { // Allow checking default password without full auth
            res.statusCode = 401;
            res.end(JSON.stringify({ error: 'Unauthorized' }));
            return;
        }
        
        // Handle API endpoints
        switch (endpoint) {
            case 'check-auth':
                res.end(JSON.stringify({ authenticated: isAdmin }));
                break;
            case 'is-default-password':
                const isDefault = await this.guardian.isDefaultPassword();
                res.end(JSON.stringify({ isDefault }));
                break;
            case 'change-password':
                if (req.method === 'POST') {
                    let body = '';
                    req.on('data', chunk => body += chunk);
                    req.on('end', async () => {
                        try {
                            const { currentPassword, newPassword } = JSON.parse(body);
                            const success = await this.guardian.changeAdminPassword(currentPassword, newPassword);
                            if (success) {
                                res.statusCode = 200;
                                res.end(JSON.stringify({ success: true }));
                            } else {
                                res.statusCode = 400;
                                res.end(JSON.stringify({ error: 'Failed to change password. Incorrect current password?' }));
                            }
                        } catch (e) {
                            res.statusCode = 400;
                            res.end(JSON.stringify({ error: 'Invalid request body.' }));
                        }
                    });
                } else {
                    res.statusCode = 405;
                    res.end(JSON.stringify({ error: 'Method Not Allowed' }));
                }
                break;
            case 'overview':
                const overview = {
                    totalRequests: this.metrics.totalRequests,
                    activeAgents: 0, // TODO: get from supervisor
                    errorRate: this.metrics.errorRate || '0%',
                    uptime: Date.now() - this.metrics.startTime
                };
                res.end(JSON.stringify(overview));
                break;
            case 'config':
                const config = await this.config.load();
                res.end(JSON.stringify(config));
                break;
            case 'domains':
                const domains = this.config.getDomains();
                res.end(JSON.stringify({ domains }));
                break;
            case 'deployments':
                const deployments = this.config.getDeployments();
                res.end(JSON.stringify({ deployments }));
                break;
            default:
                res.statusCode = 404;
                res.end(JSON.stringify({ error: 'Not found' }));
        }
    }

    async handleAuthAgent(req, res) {
        // Handle authentication directly without external agent
        if (req.method !== 'POST') {
            res.writeHead(405, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Method not allowed' }));
            return;
        }

        // Read request body
        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', async () => {
            try {
                const body = Buffer.concat(chunks).toString();
                const data = JSON.parse(body);
                const { command, params } = data;
                
                if (command === 'login' && params && params.length >= 2) {
                    const [username, password] = params;
                    
                    // Authenticate with Guardian (for now only admin auth is supported)
                    const authToken = await this.guardian.authenticateAdmin(password);
                    
                    if (authToken) {
                        res.setHeader('Set-Cookie', 
                            `authorizationToken=${authToken}; Path=/; HttpOnly`);
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({
                            success: true,
                            authorizationToken: authToken,
                            userId: username
                        }));
                    } else {
                        res.writeHead(401, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ 
                            success: false,
                            error: 'Invalid credentials' 
                        }));
                    }
                } else {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ 
                        error: 'Invalid request format' 
                    }));
                }
            } catch (err) {
                console.error('[Auth] Error parsing request:', err.message, 'Body:', chunks.toString());
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    error: 'Invalid JSON',
                    details: err.message
                }));
            }
        });
    }

    async serveClientLibrary(req, res, pathname) {
        const fs = require('fs').promises;
        const clientPath = path.join(__dirname, '../..', pathname);
        
        try {
            const content = await fs.readFile(clientPath);
            const ext = path.extname(clientPath);
            const contentType = this.getContentType(ext);
            
            res.statusCode = 200;
            res.setHeader('Content-Type', contentType);
            res.end(content);
        } catch (err) {
            res.statusCode = 404;
            res.end('Not Found');
        }
    }

    async handleStaticAgent(req, res, hostname, pathname) {
        // Serve static files
        const staticPath = path.join(this.workingDir, 'agents', 'static', hostname);
        const filePath = path.join(staticPath, pathname);

        try {
            const fs = require('fs').promises;
            const stats = await fs.stat(filePath);
            
            if (stats.isFile()) {
                const content = await fs.readFile(filePath);
                const ext = path.extname(filePath);
                const contentType = this.getContentType(ext);
                
                res.statusCode = 200;
                res.setHeader('Content-Type', contentType);
                res.end(content);
            } else if (stats.isDirectory()) {
                // Try login.html
                const indexPath = path.join(filePath, 'login.html');
                const indexContent = await fs.readFile(indexPath);
                res.statusCode = 200;
                res.setHeader('Content-Type', 'text/html');
                res.end(indexContent);
            }
        } catch (err) {
            // Return a simple 404 page
            res.statusCode = 404;
            res.setHeader('Content-Type', 'text/html');
            res.end(`
                <!DOCTYPE html>
                <html>
                <head><title>404 - Not Found</title></head>
                <body style="font-family: sans-serif; text-align: center; padding: 50px;">
                    <h1>404 - Page Not Found</h1>
                    <p>The requested page was not found.</p>
                    <a href="/management">Go to Management Dashboard</a>
                </body>
                </html>
            `);
        }
    }

    getContentType(ext) {
        const types = {
            '.html': 'text/html',
            '.css': 'text/css',
            '.js': 'application/javascript',
            '.json': 'application/json',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.gif': 'image/gif',
            '.svg': 'image/svg+xml'
        };
        return types[ext] || 'application/octet-stream';
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
}

module.exports = { RequestRouter };