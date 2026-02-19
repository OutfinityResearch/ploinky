# DS06 - Web Interfaces

## Summary

Ploinky provides four web-based interfaces for interacting with agents: WebTTY (terminal), WebChat (chat), WebMeet (collaboration), and Dashboard (monitoring). This specification documents the architecture, authentication, and functionality of each interface.

## Background / Problem Statement

While the CLI provides comprehensive access, web interfaces enable:
- Browser-based terminal access without SSH
- User-friendly chat interface for AI agents
- Collaborative meetings with multiple participants
- Visual monitoring of system status

## Goals

1. **WebTTY**: Full terminal emulation in browser
2. **WebChat**: Conversational interface with markdown support
3. **WebMeet**: Multi-user collaboration with agents
4. **Dashboard**: Real-time system monitoring

## Non-Goals

- Native mobile applications
- Offline functionality
- End-to-end encryption (relies on HTTPS)

## Architecture Overview

### Web Interface Stack

```
┌─────────────────────────────────────────────────────────────────┐
│                        BROWSER                                   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────┐ │
│  │   WebTTY    │  │   WebChat   │  │   WebMeet   │  │Dashboard│ │
│  │  xterm.js   │  │   Custom    │  │   WebRTC    │  │  HTML   │ │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └────┬────┘ │
└─────────┼────────────────┼────────────────┼──────────────┼──────┘
          │ WebSocket      │ HTTP/SSE       │ WebSocket    │ HTTP
          ▼                ▼                ▼              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    ROUTER SERVER (8088)                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────┐ │
│  │webtty.js    │  │webchat.js   │  │webmeet.js   │  │dashboard│ │
│  │Handler      │  │Handler      │  │Handler      │  │.js      │ │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └────┬────┘ │
└─────────┼────────────────┼────────────────┼──────────────┼──────┘
          │                │                │              │
          ▼                ▼                ▼              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    AGENT CONTAINERS                              │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                    AgentServer (MCP)                         ││
│  │  ┌───────────┐  ┌───────────┐  ┌───────────┐               ││
│  │  │ stdin/out │  │   Tools   │  │ Resources │               ││
│  │  └───────────┘  └───────────┘  └───────────┘               ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

## Data Models

### Authentication Tokens

```javascript
/**
 * @typedef {Object} WebToken
 * @property {string} token - 32-byte hex token
 * @property {string} interface - "webtty" | "webchat" | "webmeet" | "dashboard"
 * @property {string} [agent] - Associated agent (for webtty/webchat)
 * @property {Date} createdAt - Token creation time
 * @property {Date} [expiresAt] - Optional expiration
 */

/**
 * Generate secure web token
 * @param {string} interface - Interface name
 * @param {string} [agent] - Agent name
 * @returns {string} 32-byte hex token
 */
function generateWebToken(interface, agent) {
  const token = crypto.randomBytes(32).toString('hex');

  // Store in .secrets
  const key = agent
    ? `${interface.toUpperCase()}_TOKEN_${agent.toUpperCase()}`
    : `${interface.toUpperCase()}_TOKEN`;

  saveSecret(key, token);

  return token;
}
```

### Session State

```javascript
/**
 * @typedef {Object} WebSession
 * @property {string} sessionId - Unique session identifier
 * @property {string} interface - Interface type
 * @property {string} agent - Connected agent
 * @property {WebSocket} [ws] - WebSocket connection (webtty/webmeet)
 * @property {Date} connectedAt - Connection timestamp
 * @property {Object} state - Interface-specific state
 */
```

## API Contracts

### WebTTY

#### HTTP Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/webtty/:agent` | Serve WebTTY HTML page |
| GET | `/webtty/:agent/ws` | WebSocket upgrade for terminal |

#### WebSocket Protocol

```javascript
// Client -> Server messages
interface TTYClientMessage {
  type: 'input' | 'resize';
  data?: string;           // For 'input': terminal input data
  cols?: number;           // For 'resize': terminal columns
  rows?: number;           // For 'resize': terminal rows
}

// Server -> Client messages
interface TTYServerMessage {
  type: 'output' | 'exit' | 'error';
  data?: string;           // For 'output': terminal output data
  code?: number;           // For 'exit': exit code
  message?: string;        // For 'error': error message
}
```

