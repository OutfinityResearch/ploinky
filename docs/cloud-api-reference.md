# Ploinky Cloud API Reference

## PloinkyClient JavaScript SDK

### Installation

#### Browser
```html
<script src="/client/ploinkyClient.js"></script>
```

#### Node.js
```javascript
const PloinkyClient = require('./client/ploinkyClient');
```

### Basic Usage

```javascript
// Create client instance
const client = new PloinkyClient('http://localhost:8000', {
    timeout: 30000,
    authToken: null
});

// Login
const result = await client.login('admin', 'password');
console.log('Logged in as:', result.userId);

// Call agent command
const response = await client.call('/api/users', 'createUser', {
    email: 'john@example.com',
    name: 'John Doe'
});
```

### Configuration

```javascript
const client = new PloinkyClient(serverUrl, {
    timeout: 30000,        // Request timeout in ms
    authToken: 'token',    // Pre-configured auth token
    agents: {              // Agent configuration
        users: {
            path: '/api/users',
            commands: ['create', 'update', 'delete', 'list']
        },
        data: {
            path: '/api/data',
            commands: ['query', 'insert', 'update']
        }
    }
});

// Use configured agents
await client.users.create('john@example.com', 'John');
await client.data.query('SELECT * FROM users');
```

### Methods

#### Authentication

##### login(username, password)
```javascript
const result = await client.login('admin', 'password');
// Returns: { success: true, userId: 'admin', token: '...' }
```

##### logout()
```javascript
await client.logout();
// Returns: { success: true }
```

##### setAuthToken(token)
```javascript
client.setAuthToken('your-auth-token');
```

#### Command Execution

##### call(agentPath, command, ...params)
```javascript
const result = await client.call('/api/users', 'createUser', 
    'john@example.com', 'John Doe', { role: 'admin' });
```

##### batch(commands)
```javascript
const results = await client.batch([
    { agent: '/api/users', command: 'create', params: ['user1@example.com'] },
    { agent: '/api/users', command: 'create', params: ['user2@example.com'] },
    { agent: '/api/data', command: 'query', params: ['SELECT COUNT(*)'] }
]);
```

#### File Operations

##### uploadFile(agentPath, file, metadata)
```javascript
const file = document.getElementById('fileInput').files[0];
const result = await client.uploadFile('/api/storage', file, {
    folder: 'documents',
    tags: ['important']
});
```

#### Real-time Events

##### subscribe(agentPath, command, onMessage, onError)
```javascript
const subscription = client.subscribe('/api/events', 'updates',
    (data) => {
        console.log('New event:', data);
    },
    (error) => {
        console.error('Connection error:', error);
    }
);

// Later: close subscription
subscription.close();
```

## REST API Endpoints

### Management API

All management endpoints require admin authentication via `authorizationToken` cookie.

#### GET /management/api/overview
Returns system overview and statistics.

**Response:**
```json
{
    "totalRequests": 12345,
    "activeAgents": 5,
    "errorRate": "0.5%",
    "uptime": 3600000,
    "recentActivity": [...]
}
```

#### GET /management/api/config
Returns current system configuration.

#### POST /management/api/config
Updates system configuration.

**Request:**
```json
{
    "settings": {
        "port": 8000,
        "workersCount": "auto",
        "metricsRetention": 7
    }
}
```

#### GET /management/api/domains
Lists configured domains.

#### POST /management/api/domains
Adds a new domain.

**Request:**
```json
{
    "name": "api.example.com",
    "enabled": true
}
```

#### DELETE /management/api/domains/:domain
Removes a domain.

#### GET /management/api/repositories
Lists agent repositories.

#### POST /management/api/repositories
Adds a repository.

**Request:**
```json
{
    "name": "MyAgents",
    "url": "https://github.com/user/agents.git",
    "enabled": true
}
```

#### GET /management/api/deployments
Lists active deployments.

#### POST /management/api/deployments
Creates a new deployment.

**Request:**
```json
{
    "domain": "localhost",
    "path": "/api/users",
    "agent": "UserAgent"
}
```

#### DELETE /management/api/deployments
Removes a deployment.

**Request:**
```json
{
    "domain": "localhost",
    "path": "/api/users"
}
```

#### GET /management/api/agents
Lists available agents.

#### POST /management/api/agents/:name/start
Starts an agent.

#### POST /management/api/agents/:name/stop
Stops an agent.

#### POST /management/api/agents/:name/restart
Restarts an agent.

