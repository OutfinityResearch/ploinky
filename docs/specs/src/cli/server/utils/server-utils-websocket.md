# cli/server/utils/websocket.js - WebSocket Implementation

## Overview

Native WebSocket implementation using only Node.js built-in modules. Provides both server-side (accepting connections) and client-side (making connections) WebSocket functionality with full protocol support.

## Source File

`cli/server/utils/websocket.js`

## Dependencies

```javascript
import crypto from 'crypto';
import https from 'https';
import http from 'http';
import { EventEmitter } from 'events';
```

## Constants

```javascript
// WebSocket opcodes
const OPCODES = {
    CONTINUATION: 0x0,
    TEXT: 0x1,
    BINARY: 0x2,
    CLOSE: 0x8,
    PING: 0x9,
    PONG: 0xA
};

// WebSocket close codes
const CLOSE_CODES = {
    NORMAL: 1000,
    GOING_AWAY: 1001,
    PROTOCOL_ERROR: 1002,
    UNSUPPORTED_DATA: 1003,
    INVALID_FRAME_PAYLOAD_DATA: 1007,
    POLICY_VIOLATION: 1008,
    MESSAGE_TOO_BIG: 1009,
    INTERNAL_ERROR: 1011
};
```

## Internal Functions

### parseFrame(buffer)

**Purpose**: Parses a WebSocket frame from buffer

**Parameters**:
- `buffer` (Buffer): Raw data buffer

**Returns**: (Object|null) Parsed frame or null if incomplete

**Frame Structure**:
```javascript
{
    fin: boolean,      // Final fragment flag
    opcode: number,    // Frame type
    payload: Buffer,   // Unmasked payload
    length: number     // Total frame length
}
```

**Implementation**:
```javascript
function parseFrame(buffer) {
    if (buffer.length < 2) return null;

    const firstByte = buffer[0];
    const secondByte = buffer[1];

    const fin = (firstByte & 0x80) !== 0;
    const opcode = firstByte & 0x0F;
    const masked = (secondByte & 0x80) !== 0;
    let payloadLength = secondByte & 0x7F;
    let offset = 2;

    // Extended payload length
    if (payloadLength === 126) {
        if (buffer.length < 4) return null;
        payloadLength = buffer.readUInt16BE(2);
        offset = 4;
    } else if (payloadLength === 127) {
        if (buffer.length < 10) return null;
        const high = buffer.readUInt32BE(2);
        const low = buffer.readUInt32BE(6);
        payloadLength = high * 0x100000000 + low;
        offset = 10;
    }

    if (buffer.length < offset + (masked ? 4 : 0) + payloadLength) {
        return null;
    }

    let payload = Buffer.allocUnsafe(payloadLength);

    if (masked) {
        const maskKey = buffer.slice(offset, offset + 4);
        offset += 4;
        for (let i = 0; i < payloadLength; i++) {
            payload[i] = buffer[offset + i] ^ maskKey[i % 4];
        }
    } else {
        buffer.copy(payload, 0, offset, offset + payloadLength);
    }

    return { fin, opcode, payload, length: offset + payloadLength };
}
```

### createFrame(opcode, payload, masked)

**Purpose**: Creates a WebSocket frame

**Parameters**:
- `opcode` (number): Frame type
- `payload` (Buffer): Payload data
- `masked` (boolean): Apply masking (true for client frames)

**Returns**: (Buffer) Complete frame

**Implementation**:
```javascript
function createFrame(opcode, payload, masked = false) {
    const payloadLength = payload.length;
    let frameLength = 2 + payloadLength;
    let payloadOffset = 2;

    // Calculate extended length
    if (payloadLength > 65535) {
        frameLength += 8;
        payloadOffset += 8;
    } else if (payloadLength > 125) {
        frameLength += 2;
        payloadOffset += 2;
    }

    if (masked) {
        frameLength += 4;
        payloadOffset += 4;
    }

    const frame = Buffer.allocUnsafe(frameLength);

    // First byte: FIN + opcode
    frame[0] = 0x80 | opcode;

    // Second byte: MASK + payload length
    if (payloadLength <= 125) {
        frame[1] = (masked ? 0x80 : 0x00) | payloadLength;
    } else if (payloadLength <= 65535) {
        frame[1] = (masked ? 0x80 : 0x00) | 126;
        frame.writeUInt16BE(payloadLength, 2);
    } else {
        frame[1] = (masked ? 0x80 : 0x00) | 127;
        frame.writeUInt32BE(0, 2);
        frame.writeUInt32BE(payloadLength, 6);
    }

    if (masked) {
        const maskKey = crypto.randomBytes(4);
        maskKey.copy(frame, payloadOffset - 4);
        for (let i = 0; i < payloadLength; i++) {
            frame[payloadOffset + i] = payload[i] ^ maskKey[i % 4];
        }
    } else {
        payload.copy(frame, payloadOffset);
    }

    return frame;
}
```

## Class: WebSocket

### Constructor

**Purpose**: Creates a WebSocket connection wrapper

**Parameters**:
- `socket` (net.Socket): Underlying TCP socket
- `isServer` (boolean): True if server-side connection

**Implementation**:
```javascript
class WebSocket extends EventEmitter {
    constructor(socket, isServer = false) {
        super();
        this.socket = socket;
        this.isServer = isServer;
        this.buffer = Buffer.alloc(0);
        this.readyState = 1; // OPEN
        this.fragments = [];

        this.socket.on('data', (data) => this._handleData(data));
        this.socket.on('close', () => {
            this.readyState = 3; // CLOSED
            this.emit('close');
        });
        this.socket.on('error', (error) => {
            this.emit('error', error);
        });
    }
}
```

