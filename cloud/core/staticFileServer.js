const path = require('path');
const fs = require('fs').promises;

class StaticFileServer {
    constructor(options) {
        this.workingDir = options.workingDir;
        this.dashboardPath = path.join(__dirname, '../../dashboard');
        this.contentTypes = {
            '.html': 'text/html',
            '.css': 'text/css',
            '.js': 'application/javascript',
            '.json': 'application/json',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.gif': 'image/gif',
            '.svg': 'image/svg+xml',
            '.ico': 'image/x-icon',
            '.woff': 'font/woff',
            '.woff2': 'font/woff2',
            '.ttf': 'font/ttf',
            '.otf': 'font/otf'
        };
    }

    async serveFile(req, res, pathname) {
        const clientPath = path.join(this.workingDir, pathname);
        
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

    async serveDashboardFile(req, res, pathname) {
        let filePath;
        
        if (pathname === '/management' || pathname === '/management/') {
            filePath = path.join(this.dashboardPath, 'login.html');
        } else {
            const requestedFile = pathname.replace('/management/', '');
            filePath = path.join(this.dashboardPath, requestedFile);
        }
        
        try {
            const content = await fs.readFile(filePath);
            const ext = path.extname(filePath);
            const contentType = this.getContentType(ext);
            
            res.statusCode = 200;
            res.setHeader('Content-Type', contentType);
            res.end(content);
        } catch (err) {
            // Try index.html as fallback
            try {
                const indexContent = await fs.readFile(
                    path.join(this.dashboardPath, 'index.html')
                );
                res.statusCode = 200;
                res.setHeader('Content-Type', 'text/html');
                res.end(indexContent);
            } catch {
                res.statusCode = 404;
                res.end('Dashboard not found');
            }
        }
    }

    async serveStatic(req, res, hostname, pathname) {
        const staticPath = path.join(this.workingDir, 'agents', 'static', hostname);
        const filePath = path.join(staticPath, pathname);

        try {
            const stats = await fs.stat(filePath);
            
            if (stats.isFile()) {
                const content = await fs.readFile(filePath);
                const ext = path.extname(filePath);
                const contentType = this.getContentType(ext);
                
                res.statusCode = 200;
                res.setHeader('Content-Type', contentType);
                res.end(content);
            } else if (stats.isDirectory()) {
                // Try index.html
                const indexPath = path.join(filePath, 'index.html');
                const indexContent = await fs.readFile(indexPath);
                res.statusCode = 200;
                res.setHeader('Content-Type', 'text/html');
                res.end(indexContent);
            }
        } catch (err) {
            this.serve404(res);
        }
    }

    serve404(res) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/html');
        res.end(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>404 - Not Found</title>
                <style>
                    body {
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                        text-align: center;
                        padding: 50px;
                        background: #f5f5f5;
                    }
                    h1 { color: #333; margin-bottom: 20px; }
                    p { color: #666; margin-bottom: 30px; }
                    a {
                        color: #667eea;
                        text-decoration: none;
                        font-weight: 500;
                    }
                    a:hover { text-decoration: underline; }
                </style>
            </head>
            <body>
                <h1>404 - Page Not Found</h1>
                <p>The requested page was not found.</p>
                <a href="/management">Go to Management Dashboard</a>
            </body>
            </html>
        `);
    }

    getContentType(ext) {
        return this.contentTypes[ext] || 'application/octet-stream';
    }
}

module.exports = { StaticFileServer };