#### GET /management/api/metrics
Returns performance metrics.

**Query Parameters:**
- `range`: Time range (1h, 24h, 7d)
- `agent`: Filter by agent name

**Response:**
```json
{
    "totalRequests": 10000,
    "errorRate": "0.5%",
    "uptime": 3600000,
    "agents": {
        "UserAgent": {
            "count": 500,
            "avgDuration": "45ms",
            "errorRate": "0.1%"
        }
    }
}
```

### Agent Communication API

#### POST /:agentPath
Executes a command on an agent.

**Headers:**
- `Content-Type: application/json`
- `Cookie: authorizationToken=...` (if authenticated)

**Request:**
```json
{
    "command": "createUser",
    "params": ["john@example.com", "John Doe"]
}
```

**Response (Success):**
```json
{
    "success": true,
    "data": {
        "userId": "user-123",
        "email": "john@example.com"
    }
}
```

**Response (Error):**
```json
{
    "error": true,
    "message": "User already exists",
    "code": "USER_EXISTS",
    "details": {}
}
```

### Authentication API

#### POST /auth
Handles authentication commands.

**Login Request:**
```json
{
    "command": "login",
    "params": ["username", "password"]
}
```

**Login Response:**
```json
{
    "userId": "admin",
    "authorizationToken": "token-123..."
}
```

## Agent Development

### Task Handler Implementation

Agents receive tasks through the filesystem queue and must implement handlers for each command.

#### Node.js Agent Example

```javascript
const TaskQueue = require('/agentCore/lib/taskQueue');

class UserAgent {
    constructor() {
        this.queue = new TaskQueue('/agent');
    }
    
    async start() {
        await this.queue.init();
        
        // Process tasks
        while (true) {
            const tasks = await this.queue.getPendingTasks();
            
            for (const taskId of tasks) {
                await this.queue.processTask(taskId, 
                    this.handleCommand.bind(this));
            }
            
            await this.sleep(100);
        }
    }
    
    async handleCommand(command, params, metadata) {
        const [runForUserId, ...actualParams] = params;
        
        // Check permissions
        if (!this.hasPermission(runForUserId, command)) {
            throw new Error('Permission denied');
        }
        
        // Execute command
        switch (command) {
            case 'user.create':
                return await this.createUser(...actualParams);
            case 'user.update':
                return await this.updateUser(...actualParams);
            case 'user.delete':
                return await this.deleteUser(...actualParams);
            default:
                throw new Error(`Unknown command: ${command}`);
        }
    }
    
    async createUser(email, name) {
        // Implementation
        return {
            success: true,
            userId: 'user-' + Date.now(),
            email,
            name
        };
    }
}
```

#### Bash Agent Example

```bash
#!/bin/bash

source /agentCore/lib/taskHandler.sh

# Command handlers
handle_echo() {
    echo "$@"
}

handle_process() {
    local file=$1
    # Process file
    echo "Processed: $file"
}

# Main loop is handled by /agentCore/run.sh
```

### Error Handling

Agents should return structured errors:

```javascript
// JavaScript
throw {
    error: true,
    message: 'User not found',
    code: 'USER_NOT_FOUND',
    details: { userId: 'user-123' }
};
```

```bash
# Bash
echo '{"error": true, "message": "User not found", "code": "USER_NOT_FOUND"}' > .tasks/errors/$TASK_ID
```

### Security Context

All tasks include a `runForUserId` as the first parameter:

```javascript
async handleCommand(command, params, metadata) {
    const [runForUserId, ...actualParams] = params;
    
    // runForUserId values:
    // - "InternetUser": Unauthenticated request
    // - "Admin": Admin user
    // - "user-123": Authenticated user ID
    
    if (runForUserId === 'InternetUser') {
        // Handle public access
    } else if (runForUserId === 'Admin') {
        // Full access
    } else {
        // Check user-specific permissions
    }
}
```

## WebSocket Support (Future)

Planned support for WebSocket connections:

```javascript
// Client
const ws = client.websocket('/api/realtime');
ws.on('message', (data) => {
    console.log('Received:', data);
});
ws.send({ command: 'subscribe', channel: 'updates' });

// Agent
class RealtimeAgent {
    handleWebSocket(ws, runForUserId) {
        ws.on('message', (data) => {
            // Handle incoming messages
        });
        
        // Send updates
        ws.send({ event: 'update', data: {...} });
    }
}
```