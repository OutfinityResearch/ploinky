# cli/server/handlers/webmeet.js - WebMeet Handler

## Overview

Handles WebMeet room functionality including SSE event streaming, participant management, speaker queue, and agent integration. Provides real-time multi-party collaboration with optional AI moderator support.

## Source File

`cli/server/handlers/webmeet.js`

## Dependencies

```javascript
import { sendJson } from '../authHandlers.js';
import { appendLog } from '../utils/logger.js';
import { createAgentClient } from '../AgentClient.js';
```

## Constants

```javascript
// Room storage - Map of roomId to room data
const rooms = new Map();

// SSE client storage - Map of roomId to Set of response objects
const sseClients = new Map();

// Default room configuration
const DEFAULT_ROOM_CONFIG = {
    maxParticipants: 50,
    enableAgent: false,
    agentName: null,
    moderatorEnabled: false
};
```

## Data Structures

```javascript
/**
 * @typedef {Object} Room
 * @property {string} id - Room identifier
 * @property {string} name - Room display name
 * @property {Map<string, Participant>} participants - Connected participants
 * @property {string[]} speakerQueue - Queue of participant IDs wanting to speak
 * @property {string|null} currentSpeaker - Currently speaking participant ID
 * @property {Object} config - Room configuration
 * @property {number} createdAt - Creation timestamp
 */

/**
 * @typedef {Object} Participant
 * @property {string} id - Participant identifier
 * @property {string} name - Display name
 * @property {string} tabId - Browser tab identifier
 * @property {boolean} isModerator - Has moderator privileges
 * @property {boolean} isMuted - Audio muted state
 * @property {number} joinedAt - Join timestamp
 */

/**
 * @typedef {Object} SSEMessage
 * @property {string} type - Event type
 * @property {Object} data - Event payload
 * @property {number} timestamp - Event timestamp
 */
```

## Internal Functions

### generateRoomId()

**Purpose**: Generates unique room identifier

**Returns**: (string) 8-character alphanumeric ID

**Implementation**:
```javascript
function generateRoomId() {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let id = '';
    for (let i = 0; i < 8; i++) {
        id += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return id;
}
```

### broadcast(roomId, event, data, excludeTabId)

**Purpose**: Broadcasts SSE event to all clients in a room

**Parameters**:
- `roomId` (string): Target room ID
- `event` (string): Event type name
- `data` (Object): Event payload
- `excludeTabId` (string|null): Tab to exclude from broadcast

**Implementation**:
```javascript
function broadcast(roomId, event, data, excludeTabId = null) {
    const clients = sseClients.get(roomId);
    if (!clients) return;

    const message = JSON.stringify({
        type: event,
        data,
        timestamp: Date.now()
    });

    for (const client of clients) {
        if (excludeTabId && client.tabId === excludeTabId) continue;
        try {
            client.res.write(`event: ${event}\n`);
            client.res.write(`data: ${message}\n\n`);
        } catch (err) {
            appendLog(`[webmeet] SSE write error: ${err.message}`);
        }
    }
}
```

### sendToTab(roomId, tabId, event, data)

**Purpose**: Sends SSE event to specific tab

**Parameters**:
- `roomId` (string): Target room ID
- `tabId` (string): Target tab ID
- `event` (string): Event type name
- `data` (Object): Event payload

**Implementation**:
```javascript
function sendToTab(roomId, tabId, event, data) {
    const clients = sseClients.get(roomId);
    if (!clients) return false;

    const message = JSON.stringify({
        type: event,
        data,
        timestamp: Date.now()
    });

    for (const client of clients) {
        if (client.tabId === tabId) {
            try {
                client.res.write(`event: ${event}\n`);
                client.res.write(`data: ${message}\n\n`);
                return true;
            } catch (err) {
                appendLog(`[webmeet] SSE sendToTab error: ${err.message}`);
                return false;
            }
        }
    }
    return false;
}
```

