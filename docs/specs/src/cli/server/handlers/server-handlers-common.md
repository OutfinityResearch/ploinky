# cli/server/handlers/common.js - Common HTTP Handler Utilities

## Overview

Provides common HTTP handler utilities including cookie parsing/building, JSON body parsing, multipart form data parsing, and authentication token management for web applications.

## Source File

`cli/server/handlers/common.js`

## Dependencies

```javascript
import crypto from 'crypto';
import * as secretVars from '../../services/secretVars.js';
```

## Constants & Configuration

```javascript
const TOKEN_VARS = {
    webtty: 'WEBTTY_TOKEN',
    webchat: 'WEBCHAT_TOKEN',
    dashboard: 'WEBDASHBOARD_TOKEN',
    webmeet: 'WEBMEET_TOKEN',
    status: 'WEBDASHBOARD_TOKEN'
};
```

## Public API

### loadToken(component)

**Purpose**: Loads or generates authentication token for a web component

**Parameters**:
- `component` (string): Component name ('webtty', 'webchat', 'dashboard', 'webmeet', 'status')

**Returns**: (string) Authentication token

**Token Resolution Order**:
1. Workspace secrets file
2. Environment variable
3. Generated random token (32 bytes hex)

**Implementation**:
```javascript
function loadToken(component) {
    const varName = TOKEN_VARS[component];
    if (!varName) throw new Error(`Unknown component '${component}'`);

    const fromEnv = (key) => {
        const raw = process.env[key];
        return raw && String(raw).trim();
    };

    let token = '';
    let source = 'secrets';

    // Try secrets first
    try {
        const secrets = secretVars.parseSecrets();
        const raw = secrets[varName];
        if (raw && String(raw).trim()) {
            token = secretVars.resolveVarValue(varName);
        }
    } catch (_) {
        token = '';
    }

    // Fall back to environment
    if (!token) {
        const envToken = fromEnv(varName) || '';
        if (envToken) {
            token = envToken;
            source = 'env';
        }
    }

    // Generate if not found
    if (!token) {
        token = crypto.randomBytes(32).toString('hex');
        source = 'generated';
    }

    // Persist non-secrets tokens
    if (source !== 'secrets') {
        try { secretVars.setEnvVar(varName, token); } catch (_) { }
    }

    return token;
}
```

### parseCookies(req)

**Purpose**: Parses cookie header into a Map

**Parameters**:
- `req` (http.IncomingMessage): HTTP request

**Returns**: (Map<string, string>) Cookie name-value pairs

**Implementation**:
```javascript
function parseCookies(req) {
    const header = req.headers.cookie || '';
    const map = new Map();
    header.split(';').forEach((cookie) => {
        const idx = cookie.indexOf('=');
        if (idx > -1) {
            const key = cookie.slice(0, idx).trim();
            const value = cookie.slice(idx + 1).trim();
            if (key) map.set(key, value);
        }
    });
    return map;
}
```

### buildCookie(name, value, req, pathPrefix, options)

**Purpose**: Builds secure cookie string

**Parameters**:
- `name` (string): Cookie name
- `value` (string): Cookie value
- `req` (http.IncomingMessage): HTTP request (for secure detection)
- `pathPrefix` (string): Cookie path (default: '/')
- `options.maxAge` (number): Max age in seconds (default: 604800 = 7 days)

**Returns**: (string) Cookie header value

**Cookie Attributes**:
- `Path`: Specified path prefix
- `HttpOnly`: Always set
- `SameSite=Strict`: CSRF protection
- `Secure`: Set if HTTPS detected
- `Max-Age`: Custom or default

**Implementation**:
```javascript
function buildCookie(name, value, req, pathPrefix, options = {}) {
    const parts = [`${name}=${value}`];
    const prefix = pathPrefix || '/';
    parts.push(`Path=${prefix}`);
    parts.push('HttpOnly');
    parts.push('SameSite=Strict');

    // Detect secure connection
    const secure = Boolean(req.socket && req.socket.encrypted) ||
        String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase() === 'https';
    if (secure) parts.push('Secure');

    // Max age (default 7 days)
    const maxAge = options.maxAge || 604800;
    parts.push(`Max-Age=${maxAge}`);

    return parts.join('; ');
}
```

### readJsonBody(req)

**Purpose**: Reads and parses JSON request body

**Parameters**:
- `req` (http.IncomingMessage): HTTP request

**Returns**: (Promise<Object>) Parsed JSON object

**Implementation**:
```javascript
function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
            try {
                const raw = Buffer.concat(chunks).toString('utf8');
                resolve(raw ? JSON.parse(raw) : {});
            } catch (err) {
                reject(err);
            }
        });
        req.on('error', reject);
    });
}
```

### appendSetCookie(res, cookie)

**Purpose**: Appends Set-Cookie header without overwriting existing cookies

**Parameters**:
- `res` (http.ServerResponse): HTTP response
- `cookie` (string): Cookie string to append

