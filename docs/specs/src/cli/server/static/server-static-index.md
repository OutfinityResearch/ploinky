# cli/server/static/index.js - Static File Serving

## Overview

Provides static file serving with configurable host paths, MIME type detection, and support for both global static content and per-agent static directories. Includes MCP Browser Client serving.

## Source File

`cli/server/static/index.js`

## Dependencies

```javascript
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
```

## Constants & Configuration

```javascript
const ROUTING_FILE = path.resolve('.ploinky/routing.json');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../../../');
const MCP_BROWSER_CLIENT_URL = '/MCPBrowserClient.js';
const MCP_BROWSER_CLIENT_FILE = path.resolve(PROJECT_ROOT, 'Agent/client/MCPBrowserClient.js');
const PROJECT_WEB_LIBS = path.resolve(PROJECT_ROOT, 'webLibs');
```

## Internal Functions

### readRouting()

**Purpose**: Reads routing configuration from .ploinky/routing.json

**Returns**: (Object) Routing configuration or empty object

**Implementation**:
```javascript
function readRouting() {
    try {
        return JSON.parse(fs.readFileSync(ROUTING_FILE, 'utf8')) || {};
    } catch (_) {
        return {};
    }
}
```

### getStaticHostPath()

**Purpose**: Gets configured static host path

**Returns**: (string|null) Absolute path to static directory or null

**Implementation**:
```javascript
function getStaticHostPath() {
    const cfg = readRouting();
    const hostPath = cfg?.static?.hostPath;
    if (!hostPath) return null;
    const abs = path.resolve(hostPath);
    try {
        if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) return abs;
    } catch (_) { }
    return null;
}
```

### dedupe(paths)

**Purpose**: Deduplicates and validates directory paths

**Parameters**:
- `paths` (string[]): Array of paths

**Returns**: (string[]) Unique existing directory paths

### getBaseDirs(appName, fallbackDir)

**Purpose**: Gets base directories to search for static files

**Parameters**:
- `appName` (string): Application name
- `fallbackDir` (string): Fallback directory path

**Returns**: (string[]) List of directories to search

**Search Order**:
1. Static host path subdirectories (web/, apps/, static/, assets/, direct)
2. Project webLibs directory
3. Fallback directory

**Implementation**:
```javascript
function getBaseDirs(appName, fallbackDir) {
    const dirs = [];
    const staticRoot = getStaticHostPath();
    const variants = Array.from(new Set([appName, appName.toLowerCase()]));

    if (staticRoot) {
        for (const variant of variants) {
            dirs.push(path.join(staticRoot, 'web', variant));
            dirs.push(path.join(staticRoot, 'apps', variant));
            dirs.push(path.join(staticRoot, 'static', variant));
            dirs.push(path.join(staticRoot, 'assets', variant));
            dirs.push(path.join(staticRoot, variant));
        }
        dirs.push(staticRoot);
    }
    dirs.push(PROJECT_WEB_LIBS);
    dirs.push(fallbackDir);
    return dedupe(dirs);
}
```

### sanitizeRelative(relPath)

**Purpose**: Sanitizes relative path to prevent directory traversal

**Parameters**:
- `relPath` (string): Relative path

**Returns**: (string|null) Sanitized path or null if invalid

**Implementation**:
```javascript
function sanitizeRelative(relPath) {
    const cleaned = String(relPath || '').replace(/[\\]+/g, '/').replace(/^\/+/, '');
    if (cleaned.includes('..')) return null;
    return cleaned;
}
```

### getMimeType(filePath)

**Purpose**: Gets MIME type for file extension

**Parameters**:
- `filePath` (string): File path

**Returns**: (string) MIME type

**Implementation**:
```javascript
function getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const map = {
        '.js': 'application/javascript',
        '.mjs': 'application/javascript',
        '.css': 'text/css',
        '.svg': 'image/svg+xml',
        '.html': 'text/html',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.ico': 'image/x-icon'
    };
    return map[ext] || 'application/octet-stream';
}
```

### resolveStaticFile(requestPath)

**Purpose**: Resolves static file from request path

**Parameters**:
- `requestPath` (string): URL path

**Returns**: (string|null) Absolute file path or null

**Behavior**:
- Handles directory requests with index.html fallback
- Searches for index.html, index.htm, default.html in directories

### safeJoin(base, rel)

**Purpose**: Safely joins paths preventing traversal outside base

**Parameters**:
- `base` (string): Base directory
- `rel` (string): Relative path

**Returns**: (string|null) Absolute path or null if traversal detected

## Public API

### resolveAssetPath(appName, fallbackDir, relPath)

**Purpose**: Resolves asset path across multiple base directories

**Parameters**:
- `appName` (string): Application name
- `fallbackDir` (string): Fallback directory
- `relPath` (string): Relative path to asset

**Returns**: (string|null) Absolute file path or null

**Implementation**:
```javascript
function resolveAssetPath(appName, fallbackDir, relPath) {
    const sanitized = sanitizeRelative(relPath);
    if (!sanitized) return null;
    const bases = getBaseDirs(appName, fallbackDir);
    for (const base of bases) {
        const candidates = [
            path.join(base, sanitized),
            path.join(base, 'assets', sanitized)
        ];
        for (const candidate of candidates) {
            try {
                if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
                    return candidate;
                }
            } catch (_) { }
        }
    }
    return null;
}
```

### resolveFirstAvailable(appName, fallbackDir, filenames)

**Purpose**: Finds first available file from list of candidates

**Parameters**:
- `appName` (string): Application name
- `fallbackDir` (string): Fallback directory
- `filenames` (string|string[]): Filename(s) to try

