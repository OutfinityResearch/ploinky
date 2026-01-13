# cli/server/handlers/blobs.js - Blob Storage Handler

## Overview

Handles HTTP requests for blob storage. Provides file upload/download API for agents with per-agent storage isolation, shared storage, range request support, and metadata tracking.

## Source File

`cli/server/handlers/blobs.js`

## Dependencies

```javascript
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

import { loadAgents } from '../../services/workspace.js';
```

## Internal Functions

### ensureSharedHostDir()

**Purpose**: Ensures shared host directory exists

**Returns**: (string) Path to shared directory

**Implementation**:
```javascript
function ensureSharedHostDir() {
    const dir = path.resolve(process.cwd(), 'shared');
    try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
    return dir;
}
```

### newId()

**Purpose**: Generates new blob ID

**Returns**: (string) 48-character hex string

**Implementation**:
```javascript
function newId() {
    return crypto.randomBytes(24).toString('hex');
}
```

### sanitizeId(id)

**Purpose**: Validates and sanitizes blob ID

**Parameters**:
- `id` (string): Blob ID to validate

**Returns**: (string|null) Sanitized ID or null if invalid

**Implementation**:
```javascript
function sanitizeId(id) {
    const safe = String(id || '').replace(/[^a-zA-Z0-9_.-]/g, '');
    return safe && safe === id ? safe : null;
}
```

### normalizeAgentSegment(segment)

**Purpose**: Normalizes URL-encoded agent segment

**Parameters**:
- `segment` (string): URL segment

**Returns**: (string) Decoded and trimmed segment

**Implementation**:
```javascript
function normalizeAgentSegment(segment) {
    if (!segment) return '';
    try {
        return decodeURIComponent(segment.trim());
    } catch (_) {
        return segment.trim();
    }
}
```

### resolveAgentRecord(agentSegment)

**Purpose**: Resolves agent from workspace configuration

**Parameters**:
- `agentSegment` (string): Agent name, optionally with repo prefix

**Returns**: `{ ok: boolean, status?: number, message?: string, agent?: Object }`

**Agent Object**:
```javascript
{
    requestSegment: string,    // Original segment
    canonicalName: string,     // Agent name
    repoName: string | null,   // Repository name
    projectPath: string,       // Absolute project path
    blobsDir: string,          // Path to blobs directory
    isShared: false
}
```

**Implementation**:
```javascript
function resolveAgentRecord(agentSegment) {
    const name = normalizeAgentSegment(agentSegment);
    if (!name) {
        return { ok: false, status: 400, message: 'Missing agent name in path.' };
    }

    // Parse repo:agent or repo/agent format
    let repoFilter = null;
    let agentFilter = name;
    const delimiterMatch = name.match(/[:/]/);
    if (delimiterMatch) {
        const [repoCandidate, agentCandidate] = name.split(/[:/]/);
        if (agentCandidate) {
            repoFilter = repoCandidate;
            agentFilter = agentCandidate;
        }
    }

    let map;
    try {
        map = loadAgents() || {};
    } catch (_) {
        map = {};
    }

    // Filter to enabled agents
    const entries = Object.entries(map)
        .filter(([key]) => key !== '_config')
        .map(([, rec]) => rec)
        .filter(rec => rec && rec.type === 'agent' && rec.agentName && rec.projectPath);

    // Match by name and optionally repo
    const matches = entries.filter(rec => {
        if (repoFilter && String(rec.repoName || '') !== repoFilter) return false;
        return String(rec.agentName) === agentFilter;
    });

    if (matches.length === 0) {
        return { ok: false, status: 404, message: `Agent '${name}' not found or not enabled.` };
    }

    // Handle ambiguous matches
    if (!repoFilter && matches.length > 1) {
        const firstPath = matches[0].projectPath;
        const allSame = matches.every(rec => rec.projectPath === firstPath);
        if (!allSame) {
            const repos = matches.map(rec => String(rec.repoName || '-')).join(', ');
            return {
                ok: false,
                status: 409,
                message: `Agent '${name}' is ambiguous. Specify as '<repo>:${agentFilter}'. Found in repos: ${repos}.`
            };
        }
    }

    const record = matches[0];
    const projectPath = path.resolve(record.projectPath);
    const blobsDir = path.join(projectPath, 'blobs');

    return {
        ok: true,
        agent: {
            requestSegment: agentSegment,
            canonicalName: record.agentName,
            repoName: record.repoName || null,
            projectPath,
            blobsDir,
            isShared: false
        }
    };
}
```

