# cli/server/webmeet/showdemo.js - WebMeet Demo Display

## Overview

Client-side demo display module for WebMeet. Shows scripted demo messages when disconnected, fetching script from server and rendering timed message sequence.

## Source File

`cli/server/webmeet/showdemo.js`

## Module State

```javascript
const DemoManager = {
    demoTimer: null,     // setTimeout reference
    demoIndex: 0,        // Current script index
    demoScript: [],      // Demo message script
    chatList: null,      // Chat list DOM element
    connected: false     // Connection status
};
```

## Public API

### init(chatListElement)

**Purpose**: Initializes demo manager with chat container

**Parameters**:
- `chatListElement` (HTMLElement): Chat message container

```javascript
init(chatListElement) {
    this.chatList = chatListElement;
}
```

### setConnected(isConnected)

**Purpose**: Updates connection status

**Parameters**:
- `isConnected` (boolean): Connection state

```javascript
setConnected(isConnected) {
    this.connected = isConnected;
    if (isConnected) {
        this.stopDemo();
    }
}
```

### startDemo()

**Purpose**: Starts demo message sequence

```javascript
async startDemo() {
    try {
        if (this.connected || this.demoTimer) return;

        // Fetch demo script from server
        const response = await fetch('demo').then(r => r.json()).catch(() => null);
        this.demoScript = (response && response.script) ? response.script : [];

        // Clear chat
        if (this.chatList) {
            this.chatList.innerHTML = '';
        }

        this.demoIndex = 0;
        this.playNextDemo();
    } catch(_) {}
}
```

### stopDemo()

**Purpose**: Stops demo playback

```javascript
stopDemo() {
    try {
        if (this.demoTimer) {
            clearTimeout(this.demoTimer);
        }
    } catch(_) {}
    this.demoTimer = null;
}
```

## Internal Functions

### playNextDemo()

**Purpose**: Renders next demo message and schedules next

```javascript
playNextDemo() {
    if (this.connected) {
        this.stopDemo();
        return;
    }

    const item = this.demoScript[this.demoIndex % (this.demoScript.length || 1)] || {
        who: 'User',
        text: '...'
    };

    const who = item?.who || 'User';
    const text = item?.text || '';

    this.renderDemoMessage(who, text);

    this.demoIndex++;

    // Schedule next message (600-3000ms)
    const delay = Math.max(600, Math.min(3000, item?.delayMs || 1200));
    this.demoTimer = setTimeout(() => this.playNextDemo(), delay);
}
```

### renderDemoMessage(who, text)

**Purpose**: Creates and appends demo message bubble

```javascript
renderDemoMessage(who, text) {
    if (!this.chatList) return;

    const msgDiv = document.createElement('div');
    const isOutgoing = who === 'Me' || who === 'You';
    msgDiv.className = `wa-message ${isOutgoing ? 'out' : 'in'} vc-demo`;

    const bubble = document.createElement('div');
    bubble.className = 'wa-message-bubble';

    // Special styling for Moderator
    if (who === 'Moderator') {
        bubble.classList.add('is-moderator');
    }

    bubble.innerHTML = `
        <div class="wa-message-author"></div>
        <div class="wa-message-text"></div>
        <span class="wa-message-time"></span>
    `;

    msgDiv.appendChild(bubble);

    bubble.querySelector('.wa-message-author').textContent = who;
    bubble.querySelector('.wa-message-text').textContent = text;
    bubble.querySelector('.wa-message-time').textContent = this.formatTime();

    this.chatList.appendChild(msgDiv);
    this.chatList.scrollTop = this.chatList.scrollHeight;
}
```

### formatTime()

**Purpose**: Returns current time as HH:MM

```javascript
formatTime() {
    const d = new Date();
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
}
```

## Demo Script Format

Server returns JSON:
```json
{
    "script": [
        { "who": "Moderator", "text": "Welcome to the meeting", "delayMs": 1500 },
        { "who": "User", "text": "Hello everyone", "delayMs": 1200 },
        { "who": "Me", "text": "Thanks for joining", "delayMs": 1000 }
    ]
}
```

**Script Item Properties**:
| Property | Type | Description |
|----------|------|-------------|
| `who` | string | Sender name (Me/You = outgoing) |
| `text` | string | Message text |
| `delayMs` | number | Delay before next message (600-3000) |

## Message Styling

| Sender | Classes |
|--------|---------|
| 'Me' / 'You' | `wa-message out vc-demo` |
| Others | `wa-message in vc-demo` |
| 'Moderator' | Additional `is-moderator` |

## Global Export

```javascript
window.webMeetDemo = DemoManager;
```

## Server Endpoint

| Endpoint | Method | Description |
|----------|--------|-------------|
| `demo` | GET | Fetch demo script JSON |

## Related Modules

- [server-webmeet-client.md](./server-webmeet-client.md) - Demo integration