**Returns**: (string|null) First found file path or null

**Implementation**:
```javascript
function resolveFirstAvailable(appName, fallbackDir, filenames) {
    const list = Array.isArray(filenames) ? filenames : [filenames];
    for (const name of list) {
        const filePath = resolveAssetPath(appName, fallbackDir, name);
        if (filePath) return filePath;
    }
    return null;
}
```

### sendFile(res, filePath)

**Purpose**: Sends file with appropriate MIME type

**Parameters**:
- `res` (http.ServerResponse): HTTP response
- `filePath` (string): Absolute file path

**Returns**: (boolean) True if sent successfully

**Implementation**:
```javascript
function sendFile(res, filePath) {
    try {
        const mime = getMimeType(filePath);
        res.writeHead(200, { 'Content-Type': mime });
        res.end(fs.readFileSync(filePath));
        return true;
    } catch (err) {
        return false;
    }
}
```

### serveStaticRequest(req, res)

**Purpose**: Serves static file request from global static host

**Parameters**:
- `req` (http.IncomingMessage): HTTP request
- `res` (http.ServerResponse): HTTP response

**Returns**: (boolean) True if request was handled

**Implementation**:
```javascript
function serveStaticRequest(req, res) {
    try {
        const parsed = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
        const pathname = decodeURIComponent(parsed.pathname || '/');

        // Serve MCP Browser Client
        if (pathname === MCP_BROWSER_CLIENT_URL) {
            try {
                const data = fs.readFileSync(MCP_BROWSER_CLIENT_FILE);
                res.writeHead(200, { 'Content-Type': 'application/javascript' });
                res.end(data);
                return true;
            } catch (err) {
                return false;
            }
        }

        const root = getStaticHostPath();
        if (!root) return false;

        const rel = pathname.replace(/^\/+/, '');
        const target = resolveStaticFile(rel || '');
        if (target && sendFile(res, target)) return true;
    } catch (_) { }
    return false;
}
```

### getAgentHostPath(agentName)

**Purpose**: Gets static host path for specific agent

**Parameters**:
- `agentName` (string): Agent name

**Returns**: (string|null) Agent's static host path or null

**Implementation**:
```javascript
function getAgentHostPath(agentName) {
    const cfg = readRouting();
    const rec = cfg && cfg.routes ? cfg.routes[agentName] : null;
    if (!rec || !rec.hostPath) return null;
    try {
        const abs = path.resolve(rec.hostPath);
        if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) return abs;
    } catch (_) { }
    return null;
}
```

### resolveAgentStaticFile(agentName, agentRelPath)

**Purpose**: Resolves static file for agent

**Parameters**:
- `agentName` (string): Agent name
- `agentRelPath` (string): Relative path within agent static dir

**Returns**: (string|null) Absolute file path or null

### serveAgentStaticRequest(req, res)

**Purpose**: Serves static file from agent-specific directory

**Parameters**:
- `req` (http.IncomingMessage): HTTP request
- `res` (http.ServerResponse): HTTP response

**Returns**: (boolean) True if request was handled

**Implementation**:
```javascript
function serveAgentStaticRequest(req, res) {
    try {
        const parsed = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
        const pathname = decodeURIComponent(parsed.pathname || '/');
        const parts = pathname.split('/').filter(Boolean);
        if (parts.length < 2) return false; // need /agent/...

        const agent = parts[0];
        const rest = parts.slice(1).join('/');
        const target = resolveAgentStaticFile(agent, rest);
        if (target && sendFile(res, target)) return true;
    } catch (_) { }
    return false;
}
```

## Exports

```javascript
export {
    getStaticHostPath,
    resolveAssetPath,
    resolveFirstAvailable,
    sendFile,
    serveStaticRequest,
    getAgentHostPath,
    resolveAgentStaticFile,
    serveAgentStaticRequest
};
```

## Routing Configuration

File: `.ploinky/routing.json`
```json
{
    "static": {
        "hostPath": "/path/to/static/files"
    },
    "routes": {
        "my-agent": {
            "hostPath": "/path/to/agent/static"
        }
    }
}
```

## MIME Type Mappings

| Extension | MIME Type |
|-----------|-----------|
| .js, .mjs | application/javascript |
| .css | text/css |
| .svg | image/svg+xml |
| .html | text/html |
| .json | application/json |
| .png | image/png |
| .jpg, .jpeg | image/jpeg |
| .gif | image/gif |
| .ico | image/x-icon |
| (default) | application/octet-stream |

## Usage Example

```javascript
import {
    resolveAssetPath,
    resolveFirstAvailable,
    sendFile,
    serveStaticRequest,
    serveAgentStaticRequest
} from './static/index.js';

// In request handler
function handleRequest(req, res) {
    // Try agent-specific static first
    if (serveAgentStaticRequest(req, res)) return;

    // Then global static
    if (serveStaticRequest(req, res)) return;

    // Not found
    res.writeHead(404);
    res.end('Not Found');
}

// Direct asset resolution
const cssPath = resolveAssetPath('webchat', '/fallback', 'styles.css');
if (cssPath) {
    sendFile(res, cssPath);
}

// Template resolution
const templatePath = resolveFirstAvailable('webchat', '/fallback', ['chat.html', 'index.html']);
```

## Related Modules

- [server-routing-server.md](../server-routing-server.md) - Main server
- [server-handlers-webchat.md](../handlers/server-handlers-webchat.md) - WebChat handler
- [server-handlers-webtty.md](../handlers/server-handlers-webtty.md) - WebTTY handler