### resolveSharedRecord()

**Purpose**: Returns shared storage agent record

**Returns**: Agent record for shared storage

**Implementation**:
```javascript
function resolveSharedRecord() {
    const sharedDir = ensureSharedHostDir();
    return {
        ok: true,
        agent: {
            requestSegment: '',
            canonicalName: 'shared',
            repoName: null,
            projectPath: sharedDir,
            blobsDir: sharedDir,
            isShared: true
        }
    };
}
```

### getRouteUrl(agent, id)

**Purpose**: Constructs route URL for blob

**Parameters**:
- `agent` (Object): Agent record
- `id` (string): Blob ID

**Returns**: (string) Route URL

**Implementation**:
```javascript
function getRouteUrl(agent, id) {
    if (!agent) return `/blobs/${id}`;
    if (agent.isShared) {
        return `/blobs/${id}`;
    }
    const segment = encodeURIComponent(normalizeAgentSegment(agent.requestSegment || agent.canonicalName));
    return `/blobs/${segment}/${id}`;
}
```

### getLocalPath(agent, id)

**Purpose**: Gets local filesystem path for blob

**Parameters**:
- `agent` (Object): Agent record
- `id` (string): Blob ID

**Returns**: (string) Local path relative to working directory

**Implementation**:
```javascript
function getLocalPath(agent, id) {
    if (agent?.isShared) {
        return `/shared/${id}`;
    }
    return `blobs/${id}`;
}
```

### ensureAgentBlobsDir(agent)

**Purpose**: Ensures agent's blobs directory exists

**Parameters**:
- `agent` (Object): Agent record

### getAgentPaths(agent, id)

**Purpose**: Gets file paths for blob and metadata

**Parameters**:
- `agent` (Object): Agent record
- `id` (string): Blob ID

**Returns**: `{ filePath: string, metaPath: string, id: string } | null`

### readMeta(agent, id)

**Purpose**: Reads blob metadata

**Returns**: (Object|null) Metadata object or null

### writeMeta(agent, id, meta)

**Purpose**: Writes blob metadata

**Returns**: (boolean) Success status

### readHeader(req, name)

**Purpose**: Reads HTTP header case-insensitively

**Returns**: (string) Header value or empty string

### parseUploadFilename(req)

**Purpose**: Extracts filename from upload request

**Sources** (in order):
1. `X-File-Name` or `X-Filename` header
2. `Content-Disposition` header

**Returns**: (string) Filename or empty string

**Implementation**:
```javascript
function parseUploadFilename(req) {
    const rawHeader = readHeader(req, 'x-file-name') || readHeader(req, 'x-filename');
    if (rawHeader) {
        const value = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
        if (value) {
            try {
                return decodeURIComponent(String(value)).slice(0, 512);
            } catch (_) {
                return String(value).slice(0, 512);
            }
        }
    }

    const contentDisposition = readHeader(req, 'content-disposition');
    if (contentDisposition && /filename=/i.test(contentDisposition)) {
        const match = contentDisposition.match(/filename\*?=(?:UTF-8''|"?)([^";]+)/i);
        if (match && match[1]) {
            try {
                return decodeURIComponent(match[1]).slice(0, 512);
            } catch (_) {
                return String(match[1]).slice(0, 512);
            }
        }
    }

    return '';
}
```

### handlePost(req, res, agent)

**Purpose**: Handles blob upload

**Method**: POST

**Headers**:
- `X-Mime-Type` or `Content-Type`: MIME type
- `X-File-Name` or `X-Filename`: Original filename

**Response**: (201 Created)
```json
{
    "id": "abc123...",
    "localPath": "blobs/abc123...",
    "size": 1234,
    "mime": "application/pdf",
    "agent": "my-agent",
    "filename": "document.pdf",
    "downloadUrl": "https://host/blobs/my-agent/abc123..."
}
```