#### Handler Implementation

```javascript
// cli/server/handlers/webtty.js

/**
 * Handle WebTTY page request
 */
export async function handleWebttyPage(req, res, { agent }) {
  // Validate token
  const token = req.query.token;
  if (!validateToken('webtty', agent, token)) {
    return res.status(401).send(renderLoginPage('webtty', agent));
  }

  // Render terminal page
  const html = renderWebttyPage({
    agent,
    wsUrl: `/webtty/${agent}/ws?token=${token}`
  });

  res.send(html);
}

/**
 * Handle WebTTY WebSocket connection
 */
export async function handleWebttyWebSocket(ws, req, { agent }) {
  // Create PTY in container
  const pty = await createContainerPty(agent);

  // Bridge PTY <-> WebSocket
  pty.onData(data => {
    ws.send(JSON.stringify({ type: 'output', data }));
  });

  ws.on('message', msg => {
    const { type, data, cols, rows } = JSON.parse(msg);

    if (type === 'input') {
      pty.write(data);
    } else if (type === 'resize') {
      pty.resize(cols, rows);
    }
  });

  pty.onExit(({ exitCode }) => {
    ws.send(JSON.stringify({ type: 'exit', code: exitCode }));
    ws.close();
  });

  ws.on('close', () => {
    pty.kill();
  });
}
```

### WebChat

#### HTTP Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/webchat/:agent` | Serve WebChat HTML page |
| POST | `/webchat/:agent/message` | Send message to agent |
| GET | `/webchat/:agent/events` | SSE stream for responses |

#### Message Protocol

```javascript
/**
 * Chat message format
 * @typedef {Object} ChatMessage
 * @property {string} id - Message ID
 * @property {string} role - "user" | "assistant" | "system"
 * @property {string} content - Message content (markdown)
 * @property {string} [agentName] - Source agent name
 * @property {Date} timestamp - Message timestamp
 * @property {Object} [metadata] - Additional metadata
 */

/**
 * Send message request
 * @typedef {Object} SendMessageRequest
 * @property {string} content - User message content
 * @property {Object} [context] - Additional context
 * @property {string[]} [attachments] - File attachment IDs
 */

/**
 * SSE event types
 * - message: New message from agent
 * - chunk: Streaming response chunk
 * - done: Response complete
 * - error: Error occurred
 */
```

#### Handler Implementation

```javascript
// cli/server/handlers/webchat.js

/**
 * Handle message submission
 */
export async function handleSendMessage(req, res, { agent }) {
  const { content, context, attachments } = req.body;

  // Create user message
  const userMessage = {
    id: crypto.randomUUID(),
    role: 'user',
    content,
    timestamp: new Date()
  };

  // Send to agent via MCP
  const mcpRequest = {
    jsonrpc: '2.0',
    id: userMessage.id,
    method: 'tools/call',
    params: {
      name: 'chat',
      arguments: { message: content, context }
    }
  };

  // Stream response
  const response = await callAgentMCP(agent, mcpRequest, { stream: true });

  res.json({
    messageId: userMessage.id,
    status: 'processing'
  });
}

/**
 * Handle SSE event stream
 */
export async function handleEventStream(req, res, { agent }) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // Subscribe to agent events
  const subscription = subscribeToAgent(agent, (event) => {
    res.write(`event: ${event.type}\n`);
    res.write(`data: ${JSON.stringify(event.data)}\n\n`);
  });

  req.on('close', () => {
    subscription.unsubscribe();
  });
}
```

### WebMeet

#### HTTP Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/webmeet` | Serve WebMeet HTML page |
| GET | `/webmeet/ws` | WebSocket for signaling |
| POST | `/webmeet/room` | Create meeting room |

#### WebRTC Signaling Protocol

