/**
 * PloinkyClient - JavaScript client library for Ploinky Cloud
 * Provides a simple interface to call remote agent commands
 */
class PloinkyClient {
    constructor(serverUrl = 'http://localhost:8000', options = {}) {
        this.serverUrl = serverUrl.replace(/\/$/, ''); // Remove trailing slash
        this.timeout = options.timeout || 30000; // 30 seconds default
        this.authToken = options.authToken || null;
        this.agents = new Map();
        
        // Auto-configure agents if provided
        if (options.agents) {
            this.configureAgents(options.agents);
        }
    }

    /**
     * Configure agent proxies for easier access
     */
    configureAgents(agentConfigs) {
        for (const [agentName, config] of Object.entries(agentConfigs)) {
            const agent = this.createAgentProxy(config.path || `/${agentName}`, config.commands || []);
            this.agents.set(agentName, agent);
            
            // Add as property for direct access
            this[agentName] = agent;
        }
    }

    /**
     * Create a proxy object for an agent
     */
    createAgentProxy(agentPath, commands) {
        const client = this;
        const proxy = {
            _path: agentPath,
            _client: client
        };

        // Add command methods
        if (commands.length > 0) {
            for (const command of commands) {
                const methodName = command.split('.').pop(); // Get last part as method name
                proxy[methodName] = function(...args) {
                    return client.call(agentPath, command, ...args);
                };
            }
        }

        // Add generic call method
        proxy.call = function(command, ...args) {
            return client.call(agentPath, command, ...args);
        };

        return proxy;
    }

    /**
     * Call a command on an agent
     */
    async call(agentPath, command, ...params) {
        const url = `${this.serverUrl}${agentPath}`;
        
        const body = {
            command,
            params
        };

        try {
            const response = await this.request(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(this.authToken ? { 'Cookie': `authorizationToken=${this.authToken}` } : {})
                },
                body: JSON.stringify(body)
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || `HTTP ${response.status}: ${response.statusText}`);
            }

            return await response.json();
        } catch (err) {
            console.error(`[PloinkyClient] Error calling ${command} on ${agentPath}:`, err);
            throw err;
        }
    }

    /**
     * Login to the system
     */
    async login(username, password) {
        try {
            const response = await this.call('/auth', 'login', username, password);
            
            if (response.authorizationToken) {
                this.authToken = response.authorizationToken;
                return {
                    success: true,
                    userId: response.userId,
                    token: response.authorizationToken
                };
            }
            
            return {
                success: false,
                error: 'Login failed'
            };
        } catch (err) {
            return {
                success: false,
                error: err.message
            };
        }
    }

    /**
     * Logout from the system
     */
    async logout() {
        if (!this.authToken) {
            return { success: true };
        }

        try {
            await this.call('/auth', 'logout');
            this.authToken = null;
            return { success: true };
        } catch (err) {
            return {
                success: false,
                error: err.message
            };
        }
    }

    /**
     * Set authentication token
     */
    setAuthToken(token) {
        this.authToken = token;
    }

    /**
     * Get current authentication token
     */
    getAuthToken() {
        return this.authToken;
    }

    /**
     * Make HTTP request with timeout
     */
    async request(url, options) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeout);

        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal
            });
            
            clearTimeout(timeout);
            return response;
        } catch (err) {
            clearTimeout(timeout);
            
            if (err.name === 'AbortError') {
                throw new Error(`Request timeout after ${this.timeout}ms`);
            }
            
            throw err;
        }
    }

    /**
     * Upload a file to an agent
     */
    async uploadFile(agentPath, file, metadata = {}) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('metadata', JSON.stringify(metadata));

        const url = `${this.serverUrl}${agentPath}/upload`;
        
        try {
            const response = await this.request(url, {
                method: 'POST',
                headers: {
                    ...(this.authToken ? { 'Cookie': `authorizationToken=${this.authToken}` } : {})
                },
                body: formData
            });

            if (!response.ok) {
                throw new Error(`Upload failed: ${response.statusText}`);
            }

            return await response.json();
        } catch (err) {
            console.error(`[PloinkyClient] Error uploading file to ${agentPath}:`, err);
            throw err;
        }
    }

    /**
     * Subscribe to server-sent events from an agent
     */
    subscribe(agentPath, command, onMessage, onError) {
        const url = `${this.serverUrl}${agentPath}/subscribe?command=${command}`;
        
        const eventSource = new EventSource(url, {
            withCredentials: true
        });

        eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                onMessage(data);
            } catch (err) {
                console.error('[PloinkyClient] Error parsing SSE data:', err);
            }
        };

        eventSource.onerror = (err) => {
            console.error('[PloinkyClient] SSE error:', err);
            if (onError) onError(err);
        };

        return {
            close: () => eventSource.close()
        };
    }

    /**
     * Batch multiple commands
     */
    async batch(commands) {
        const results = [];
        const errors = [];

        for (const cmd of commands) {
            try {
                const result = await this.call(cmd.agent, cmd.command, ...(cmd.params || []));
                results.push({
                    index: commands.indexOf(cmd),
                    success: true,
                    result
                });
            } catch (err) {
                errors.push({
                    index: commands.indexOf(cmd),
                    success: false,
                    error: err.message
                });
            }
        }

        return {
            results,
            errors,
            success: errors.length === 0
        };
    }
}

// Export for different environments
if (typeof module !== 'undefined' && module.exports) {
    // Node.js
    module.exports = PloinkyClient;
} else if (typeof define === 'function' && define.amd) {
    // AMD
    define([], function() {
        return PloinkyClient;
    });
} else {
    // Browser global
    window.PloinkyClient = PloinkyClient;
}