**Implementation**:
```javascript
function handlePost(req, res, agent) {
    try {
        const mime = req.headers['x-mime-type'] || req.headers['content-type'] || 'application/octet-stream';
        const id = newId();
        ensureAgentBlobsDir(agent);
        const paths = getAgentPaths(agent, id);
        if (!paths) { res.writeHead(400); return res.end('Bad id'); }

        const out = fs.createWriteStream(paths.filePath);
        let size = 0;
        const originalName = parseUploadFilename(req);
        req.on('data', chunk => { size += chunk.length; });
        req.pipe(out);

        out.on('finish', () => {
            const displayName = originalName || null;
            const routeUrl = getRouteUrl(agent, id);
            const localPath = getLocalPath(agent, id);

            // Build absolute URL from forwarded headers
            const protoHeader = readHeader(req, 'x-forwarded-proto');
            const forwardedHost = readHeader(req, 'x-forwarded-host');
            const hostHeader = readHeader(req, 'host');
            const proto = protoHeader ? String(protoHeader).split(',')[0].trim()
                : (req.socket?.encrypted ? 'https' : 'http');
            const host = forwardedHost || hostHeader || '';
            const absoluteUrl = host ? `${proto}://${host}${routeUrl}` : null;

            const meta = {
                id,
                mime,
                size,
                createdAt: new Date().toISOString(),
                agent: agent.canonicalName,
                repo: agent.repoName,
                filename: displayName,
                localPath,
                downloadUrl: absoluteUrl
            };
            writeMeta(agent, id, meta);

            res.writeHead(201, {
                'Content-Type': 'application/json',
                'X-Content-Type-Options': 'nosniff'
            });
            res.end(JSON.stringify({
                id,
                localPath,
                size,
                mime,
                agent: agent.canonicalName,
                filename: displayName,
                downloadUrl: absoluteUrl
            }));
        });

        out.on('error', (e) => {
            try { fs.unlinkSync(paths.filePath); } catch (_) { }
            res.writeHead(500);
            res.end('Write error');
        });
    } catch (e) {
        res.writeHead(500);
        res.end('Upload error');
    }
}
```

### streamRange(req, res, filePath, meta)

**Purpose**: Streams file with range request support

**Headers Supported**:
- `Range: bytes=start-end`

**Response Headers**:
- `Content-Type`: From metadata
- `Content-Length`: Byte count
- `Content-Range`: For partial responses
- `Accept-Ranges: bytes`

**Implementation**:
```javascript
function streamRange(req, res, filePath, meta) {
    try {
        const stat = fs.statSync(filePath);
        const size = stat.size;
        const range = req.headers['range'];

        if (range && /^bytes=/.test(range)) {
            const m = range.match(/bytes=(\d+)-(\d+)?/);
            if (m) {
                const start = parseInt(m[1], 10);
                const end = m[2] ? parseInt(m[2], 10) : size - 1;
                if (start <= end && start < size) {
                    res.writeHead(206, {
                        'Content-Type': meta?.mime || 'application/octet-stream',
                        'Content-Length': (end - start + 1),
                        'Content-Range': `bytes ${start}-${end}/${size}`,
                        'Accept-Ranges': 'bytes',
                        'X-Content-Type-Options': 'nosniff'
                    });
                    return fs.createReadStream(filePath, { start, end }).pipe(res);
                }
            }
        }

        // Full response
        res.writeHead(200, {
            'Content-Type': meta?.mime || 'application/octet-stream',
            'Content-Length': size,
            'Accept-Ranges': 'bytes',
            'X-Content-Type-Options': 'nosniff'
        });
        fs.createReadStream(filePath).pipe(res);
    } catch (e) {
        res.writeHead(500);
        res.end('Read error');
    }
}
```

### handleGetHead(req, res, agent, id, isHead)

**Purpose**: Handles blob download and HEAD requests

**Methods**: GET, HEAD

**Response**: File stream or metadata headers

## Public API

### handleBlobs(req, res)

**Purpose**: Main request handler for blob routes

**Parameters**:
- `req` (http.IncomingMessage): HTTP request
- `res` (http.ServerResponse): HTTP response

**Routes**:

| Path | Method | Description |
|------|--------|-------------|
| `POST /blobs` | POST | Upload to shared storage |
| `POST /blobs/:agent` | POST | Upload to agent storage |
| `GET /blobs/:id` | GET | Download from shared storage |
| `HEAD /blobs/:id` | HEAD | Get shared blob metadata |
| `GET /blobs/:agent/:id` | GET | Download from agent storage |
| `HEAD /blobs/:agent/:id` | HEAD | Get agent blob metadata |

**Implementation**:
```javascript
function handleBlobs(req, res) {
    const u = new URL(req.url || '/blobs', `http://${req.headers.host || 'localhost'}`);
    const pathname = u.pathname || '/blobs';
    const segments = pathname.split('/').filter(Boolean);

    if (segments.length === 0 || segments[0] !== 'blobs') {
        res.writeHead(404);
        return res.end('Not Found');
    }

    // POST /blobs - shared upload
    if (req.method === 'POST' && segments.length === 1) {
        const resolved = resolveSharedRecord();
        return handlePost(req, res, resolved.agent);
    }

    // POST /blobs/:agent - agent upload
    if (req.method === 'POST' && segments.length === 2) {
        const agentSegment = segments[1];
        const resolved = resolveAgentRecord(agentSegment);
        if (!resolved.ok) {
            res.writeHead(resolved.status, { 'Content-Type': 'text/plain' });
            res.end(resolved.message);
            return;
        }
        return handlePost(req, res, resolved.agent);
    }

    // GET/HEAD /blobs/:id - shared download
    if ((req.method === 'GET' || req.method === 'HEAD') && segments.length === 2) {
        const idSegment = segments[1];
        const safeId = sanitizeId(idSegment);
        if (!safeId) {
            res.writeHead(400);
            return res.end('Bad id');
        }
        const resolved = resolveSharedRecord();
        return handleGetHead(req, res, resolved.agent, safeId, req.method === 'HEAD');
    }

    // GET/HEAD /blobs/:agent/:id - agent download
    if ((req.method === 'GET' || req.method === 'HEAD') && segments.length === 3) {
        const agentSegment = segments[1];
        const idSegment = segments[2];
        const resolved = resolveAgentRecord(agentSegment);
        if (!resolved.ok) {
            res.writeHead(resolved.status, { 'Content-Type': 'text/plain' });
            res.end(resolved.message);
            return;
        }
        const safeId = sanitizeId(idSegment);
        if (!safeId) {
            res.writeHead(400);
            return res.end('Bad id');
        }
        return handleGetHead(req, res, resolved.agent, safeId, req.method === 'HEAD');
    }

    res.writeHead(404);
    res.end('Not Found');
}
```

## Exports

```javascript
export { handleBlobs };
```

## Metadata File Format

Stored as `{id}.json`:
```json
{
    "id": "abc123def456...",
    "mime": "application/pdf",
    "size": 123456,
    "createdAt": "2024-01-15T10:30:00.000Z",
    "agent": "my-agent",
    "repo": "basic",
    "filename": "document.pdf",
    "localPath": "blobs/abc123def456...",
    "downloadUrl": "https://example.com/blobs/my-agent/abc123def456..."
}
```

## Storage Layout

```
workspace/
├── shared/                    # Shared storage
│   ├── {id}                   # Blob file
│   └── {id}.json              # Metadata
└── projects/
    └── my-agent/
        └── blobs/             # Agent storage
            ├── {id}
            └── {id}.json
```

## Usage Example

```javascript
import { handleBlobs } from './handlers/blobs.js';

// In server request handler
if (req.url.startsWith('/blobs')) {
    handleBlobs(req, res);
    return;
}

// Upload example (client)
const response = await fetch('/blobs/my-agent', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/pdf',
        'X-File-Name': 'document.pdf'
    },
    body: fileContent
});
const { id, downloadUrl } = await response.json();

// Download example (client)
const blob = await fetch(`/blobs/my-agent/${id}`);
```

## Related Modules

- [service-workspace.md](../../services/workspace/service-workspace.md) - Agent loading
- [server-routing-server.md](../server-routing-server.md) - Request routing