### callAgent(roomId, agentName, prompt, context)

**Purpose**: Calls AI agent for moderation or assistance

**Parameters**:
- `roomId` (string): Room ID for context
- `agentName` (string): Target agent name
- `prompt` (string): Agent prompt/query
- `context` (Object): Additional context data

**Returns**: (Promise<Object>) Agent response

**Implementation**:
```javascript
async function callAgent(roomId, agentName, prompt, context = {}) {
    const room = rooms.get(roomId);
    if (!room) {
        throw new Error(`Room ${roomId} not found`);
    }

    const route = { hostPort: room.config.agentPort || 3001 };
    const client = createAgentClient(route);

    try {
        const response = await client.callTool('chat', {
            message: prompt,
            context: {
                roomId,
                roomName: room.name,
                participantCount: room.participants.size,
                ...context
            }
        });

        return response;
    } catch (err) {
        appendLog(`[webmeet] Agent call failed: ${err.message}`);
        throw err;
    }
}
```

### removeParticipant(roomId, participantId)

**Purpose**: Removes participant from room and cleans up

**Parameters**:
- `roomId` (string): Room ID
- `participantId` (string): Participant to remove

**Implementation**:
```javascript
function removeParticipant(roomId, participantId) {
    const room = rooms.get(roomId);
    if (!room) return;

    const participant = room.participants.get(participantId);
    if (!participant) return;

    room.participants.delete(participantId);

    // Remove from speaker queue
    const queueIndex = room.speakerQueue.indexOf(participantId);
    if (queueIndex !== -1) {
        room.speakerQueue.splice(queueIndex, 1);
    }

    // If was current speaker, clear
    if (room.currentSpeaker === participantId) {
        room.currentSpeaker = null;
        // Promote next in queue
        if (room.speakerQueue.length > 0) {
            room.currentSpeaker = room.speakerQueue.shift();
            broadcast(roomId, 'speaker_changed', {
                speakerId: room.currentSpeaker,
                queue: room.speakerQueue
            });
        }
    }

    broadcast(roomId, 'participant_left', {
        participantId,
        name: participant.name,
        participantCount: room.participants.size
    });

    appendLog(`[webmeet] ${participant.name} left room ${roomId}`);

    // Clean up empty room
    if (room.participants.size === 0) {
        rooms.delete(roomId);
        sseClients.delete(roomId);
        appendLog(`[webmeet] Room ${roomId} closed (empty)`);
    }
}
```

## Public API

### handleCreateRoom(req, res, config)

**Purpose**: Creates a new WebMeet room

**Parameters**:
- `req` (http.IncomingMessage): HTTP request
- `res` (http.ServerResponse): HTTP response
- `config` (Object): Room configuration

**Request Body**:
```json
{
    "name": "Team Standup",
    "maxParticipants": 10,
    "enableAgent": true,
    "agentName": "meeting-bot"
}
```

**Response**:
```json
{
    "success": true,
    "room": {
        "id": "abc12345",
        "name": "Team Standup",
        "joinUrl": "/webmeet/abc12345"
    }
}
```

**Implementation**:
```javascript
export function handleCreateRoom(req, res, config = {}) {
    const roomId = generateRoomId();
    const roomConfig = { ...DEFAULT_ROOM_CONFIG, ...config };

    const room = {
        id: roomId,
        name: config.name || `Room ${roomId}`,
        participants: new Map(),
        speakerQueue: [],
        currentSpeaker: null,
        config: roomConfig,
        createdAt: Date.now()
    };

    rooms.set(roomId, room);
    sseClients.set(roomId, new Set());

    appendLog(`[webmeet] Created room ${roomId}: ${room.name}`);

    sendJson(res, 200, {
        success: true,
        room: {
            id: roomId,
            name: room.name,
            joinUrl: `/webmeet/${roomId}`
        }
    });
}
```

### handleJoinRoom(req, res, roomId, participantData)