### send(data)

**Purpose**: Sends data through the WebSocket

**Parameters**:
- `data` (string|Buffer): Data to send

**Implementation**:
```javascript
send(data) {
    const opcode = Buffer.isBuffer(data) ? OPCODES.BINARY : OPCODES.TEXT;
    this._sendFrame(opcode, data);
}
```

### ping(data)

**Purpose**: Sends a ping frame

**Parameters**:
- `data` (string|Buffer): Optional ping payload

**Implementation**:
```javascript
ping(data = '') {
    this._sendFrame(OPCODES.PING, data);
}
```

### close(code, reason)

**Purpose**: Closes the WebSocket connection

**Parameters**:
- `code` (number): Close code (default: 1000 NORMAL)
- `reason` (string): Close reason

**Implementation**:
```javascript
close(code = CLOSE_CODES.NORMAL, reason = '') {
    if (this.readyState === 3) return;

    const payload = Buffer.allocUnsafe(2 + Buffer.byteLength(reason));
    payload.writeUInt16BE(code, 0);
    if (reason) {
        payload.write(reason, 2);
    }

    this._sendFrame(OPCODES.CLOSE, payload);
    this.readyState = 3;

    setTimeout(() => {
        this.socket.destroy();
    }, 1000);
}
```

### Properties

- `readyState` - Connection state (1=OPEN, 3=CLOSED)
- `OPEN` - Constant 1
- `CLOSED` - Constant 3

### Events

| Event | Payload | Description |
|-------|---------|-------------|
| `message` | Buffer | Received message |
| `close` | - | Connection closed |
| `error` | Error | Connection error |
| `pong` | Buffer | Pong response received |

## Public API

### acceptWebSocketUpgrade(req, socket, head)

**Purpose**: Performs WebSocket handshake (server side)

**Parameters**:
- `req` (http.IncomingMessage): HTTP upgrade request
- `socket` (net.Socket): Underlying socket
- `head` (Buffer): First packet data

**Returns**: (WebSocket|null) WebSocket instance or null on failure

**Implementation**:
```javascript
function acceptWebSocketUpgrade(req, socket, head) {
    const key = req.headers['sec-websocket-key'];
    if (!key) {
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
        socket.destroy();
        return null;
    }

    const MAGIC_STRING = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
    const hash = crypto.createHash('sha1')
        .update(key + MAGIC_STRING)
        .digest('base64');

    const headers = [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${hash}`,
        '\r\n'
    ].join('\r\n');

    socket.write(headers);

    return new WebSocket(socket, true);
}
```

### connectWebSocket(url, options)

**Purpose**: Connects to a WebSocket server (client side)

**Parameters**:
- `url` (string): WebSocket URL (ws:// or wss://)
- `options` (Object):
  - `headers` (Object): Additional headers

**Returns**: (Promise<WebSocket>) Connected WebSocket

**Implementation**:
```javascript
function connectWebSocket(url, options = {}) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const isSecure = urlObj.protocol === 'wss:';
        const port = urlObj.port || (isSecure ? 443 : 80);
        const path = urlObj.pathname + urlObj.search;

        const key = crypto.randomBytes(16).toString('base64');

        const headers = {
            'Host': urlObj.hostname,
            'Upgrade': 'websocket',
            'Connection': 'Upgrade',
            'Sec-WebSocket-Key': key,
            'Sec-WebSocket-Version': '13',
            ...options.headers
        };

        const httpModule = isSecure ? https : http;
        const req = httpModule.request({ hostname: urlObj.hostname, port, path, method: 'GET', headers });

        req.on('upgrade', (res, socket, head) => {
            // Validate accept key
            const acceptKey = res.headers['sec-websocket-accept'];
            const MAGIC_STRING = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
            const expectedKey = crypto.createHash('sha1')
                .update(key + MAGIC_STRING)
                .digest('base64');

            if (acceptKey !== expectedKey) {
                socket.destroy();
                reject(new Error('Invalid Sec-WebSocket-Accept header'));
                return;
            }

            resolve(new WebSocket(socket, false));
        });

        req.on('error', reject);
        req.end();
    });
}
```

## Exports

```javascript
export {
    WebSocket,
    acceptWebSocketUpgrade,
    connectWebSocket,
    OPCODES,
    CLOSE_CODES
};
```

## Usage Example

```javascript
import { acceptWebSocketUpgrade, connectWebSocket, WebSocket } from './websocket.js';

// Server side
server.on('upgrade', (req, socket, head) => {
    const ws = acceptWebSocketUpgrade(req, socket, head);
    if (ws) {
        ws.on('message', (data) => {
            console.log('Received:', data.toString());
            ws.send('Echo: ' + data.toString());
        });

        ws.on('close', () => {
            console.log('Connection closed');
        });
    }
});

// Client side
const ws = await connectWebSocket('ws://localhost:8080/socket');

ws.on('message', (data) => {
    console.log('Server said:', data.toString());
});

ws.send('Hello, server!');

// Close connection
ws.close(1000, 'Done');
```

## Protocol Compliance

- Implements RFC 6455 WebSocket protocol
- Supports text and binary frames
- Handles fragmented messages
- Automatic ping/pong response
- Client-side masking

## Related Modules

- [server-handlers-webtty.md](../handlers/server-handlers-webtty.md) - WebTTY uses WebSocket
- [server-handlers-webchat.md](../handlers/server-handlers-webchat.md) - WebChat uses WebSocket