**Implementation**:
```javascript
function appendSetCookie(res, cookie) {
    if (!cookie) return;
    const existing = res.getHeader('Set-Cookie');
    if (!existing) {
        res.setHeader('Set-Cookie', cookie);
        return;
    }
    if (Array.isArray(existing)) {
        res.setHeader('Set-Cookie', [...existing, cookie]);
    } else {
        res.setHeader('Set-Cookie', [existing, cookie]);
    }
}
```

### parseMultipartFormData(req)

**Purpose**: Parses multipart/form-data request body

**Parameters**:
- `req` (http.IncomingMessage): HTTP request

**Returns**: (Promise<{fields: Object, files: Object}>) Parsed form data

**Return Structure**:
```javascript
{
    fields: {
        'fieldName': 'text value'
    },
    files: {
        'fileName': {
            name: string,
            filename: string,
            contentType: string,
            data: Buffer,
            text: null
        }
    }
}
```

**Implementation**:
```javascript
function parseMultipartFormData(req) {
    return new Promise((resolve, reject) => {
        const contentType = req.headers['content-type'] || '';
        const boundaryMatch = contentType.match(/boundary=(.+?)(?:;|$)/);

        if (!boundaryMatch) {
            reject(new Error('No boundary found in Content-Type'));
            return;
        }

        const boundary = '--' + boundaryMatch[1];
        const chunks = [];

        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
            try {
                const buffer = Buffer.concat(chunks);
                const parts = [];
                let start = 0;

                while (start < buffer.length) {
                    const boundaryIndex = buffer.indexOf(boundary, start);
                    if (boundaryIndex === -1) break;

                    const nextStart = boundaryIndex + boundary.length;
                    // Check for end boundary (--)
                    if (buffer[nextStart] === 0x2D && buffer[nextStart + 1] === 0x2D) {
                        break;
                    }

                    // Skip CRLF after boundary
                    start = nextStart + 2;

                    // Find end of headers
                    const headerEndIndex = buffer.indexOf('\r\n\r\n', start);
                    if (headerEndIndex === -1) break;

                    // Parse headers
                    const headerSection = buffer.slice(start, headerEndIndex).toString('utf8');
                    const headers = {};
                    headerSection.split('\r\n').forEach(line => {
                        const colonIndex = line.indexOf(':');
                        if (colonIndex > -1) {
                            const key = line.slice(0, colonIndex).trim().toLowerCase();
                            const value = line.slice(colonIndex + 1).trim();
                            headers[key] = value;
                        }
                    });

                    // Extract name and filename
                    const disposition = headers['content-disposition'] || '';
                    const nameMatch = disposition.match(/name="([^"]+)"/);
                    const filenameMatch = disposition.match(/filename="([^"]+)"/);

                    // Extract content
                    const contentStart = headerEndIndex + 4;
                    const nextBoundary = buffer.indexOf('\r\n' + boundary, contentStart);
                    const contentEnd = nextBoundary > -1 ? nextBoundary : buffer.length;
                    const content = buffer.slice(contentStart, contentEnd);

                    if (nameMatch) {
                        parts.push({
                            name: nameMatch[1],
                            filename: filenameMatch ? filenameMatch[1] : null,
                            contentType: headers['content-type'] || 'text/plain',
                            data: content,
                            text: filenameMatch ? null : content.toString('utf8')
                        });
                    }

                    start = contentEnd;
                }

                // Separate fields and files
                const fields = {};
                const files = {};
                parts.forEach(part => {
                    if (part.filename) {
                        files[part.name] = part;
                    } else {
                        fields[part.name] = part.text;
                    }
                });

                resolve({ fields, files });
            } catch (err) {
                reject(err);
            }
        });
        req.on('error', reject);
    });
}
```

## Exports

```javascript
export {
    loadToken,
    parseCookies,
    buildCookie,
    readJsonBody,
    appendSetCookie,
    parseMultipartFormData
};
```

## Usage Example

```javascript
import {
    loadToken,
    parseCookies,
    buildCookie,
    readJsonBody,
    appendSetCookie,
    parseMultipartFormData
} from './common.js';

// Load component token
const webchatToken = loadToken('webchat');

// Parse cookies
const cookies = parseCookies(req);
const sessionId = cookies.get('session_id');

// Build and set cookie
const cookie = buildCookie('session_id', 'abc123', req, '/webchat', { maxAge: 3600 });
appendSetCookie(res, cookie);

// Read JSON body
const body = await readJsonBody(req);
console.log(body.username);

// Parse multipart form (file upload)
const { fields, files } = await parseMultipartFormData(req);
console.log(fields.description);
console.log(files.avatar.filename, files.avatar.data.length);
```

## Token Variable Mapping

| Component | Environment Variable |
|-----------|---------------------|
| webtty | WEBTTY_TOKEN |
| webchat | WEBCHAT_TOKEN |
| dashboard | WEBDASHBOARD_TOKEN |
| webmeet | WEBMEET_TOKEN |
| status | WEBDASHBOARD_TOKEN |

## Related Modules

- [service-secret-vars.md](../../services/utils/service-secret-vars.md) - Secret variable management
- [server-handlers-webchat.md](./server-handlers-webchat.md) - WebChat handler
- [server-handlers-webtty.md](./server-handlers-webtty.md) - WebTTY handler