```javascript
/**
 * Signaling message types
 */
interface SignalingMessage {
  type: 'join' | 'leave' | 'offer' | 'answer' | 'ice-candidate' | 'agent-message';
  roomId: string;
  participantId: string;
  data?: any;
}

/**
 * Room state
 */
interface MeetingRoom {
  id: string;
  moderator: string;           // Moderator agent name
  participants: Participant[];
  agents: string[];            // Connected agents
  createdAt: Date;
}

interface Participant {
  id: string;
  name: string;
  type: 'human' | 'agent';
  stream?: MediaStream;
}
```

#### Handler Implementation

```javascript
// cli/server/handlers/webmeet.js

/**
 * Handle WebMeet page
 */
export async function handleWebmeetPage(req, res) {
  const { room, moderator } = req.query;

  const html = renderWebmeetPage({
    roomId: room || crypto.randomUUID(),
    moderator,
    wsUrl: `/webmeet/ws`
  });

  res.send(html);
}

/**
 * Handle WebRTC signaling
 */
export async function handleSignaling(ws, req) {
  let participantId = null;
  let roomId = null;

  ws.on('message', async (msg) => {
    const signal = JSON.parse(msg);

    switch (signal.type) {
      case 'join':
        roomId = signal.roomId;
        participantId = signal.participantId;
        await joinRoom(roomId, participantId, ws);
        broadcastToRoom(roomId, {
          type: 'participant-joined',
          participantId
        });
        break;

      case 'offer':
      case 'answer':
      case 'ice-candidate':
        // Forward to target participant
        forwardSignal(signal);
        break;

      case 'agent-message':
        // Route message to moderator agent
        await sendToAgent(signal.data);
        break;
    }
  });

  ws.on('close', () => {
    if (roomId && participantId) {
      leaveRoom(roomId, participantId);
      broadcastToRoom(roomId, {
        type: 'participant-left',
        participantId
      });
    }
  });
}
```

### Dashboard

#### HTTP Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/dashboard` | Serve Dashboard HTML page |
| GET | `/api/status` | System status JSON |
| GET | `/api/agents` | Agent list with status |
| GET | `/api/logs/:service` | Service logs |
| POST | `/api/agents/:agent/restart` | Restart agent |

#### Status Response

```javascript
/**
 * Dashboard status response
 * @typedef {Object} DashboardStatus
 * @property {string} status - "healthy" | "degraded" | "error"
 * @property {number} uptime - Router uptime in seconds
 * @property {string} profile - Active profile
 * @property {RouterStatus} router - Router status
 * @property {AgentStatus[]} agents - Agent statuses
 * @property {SystemMetrics} system - System metrics
 */

interface AgentStatus {
  name: string;
  status: 'running' | 'stopped' | 'error';
  containerId: string;
  port: number;
  health: 'healthy' | 'unhealthy' | 'unknown';
  uptime: number;
  taskCount: number;
}

interface SystemMetrics {
  cpuUsage: number;
  memoryUsage: number;
  diskUsage: number;
}
```

## Behavioral Specification

### Authentication Flow

```
1. User requests web interface URL

2. Router checks for token:
   - Query param: ?token=<token>
   - Cookie: ploinky_<interface>_token

3. Token validation:
   - Load token from .ploinky/.secrets
   - Compare with provided token
   - Check expiration (if set)

4. If valid:
   - Set cookie for convenience
   - Serve interface page
   - Establish WebSocket (if applicable)

5. If invalid:
   - Redirect to login page
   - Display error message
   - Log access attempt
```

### WebTTY Session Lifecycle

```
1. User connects to /webtty/:agent?token=xxx

2. Server validates token

3. Server creates PTY in container:
   docker exec -it <container> /bin/sh

4. WebSocket established

5. Bidirectional data flow:
   User keystrokes -> WebSocket -> PTY stdin
   PTY stdout -> WebSocket -> User terminal

6. On disconnect:
   - Kill PTY process
   - Close WebSocket
   - Log session end
```

### WebChat Message Flow