**Purpose**: Joins participant to existing room

**Parameters**:
- `req` (http.IncomingMessage): HTTP request
- `res` (http.ServerResponse): HTTP response
- `roomId` (string): Room to join
- `participantData` (Object): Participant info from request

**Request Body**:
```json
{
    "name": "John Doe",
    "tabId": "tab-uuid-123"
}
```

**Response**:
```json
{
    "success": true,
    "participant": {
        "id": "p-uuid-456",
        "name": "John Doe"
    },
    "room": {
        "id": "abc12345",
        "name": "Team Standup",
        "participants": [...],
        "currentSpeaker": null,
        "speakerQueue": []
    }
}
```

**Implementation**:
```javascript
export function handleJoinRoom(req, res, roomId, participantData) {
    const room = rooms.get(roomId);
    if (!room) {
        sendJson(res, 404, { error: 'room_not_found', message: `Room ${roomId} does not exist` });
        return;
    }

    if (room.participants.size >= room.config.maxParticipants) {
        sendJson(res, 403, { error: 'room_full', message: 'Room has reached maximum capacity' });
        return;
    }

    const participantId = `p-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const participant = {
        id: participantId,
        name: participantData.name || 'Anonymous',
        tabId: participantData.tabId,
        isModerator: room.participants.size === 0, // First participant is moderator
        isMuted: false,
        joinedAt: Date.now()
    };

    room.participants.set(participantId, participant);

    // Broadcast join event
    broadcast(roomId, 'participant_joined', {
        participant: {
            id: participant.id,
            name: participant.name,
            isModerator: participant.isModerator
        },
        participantCount: room.participants.size
    }, participantData.tabId);

    appendLog(`[webmeet] ${participant.name} joined room ${roomId}`);

    sendJson(res, 200, {
        success: true,
        participant: {
            id: participantId,
            name: participant.name,
            isModerator: participant.isModerator
        },
        room: {
            id: room.id,
            name: room.name,
            participants: Array.from(room.participants.values()).map(p => ({
                id: p.id,
                name: p.name,
                isModerator: p.isModerator,
                isMuted: p.isMuted
            })),
            currentSpeaker: room.currentSpeaker,
            speakerQueue: room.speakerQueue
        }
    });
}
```

### handleLeaveRoom(req, res, roomId, participantId)

**Purpose**: Removes participant from room

**Parameters**:
- `req` (http.IncomingMessage): HTTP request
- `res` (http.ServerResponse): HTTP response
- `roomId` (string): Room ID
- `participantId` (string): Participant to remove

**Implementation**:
```javascript
export function handleLeaveRoom(req, res, roomId, participantId) {
    const room = rooms.get(roomId);
    if (!room) {
        sendJson(res, 404, { error: 'room_not_found' });
        return;
    }

    if (!room.participants.has(participantId)) {
        sendJson(res, 404, { error: 'participant_not_found' });
        return;
    }

    removeParticipant(roomId, participantId);

    sendJson(res, 200, { success: true });
}
```

### handleSSEConnection(req, res, roomId, tabId)

**Purpose**: Establishes SSE connection for real-time events

**Parameters**:
- `req` (http.IncomingMessage): HTTP request
- `res` (http.ServerResponse): HTTP response
- `roomId` (string): Room to connect to
- `tabId` (string): Client tab identifier

**Implementation**:
```javascript
export function handleSSEConnection(req, res, roomId, tabId) {
    const room = rooms.get(roomId);
    if (!room) {
        res.writeHead(404);
        res.end('Room not found');
        return;
    }

    // Set SSE headers
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
    });

    // Send initial connection event
    res.write(`event: connected\n`);
    res.write(`data: ${JSON.stringify({ roomId, tabId, timestamp: Date.now() })}\n\n`);

    // Register client
    const clients = sseClients.get(roomId);
    const client = { res, tabId };
    clients.add(client);

    appendLog(`[webmeet] SSE connected: room=${roomId} tab=${tabId}`);

    // Keep-alive ping every 30 seconds
    const pingInterval = setInterval(() => {
        try {
            res.write(`event: ping\n`);
            res.write(`data: ${JSON.stringify({ timestamp: Date.now() })}\n\n`);
        } catch (err) {
            clearInterval(pingInterval);
        }
    }, 30000);

    // Handle disconnect
    req.on('close', () => {
        clearInterval(pingInterval);
        clients.delete(client);
        appendLog(`[webmeet] SSE disconnected: room=${roomId} tab=${tabId}`);

        // Find and remove participant by tabId
        for (const [participantId, participant] of room.participants) {
            if (participant.tabId === tabId) {
                removeParticipant(roomId, participantId);
                break;
            }
        }
    });
}
```

### handleWantToSpeak(req, res, roomId, participantId)

**Purpose**: Adds participant to speaker queue

**Parameters**:
- `req` (http.IncomingMessage): HTTP request
- `res` (http.ServerResponse): HTTP response
- `roomId` (string): Room ID
- `participantId` (string): Requesting participant

**Implementation**:
```javascript
export function handleWantToSpeak(req, res, roomId, participantId) {
    const room = rooms.get(roomId);
    if (!room) {
        sendJson(res, 404, { error: 'room_not_found' });
        return;
    }

    const participant = room.participants.get(participantId);
    if (!participant) {
        sendJson(res, 404, { error: 'participant_not_found' });
        return;
    }

    // Already in queue or speaking
    if (room.speakerQueue.includes(participantId) || room.currentSpeaker === participantId) {
        sendJson(res, 200, { success: true, position: room.speakerQueue.indexOf(participantId) + 1 });
        return;
    }

    // If no current speaker, become speaker immediately
    if (!room.currentSpeaker) {
        room.currentSpeaker = participantId;
        broadcast(roomId, 'speaker_changed', {
            speakerId: participantId,
            speakerName: participant.name,
            queue: room.speakerQueue
        });
        sendJson(res, 200, { success: true, speaking: true });
        return;
    }

    // Add to queue
    room.speakerQueue.push(participantId);
    broadcast(roomId, 'queue_updated', {
        queue: room.speakerQueue,
        newSpeaker: participantId,
        newSpeakerName: participant.name
    });

    sendJson(res, 200, { success: true, position: room.speakerQueue.length });
}
```

### handleEndSpeak(req, res, roomId, participantId)

**Purpose**: Ends current speaker turn and promotes next

**Parameters**:
- `req` (http.IncomingMessage): HTTP request
- `res` (http.ServerResponse): HTTP response
- `roomId` (string): Room ID
- `participantId` (string): Current speaker

**Implementation**:
```javascript
export function handleEndSpeak(req, res, roomId, participantId) {
    const room = rooms.get(roomId);
    if (!room) {
        sendJson(res, 404, { error: 'room_not_found' });
        return;
    }

    if (room.currentSpeaker !== participantId) {
        sendJson(res, 403, { error: 'not_current_speaker' });
        return;
    }

    room.currentSpeaker = null;

    // Promote next in queue
    if (room.speakerQueue.length > 0) {
        room.currentSpeaker = room.speakerQueue.shift();
        const nextSpeaker = room.participants.get(room.currentSpeaker);
        broadcast(roomId, 'speaker_changed', {
            speakerId: room.currentSpeaker,
            speakerName: nextSpeaker ? nextSpeaker.name : 'Unknown',
            queue: room.speakerQueue
        });
    } else {
        broadcast(roomId, 'speaker_changed', {
            speakerId: null,
            speakerName: null,
            queue: []
        });
    }

    sendJson(res, 200, { success: true });
}
```

### handleListParticipants(req, res, roomId)

**Purpose**: Lists all participants in a room

**Parameters**:
- `req` (http.IncomingMessage): HTTP request
- `res` (http.ServerResponse): HTTP response
- `roomId` (string): Room ID

**Response**:
```json
{
    "participants": [
        {
            "id": "p-123",
            "name": "John Doe",
            "isModerator": true,
            "isMuted": false
        }
    ],
    "count": 1
}
```

**Implementation**:
```javascript
export function handleListParticipants(req, res, roomId) {
    const room = rooms.get(roomId);
    if (!room) {
        sendJson(res, 404, { error: 'room_not_found' });
        return;
    }

    const participants = Array.from(room.participants.values()).map(p => ({
        id: p.id,
        name: p.name,
        isModerator: p.isModerator,
        isMuted: p.isMuted
    }));

    sendJson(res, 200, { participants, count: participants.length });
}
```

### handleAgentQuery(req, res, roomId, query)

**Purpose**: Sends query to room's AI agent

**Parameters**:
- `req` (http.IncomingMessage): HTTP request
- `res` (http.ServerResponse): HTTP response
- `roomId` (string): Room ID
- `query` (Object): Agent query data

**Request Body**:
```json
{
    "prompt": "Summarize the discussion so far",
    "participantId": "p-123"
}
```

**Implementation**:
```javascript
export async function handleAgentQuery(req, res, roomId, query) {
    const room = rooms.get(roomId);
    if (!room) {
        sendJson(res, 404, { error: 'room_not_found' });
        return;
    }

    if (!room.config.enableAgent || !room.config.agentName) {
        sendJson(res, 400, { error: 'agent_not_enabled' });
        return;
    }

    try {
        const response = await callAgent(roomId, room.config.agentName, query.prompt, {
            participantId: query.participantId
        });

        // Broadcast agent response to room
        broadcast(roomId, 'agent_response', {
            prompt: query.prompt,
            response: response.result,
            timestamp: Date.now()
        });

        sendJson(res, 200, { success: true, response: response.result });
    } catch (err) {
        sendJson(res, 500, { error: 'agent_error', message: err.message });
    }
}
```

## Exports

```javascript
export {
    rooms,
    sseClients,
    handleCreateRoom,
    handleJoinRoom,
    handleLeaveRoom,
    handleSSEConnection,
    handleWantToSpeak,
    handleEndSpeak,
    handleListParticipants,
    handleAgentQuery,
    broadcast,
    sendToTab
};
```

## SSE Event Types

| Event | Description | Payload |
|-------|-------------|---------|
| `connected` | Initial connection established | `{ roomId, tabId, timestamp }` |
| `participant_joined` | New participant joined | `{ participant, participantCount }` |
| `participant_left` | Participant left | `{ participantId, name, participantCount }` |
| `speaker_changed` | Current speaker changed | `{ speakerId, speakerName, queue }` |
| `queue_updated` | Speaker queue modified | `{ queue, newSpeaker, newSpeakerName }` |
| `agent_response` | AI agent responded | `{ prompt, response, timestamp }` |
| `ping` | Keep-alive ping | `{ timestamp }` |

## Usage Example

```javascript
// Client-side usage
const eventSource = new EventSource(`/webmeet/${roomId}/events?tabId=${tabId}`);

eventSource.addEventListener('participant_joined', (e) => {
    const data = JSON.parse(e.data);
    console.log(`${data.data.participant.name} joined`);
});

eventSource.addEventListener('speaker_changed', (e) => {
    const data = JSON.parse(e.data);
    updateSpeakerUI(data.data.speakerId);
});

// Join room
const response = await fetch(`/webmeet/${roomId}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'John Doe', tabId })
});

// Request to speak
await fetch(`/webmeet/${roomId}/speak`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ participantId })
});
```

## Related Modules

- [server-agent-client.md](../server-agent-client.md) - Agent MCP client
- [server-auth-handlers.md](../auth/server-auth-handlers.md) - Authentication
- [commands-webtty.md](../../commands/commands-webtty.md) - Related web commands