```
1. User types message in chat interface

2. POST /webchat/:agent/message
   {content: "Hello", context: {...}}

3. Server creates MCP request:
   {method: "tools/call", params: {name: "chat", ...}}

4. Forward to agent container

5. Agent processes and streams response

6. Server streams via SSE:
   event: chunk
   data: {"content": "Hi there..."}

7. Final event:
   event: done
   data: {"messageId": "..."}
```

## Configuration

### Token Storage

```bash
# .ploinky/.secrets
WEBTTY_TOKEN_NODEDEV=abc123...
WEBCHAT_TOKEN_NODEDEV=def456...
WEBMEET_TOKEN=ghi789...
DASHBOARD_TOKEN=jkl012...
```

### Interface URLs

| Interface | URL Pattern |
|-----------|-------------|
| WebTTY | `http://localhost:8088/webtty/:agent?token=xxx` |
| WebChat | `http://localhost:8088/webchat/:agent?token=xxx` |
| WebMeet | `http://localhost:8088/webmeet?room=xxx&moderator=agent` |
| Dashboard | `http://localhost:8088/dashboard?token=xxx` |

## Error Handling

| Error | HTTP Status | User Message |
|-------|-------------|--------------|
| Invalid token | 401 | "Invalid or expired token. Please use the CLI to generate a new token." |
| Agent not found | 404 | "Agent 'xxx' not found. Check that the agent is enabled." |
| Agent not running | 503 | "Agent 'xxx' is not running. Start the workspace first." |
| WebSocket error | N/A | "Connection lost. Attempting to reconnect..." |

## Security Considerations

- **Token Security**: Tokens are 32-byte random hex strings
- **HTTPS Recommended**: In production, use HTTPS for all web traffic
- **Session Timeout**: Consider implementing token expiration
- **CORS**: Restrict to same-origin requests
- **Input Sanitization**: Escape terminal output to prevent XSS

## WebChat Advanced Features

### Tab Synchronization

WebChat supports multiple browser tabs per agent session. Each tab gets a unique `TAB_ID` tracked via cookies. Tabs share the same session but maintain independent TTY connections. Messages are synchronized across tabs via the shared session.

### Quick Commands

The `commandResolver.js` module resolves CLI commands for webchat sessions:
- Reads from routing config (`.ploinky/routing.json`)
- Extracts from manifest: `manifest.cli` or `manifest.commands.cli`, `manifest.run` or `manifest.commands.run`
- Returns: `{ host: "command", container: "command", source: "manifest|routing" }`
- Quick command buttons are rendered in the chat interface for one-click execution

### File Upload & Camera

`webchat/upload.js` provides:
- Drag-and-drop file upload
- File input selection
- Camera photo capture (via `getUserMedia`)
- QR code scanning (via `webLibs/qrLib/`)
- Image preview before upload
- Multi-file support with progress tracking
- Files stored as blobs via the `/blobs/` API

### Speech-to-Text (STT) Strategies

| Strategy | Module | Description |
|----------|--------|-------------|
| Browser | `strategies/stt/browser.js` | Web Speech API (`webkitSpeechRecognition`) |
| OpenAI | `strategies/stt/openai.js` | OpenAI Whisper API (server-side) |
| OpenAI Realtime | `strategies/stt/openai-realtime.js` | OpenAI Realtime API (streaming) |
| Noop | `strategies/stt/noop.js` | Disabled (no-op) |

Strategy selection configured per agent via TTS/STT provider settings.

### Text-to-Speech (TTS) Strategies

| Strategy | Module | Description |
|----------|--------|-------------|
| Browser | `strategies/tts/browser.js` | Web Speech Synthesis API |
| OpenAI | `strategies/tts/openai.js` | OpenAI TTS API (server-side) |
| Noop | `strategies/tts/noop.js` | Disabled (no-op) |

Server-side TTS strategies also exist in `cli/server/handlers/ttsStrategies/`. Voice selection and speech rate are configurable.

### Markdown Rendering

`webchat/markdown.js` (~300 lines) renders markdown to HTML in the chat interface:
- Code blocks with syntax highlighting
- Tables, lists, links
- Side panel links for detailed output
- View-more handling for long messages (configurable line limit)

### Side Panel

`webchat/sidePanel.js` provides a resizable side panel for viewing detailed output, linked from message content.

## Dashboard Components

The `dashboard/` directory contains modular JavaScript components:

| Module | Description |
|--------|-------------|
| `landingPage.js` | Main dashboard landing page and navigation |
| `configurations.js` | Workspace and agent configuration display |
| `repositories.js` | Repository management interface |
| `auth.js` | Authentication and SSO configuration |
| `observability.js` | System monitoring and metrics |
| `virtualHosts.js` | Virtual host and routing configuration |
| `common.js` | Shared utilities and UI components |

## Authentication Subsystem

### Architecture

The authentication system in `cli/server/auth/` supports dual-mode authentication:

| Module | Description |
|--------|-------------|
| `config.js` | SSO configuration loading from environment variables |
| `jwt.js` | JWT token decoding and verification |
| `jwksCache.js` | JWKS endpoint caching for key rotation |
| `keycloakClient.js` | Keycloak OAuth2 client integration |
| `pkce.js` | PKCE (Proof Key for Code Exchange) flow implementation |
| `service.js` | Auth service orchestration (ties all modules together) |
| `sessionStore.js` | In-memory session state management |
| `utils.js` | Authentication utility functions |

### Authentication Modes

**Legacy Token-Based**: Simple 32-byte hex tokens stored in `.ploinky/.secrets`. Each web interface gets its own token (e.g., `WEBTTY_TOKEN`, `WEBCHAT_TOKEN`).

**SSO (Keycloak/OIDC)**: Full OAuth2 with PKCE flow:
1. Client redirects to Keycloak authorization endpoint with PKCE challenge
2. User authenticates at Keycloak
3. Callback receives authorization code
4. Server exchanges code for tokens using PKCE verifier
5. JWT validated against JWKS endpoint (cached)
6. Session created in session store

### Component Token Management

`cli/server/utils/routerEnv.js` manages per-component tokens:

| Function | Description |
|----------|-------------|
| `refreshComponentToken(component)` | Generate new token for a web component |
| `ensureComponentToken(component)` | Ensure token exists, create if needed |
| `getComponentToken(component)` | Retrieve current token |

Components: `webtty`, `webchat`, `webmeet`, `dashboard`

### Server Manager

`cli/services/serverManager.js` handles port and token allocation for web interfaces:

| Function | Description |
|----------|-------------|
| `findAvailablePort(min, max)` | Random port allocation (10000-60000) |
| `isPortAvailable(port)` | Check if TCP port is free |
| `ensureServerConfig(name, opts)` | Ensure port + token for a web component |
| `loadServersConfig()` | Load from `.ploinky/servers.json` |
| `saveServersConfig(config)` | Persist to `.ploinky/servers.json` |
| `getAllServerStatuses()` | Check running status of all web servers |
| `isServerRunning(pidFile)` | Check PID file for running process |
| `stopServer(pidFile, name)` | Stop server by PID file |

### Workspace File Serving

The Router Server exposes a `/workspace-files/` endpoint that serves files from the workspace directory, enabling web interfaces to access workspace content (e.g., uploaded files, agent output).

## Success Criteria

1. WebTTY provides responsive terminal experience
2. WebChat supports markdown rendering, streaming, tabs, file upload, STT/TTS
3. WebMeet enables multi-user collaboration
4. Dashboard shows real-time system status with modular components
5. All interfaces authenticated via tokens or SSO
6. Camera capture and QR scanning functional in WebChat

## References

- [DS02 - Architecture](./DS02-architecture.md)
- [DS07 - MCP Protocol](./DS07-mcp-protocol.md)
- [DS05 - CLI Commands](./DS05-cli-commands.md)
- [DS08 - Profile System](./DS08-profile-system.md) - Secret injection for tokens
- [DS13 - Watchdog & Reliability](./DS13-watchdog-reliability.md) - Server process management
- [DS15 - Logging & Observability](./DS15-logging-observability.md) - Router logging
