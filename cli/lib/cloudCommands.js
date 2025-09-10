const fs = require('fs').promises;
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const readline = require('readline');
const inputState = require('./inputState');
const { debugLog } = require('./utils');
const PloinkyClient = require('../../client/ploinkyClient');

class CloudCommands {
    constructor() {
        this.configFile = path.join(process.cwd(), '.ploinky', 'cloud.json');
        this.config = null;
        const home = process.env.HOME || process.env.USERPROFILE || process.cwd();
        this.remotesFile = path.join(home, '.plionky', 'remotes.json');
        this.client = null;
    }

    async loadConfig() {
        try {
            const data = await fs.readFile(this.configFile, 'utf-8');
            this.config = JSON.parse(data);
        } catch (err) {
            this.config = {
                serverUrl: 'http://localhost:8000'
            };
        }
        
        // Initialize PloinkyClient with config
        if (!this.client) {
            this.client = new PloinkyClient(this.config.serverUrl, {
                authToken: this.config.authToken
            });
        }
    }

    async saveConfig() {
        await fs.mkdir(path.dirname(this.configFile), { recursive: true });
        await fs.writeFile(this.configFile, JSON.stringify(this.config, null, 2));
    }

    async handleCloudCommand(args) {
        const subcommand = args[0];
        const subArgs = args.slice(1);

        await this.loadConfig();

        switch (subcommand) {
            case 'connect':
                return this.connect(subArgs);
            case 'init':
                return this.init(subArgs);
            case 'login':
                return this.login(subArgs);
            case 'logout':
                return this.logout();
            case 'show':
                return this.showRemote();
            case 'admin':
                return this.handleAdmin(subArgs);
            case 'host':
                return this.handleHost(subArgs);
            case 'agent':
                return this.handleAgent(subArgs);
            case 'deploy':
                return this.deploy(subArgs);
            case 'undeploy':
                return this.undeploy(subArgs);
            case 'call':
                return this.callAgent(subArgs);
            case 'status':
                return this.status();
            case 'config':
                return this.handleConfig(subArgs);
            case 'deployments':
                return this.listDeployments();
            case 'repo':
                return this.handleRepo(subArgs);
            case 'metrics':
                return this.showMetrics(subArgs);
            case 'health':
                return this.checkHealth();
            case 'logs':
                if (subArgs[0] === 'list') return this.listLogs();
                if (subArgs[0] === 'download') return this.downloadLog(subArgs.slice(1));
                return this.showLogs(subArgs);
            case 'destroy':
                return this.handleDestroy(subArgs);
            case 'settings':
                return this.settings(subArgs);
            case 'batch':
                return this.executeBatch(subArgs);
            default:
                this.showCloudHelp();
        }
    }

    async connect(args) {
        const url = args[0] || 'http://localhost:8000';
        
        // Ensure URL has protocol
        let serverUrl = url;
        if (!serverUrl.startsWith('http://') && !serverUrl.startsWith('https://')) {
            serverUrl = `http://${serverUrl}`;
        }
        
        this.config.serverUrl = serverUrl;
        await this.saveConfig();
        
        console.log(`✓ Connected to ${serverUrl}`);
        console.log('You can initialize auth with: ploinky cloud init');
    }
    
    async init(args) {
        if (!this.config.serverUrl) {
            console.log('Not connected to any server. Use: ploinky cloud connect [url]');
            return;
        }
        const resp = await this.apiCall('/management/api/init', { method: 'POST' });
        if (resp && resp.success && resp.apiKey) {
            await this.saveRemote(this.config.serverUrl, resp.apiKey);
            console.log('✓ Server initialized. Admin API Key generated.');
            console.log(`API Key: ${resp.apiKey}`);
            console.log('Saved to ~/.plionky/remotes.json');
        } else if (resp && resp.error === 'Already initialized') {
            console.log('Server already initialized. If you lost the key, rotate it manually on the server.');
        } else {
            console.error('✗ Initialization failed');
        }
    }

    async showRemote() {
        const remote = await this.readRemote();
        if (!remote) {
            console.log('No remote configured in ~/.plionky/remotes.json');
            return;
        }
        console.log('Current Cloud Remote:');
        console.log(`  URL: ${remote.url}`);
        console.log(`  API Key: ${remote.apiKey}`);
    }

    async saveRemote(url, apiKey) {
        await fs.mkdir(path.dirname(this.remotesFile), { recursive: true });
        const payload = { url, apiKey };
        await fs.writeFile(this.remotesFile, JSON.stringify(payload, null, 2));
    }

    async readRemote() {
        try {
            const data = await fs.readFile(this.remotesFile, 'utf-8');
            return JSON.parse(data);
        } catch (_) { return null; }
    }
    
    async login(args) {
        if (!this.config.serverUrl) {
            console.log('Not connected to any server. Use: ploinky cloud connect [url]');
            return;
        }
        const apiKey = args[0];
        if (!apiKey) {
            console.log('Usage: cloud login <API_KEY>');
            return;
        }
        try {
            // Use PloinkyClient to login
            const response = await this.client.login(apiKey);
            
            if (response && response.success) {
                this.config.authToken = response.token;
                this.config.userId = response.userId || 'admin';
                await this.saveConfig();
                
                // Update client with new auth token
                this.client.setAuthToken(response.token);
                
                console.log(`✓ Logged in using API Key`);
            } else {
                console.error('✗ Login failed:', response?.error || 'Unknown error');
            }
        } catch (err) {
            console.error('✗ Login error:', err.message);
        }
    }

    async logout() {
        if (!this.config.authToken) {
            console.log('Not logged in');
            return;
        }

        // Keep only serverUrl when logging out
        this.config = { 
            serverUrl: this.config.serverUrl 
        };
        await this.saveConfig();
        console.log('✓ Logged out');
    }

    async handleAdmin(args) {
        const action = args[0];
        const subArgs = args.slice(1);

        switch (action) {
            case 'add':
                return this.addAdmin(subArgs);
            case 'password':
                return this.changeAdminPassword(subArgs);
            case 'list':
                return this.listAdmins();
            default:
                console.log('Usage: cloud admin <add|password|list>');
        }
    }

    async addAdmin(args) {
        const username = args[0];
        if (!username) {
            console.log('Usage: cloud admin add <username>');
            return;
        }

        const password = await this.promptPassword('Password: ');
        const confirmPassword = await this.promptPassword('Confirm Password: ');

        if (password !== confirmPassword) {
            console.error('✗ Passwords do not match');
            return;
        }

        const response = await this.apiCall('/management/api/admins', {
            method: 'POST',
            body: JSON.stringify({ username, password })
        });

        if (response && response.success) {
            console.log(`✓ Admin user '${username}' created`);
        } else {
            console.error('✗ Failed to create admin user');
        }
    }

    async changeAdminPassword(args) {
        const username = args[0] || this.config.userId;
        
        const oldPassword = await this.promptPassword('Current Password: ');
        const newPassword = await this.promptPassword('New Password: ');
        const confirmPassword = await this.promptPassword('Confirm New Password: ');

        if (newPassword !== confirmPassword) {
            console.error('✗ Passwords do not match');
            return;
        }

        const response = await this.apiCall('/management/api/admins/password', {
            method: 'PUT',
            body: JSON.stringify({ username, oldPassword, newPassword })
        });

        if (response && response.success) {
            console.log('✓ Password changed successfully');
        } else {
            console.error('✗ Failed to change password');
        }
    }

    async handleHost(args) {
        const action = args[0];
        const subArgs = args.slice(1);

        switch (action) {
            case 'add':
                return this.addHost(subArgs);
            case 'remove':
                return this.removeHost(subArgs);
            case 'list':
                return this.listHosts();
            default:
                console.log('Usage: cloud host <add|remove|list>');
        }
    }

    async addHost(args) {
        const hostname = args[0];
        if (!hostname) {
            console.log('Usage: cloud host add <hostname>');
            return;
        }

        const response = await this.apiCall('/management/api/domains', {
            method: 'POST',
            body: JSON.stringify({ name: hostname, enabled: true })
        });

        if (response && response.success) {
            console.log(`✓ Host '${hostname}' added`);
        } else {
            console.error('✗ Failed to add host');
        }
    }

    async removeHost(args) {
        const hostname = args[0];
        if (!hostname) {
            console.log('Usage: cloud host remove <hostname>');
            return;
        }

        const response = await this.apiCall(`/management/api/domains/${hostname}`, {
            method: 'DELETE'
        });

        if (response && response.success) {
            console.log(`✓ Host '${hostname}' removed`);
        } else {
            console.error('✗ Failed to remove host');
        }
    }

    async listHosts() {
        const response = await this.apiCall('/management/api/domains');
        if (response && response.domains) {
            console.log('Configured Hosts:');
            response.domains.forEach(domain => {
                console.log(`  ${domain.name} ${domain.enabled ? '✓' : '✗'}`);
            });
        }
    }

    async handleAgent(args) {
        const action = args[0];
        const subArgs = args.slice(1);

        switch (action) {
            case 'list':
                return this.listAgents();
            case 'info':
                return this.agentInfo(subArgs);
            case 'start':
                return this.startAgent(subArgs);
            case 'stop':
                return this.stopAgent(subArgs);
            case 'restart':
                return this.restartAgent(subArgs);
            default:
                console.log('Usage: cloud agent <list|info|start|stop|restart>');
        }
    }

    async listAgents() {
        const response = await this.apiCall('/management/api/agents');
        if (response && response.agents) {
            console.log('Available Agents:');
            response.agents.forEach(agent => {
                console.log(`  ${agent.name}: ${agent.description || 'No description'}`);
            });
        }
    }

    async deploy(args) {
        const hostname = args[0];
        const path = args[1];
        const agent = args[2];

        if (!hostname || !path || !agent) {
            console.log('Usage: cloud deploy <hostname> <path> <agent>');
            return;
        }

        const response = await this.apiCall('/management/api/deployments', {
            method: 'POST',
            body: JSON.stringify({ domain: hostname, path, agent })
        });

        if (response && response.success) {
            console.log(`✓ Deployed '${agent}' to ${hostname}${path}`);
        } else {
            console.error('✗ Deployment failed');
        }
    }

    async undeploy(args) {
        const hostname = args[0];
        const path = args[1];

        if (!hostname || !path) {
            console.log('Usage: cloud undeploy <hostname> <path>');
            return;
        }
        // Try body-based delete first
        let response = await this.apiCall('/management/api/deployments', {
            method: 'DELETE',
            body: JSON.stringify({ domain: hostname, path })
        });
        if (!(response && response.success)) {
            // Fallback to path-based delete
            const encPath = encodeURIComponent(path.replace(/^\/+/, ''));
            response = await this.apiCall(`/management/api/deployments/${hostname}/${encPath}`, { method: 'DELETE' });
        }
        if (response && response.success) {
            console.log(`✓ Undeployed from ${hostname}${path}`);
        } else {
            console.error('✗ Undeploy failed', response?.error ? `- ${response.error}` : '');
        }
    }

    async callAgent(args) {
        const agentPath = args[0];
        const command = args[1];
        const params = args.slice(2);

        if (!agentPath || !command) {
            console.log('Usage: cloud call <agent-path> <command> [params...]');
            return;
        }

        try {
            // Use PloinkyClient to make the call
            const response = await this.client.call(agentPath, command, ...params);
            
            if (response) {
                console.log(JSON.stringify(response, null, 2));
            } else {
                console.error('✗ Call failed - no response');
            }
        } catch (err) {
            console.error('✗ Call failed:', err.message);
        }
    }

    async status() {
        if (!this.config.serverUrl) {
            console.log('Status: Not connected');
            console.log('Use: ploinky cloud connect [url] to connect to a server');
            return;
        }
        
        console.log(`Connected to: ${this.config.serverUrl}`);
        console.log(`Logged in as: ${this.config.userId || 'Not logged in'}`);
        
        const response = await this.apiCall('/management/api/overview');
        if (response) {
            console.log('\nServer Status:');
            console.log(`  Active Agents: ${response.activeAgents || 0}`);
            console.log(`  Total Requests: ${response.totalRequests || 0}`);
            console.log(`  Error Rate: ${response.errorRate || '0%'}`);
            console.log(`  Uptime: ${this.formatUptime(response.uptime)}`);
        } else {
            console.log('\n✗ Server not responding');
            console.log('Check if the server is running at ' + this.config.serverUrl);
        }
    }

    async handleConfig(args) {
        const action = args[0];
        const subArgs = args.slice(1);
        
        switch (action) {
            case 'show':
                return this.showConfig();
            case 'set':
                return this.setConfig(subArgs);
            case 'export':
                return this.exportConfig(subArgs);
            case 'import':
                return this.importConfig(subArgs);
            default:
                return this.showConfig();
        }
    }
    
    async showConfig() {
        const response = await this.apiCall('/management/api/config');
        if (response) {
            console.log('Cloud Configuration:');
            console.log(JSON.stringify(response, null, 2));
        }
    }
    
    async listDeployments() {
        const response = await this.apiCall('/management/api/deployments');
        if (response && response.deployments) {
            console.log('Active Deployments:');
            response.deployments.forEach(dep => {
                console.log(`  ${dep.domain}${dep.path} -> ${dep.agent} [${dep.status || 'active'}]`);
            });
        }
    }
    
    async handleRepo(args) {
        const action = args[0];
        const subArgs = args.slice(1);
        
        switch (action) {
            case 'add':
                return this.addRepository(subArgs);
            case 'remove':
                return this.removeRepository(subArgs);
            case 'update':
                return this.updateRepository(subArgs);
            case 'list':
                return this.listRepositories();
            default:
                console.log('Usage: cloud repo <add|remove|update|list>');
        }
    }
    
    async addRepository(args) {
        const name = args[0];
        const url = args[1];
        
        if (!name || !url) {
            console.log('Usage: cloud repo add <name> <url>');
            return;
        }
        
        const response = await this.apiCall('/management/api/repositories', {
            method: 'POST',
            body: JSON.stringify({ name, url, enabled: true })
        });
        
        if (response && response.success) {
            console.log(`✓ Repository '${name}' added`);
        } else {
            console.error('✗ Failed to add repository');
        }
    }
    
    async removeRepository(args) {
        const name = args[0];
        if (!name) {
            console.log('Usage: cloud repo remove <name>');
            return;
        }
        
        const response = await this.apiCall(`/management/api/repositories/${name}`, {
            method: 'DELETE'
        });
        
        if (response && response.success) {
            console.log(`✓ Repository '${name}' removed`);
        } else {
            console.error('✗ Failed to remove repository');
        }
    }
    
    async listRepositories() {
        const response = await this.apiCall('/management/api/repositories');
        if (response && response.repositories) {
            console.log('Agent Repositories:');
            response.repositories.forEach(repo => {
                console.log(`  ${repo.name}: ${repo.url} ${repo.enabled ? '✓' : '✗'}`);
            });
        }
    }
    
    async showMetrics(args) {
        const range = args[0] || '24h';
        const response = await this.apiCall(`/management/api/metrics?range=${range}`);
        
        if (response) {
            console.log(`System Metrics (${range}):`);
            console.log(`  Total Requests: ${response.totalRequests || 0}`);
            console.log(`  Error Rate: ${response.errorRate || '0%'}`);
            console.log(`  Unauthorized Requests: ${response.unauthorizedRequests || 0}`);
            console.log(`  Uptime: ${this.formatUptime(response.uptime)}`);
            
            if (response.agents) {
                console.log('\nAgent Metrics:');
                Object.entries(response.agents).forEach(([agent, metrics]) => {
                    console.log(`  ${agent}:`);
                    console.log(`    Requests: ${metrics.count}`);
                    console.log(`    Avg Duration: ${metrics.avgDuration}`);
                    console.log(`    Error Rate: ${metrics.errorRate}`);
                });
            }
        }
    }
    
    async checkHealth() {
        const response = await this.apiCall('/management/api/health');
        if (response) {
            console.log('System Health:');
            console.log(`  Status: ${response.status || 'healthy'}`);
            console.log(`  Server: ${response.server ? '✓ Running' : '✗ Down'}`);
            console.log(`  Database: ${response.database ? '✓ Connected' : '✗ Disconnected'}`);
            console.log(`  Agents: ${response.agents || 0} active`);
        } else {
            console.log('✗ Health check failed - server not responding');
        }
    }
    
    async showLogs(args) {
        const lines = parseInt(args[0] || '200', 10);
        const url = `/management/api/logs?lines=${lines}`;
        const content = await this.apiCall(url);
        if (typeof content === 'string') {
            console.log(content);
        } else if (content) {
            console.log(JSON.stringify(content, null, 2));
        } else {
            console.log('No logs');
        }
    }

    async listLogs() {
        const res = await this.apiCall('/management/api/logs/list');
        if (res && res.dates) {
            console.log('Available log days:');
            res.dates.forEach(d => console.log('  ' + d));
        } else {
            console.log('No logs');
        }
    }

    async downloadLog(args) {
        const date = args[0];
        if (!date) { console.log('Usage: cloud logs download <YYYY-MM-DD>'); return; }
        const http = require('http');
        const url = new URL(`/management/api/logs/download?date=${date}`, this.config.serverUrl);
        const requestOptions = { method: 'GET', headers: { ...(this.config.authToken ? { 'Cookie': `authorizationToken=${this.config.authToken}` } : {}) } };
        await new Promise((resolve) => {
            const req = http.request(url, requestOptions, (res) => {
                const chunks = [];
                res.on('data', c => chunks.push(c));
                res.on('end', () => {
                    const buf = Buffer.concat(chunks);
                    const fs = require('fs');
                    const path = require('path');
                    const fname = path.join(process.cwd(), `p-cloud-${date}.log.gz`);
                    fs.writeFileSync(fname, buf);
                    console.log('Saved', fname);
                    resolve();
                });
            });
            req.on('error', () => resolve());
            req.end();
        });
    }

    async handleDestroy(args) {
        const what = args[0];
        if (what === 'agents') {
            return this.destroyLocalAgents();
        }
        if (what === 'server-agents' || what === 'all') {
            const res = await this.apiCall('/management/api/stopAndDeleteAll', { method: 'POST' });
            if (res && res.success) {
                console.log(`Server agents cleanup completed using ${res.runtime}. Removed: ${(res.removed||[]).length}`);
            } else {
                console.log('Server cleanup failed');
            }
            return;
        }
        console.log('Usage: cloud destroy agents | cloud destroy server-agents');
    }

    async destroyLocalAgents() {
        const fsSync = require('fs');
        const path = require('path');
        const { execSync } = require('child_process');
        const { AGENTS_FILE } = require('../lib/config');
        const agentsFile = AGENTS_FILE;
        if (!fsSync.existsSync(agentsFile)) { console.log('No local agents file found.'); return; }
        let agents = {};
        try { agents = JSON.parse(fsSync.readFileSync(agentsFile, 'utf-8')); } catch { agents = {}; }
        const names = Object.keys(agents || {});
        if (names.length === 0) { console.log('No containers to remove.'); return; }
        let runtime = 'docker';
        try { execSync('command -v docker', { stdio: 'ignore' }); }
        catch { try { execSync('command -v podman', { stdio: 'ignore' }); runtime = 'podman'; } catch { console.log('No container runtime found.'); return; } }
        names.forEach(name => {
            try { execSync(`${runtime} stop ${name}`, { stdio: 'ignore' }); } catch {}
            try { execSync(`${runtime} rm ${name}`, { stdio: 'ignore' }); } catch {}
            console.log('Removed', name);
        });
        try { fsSync.writeFileSync(agentsFile, JSON.stringify({}, null, 2)); } catch {}
        console.log('Local agents destroyed.');
    }

    async settings(args) {
        const sub = args[0] || 'show';
        if (sub === 'show') {
            const s = await this.apiCall('/management/api/settings');
            console.log(JSON.stringify(s || {}, null, 2));
            return;
        }
        if (sub === 'set') {
            const key = args[1]; const value = args[2];
            if (!key || value === undefined) { console.log('Usage: cloud settings set <key> <value>'); return; }
            const body = {}; body[key] = isNaN(Number(value)) ? value : Number(value);
            const res = await this.apiCall('/management/api/settings', { method: 'POST', body: JSON.stringify(body) });
            if (res && res.success) console.log('✓ Updated'); else console.log('✗ Failed');
        }
    }
    
    async executeBatch(args) {
        const file = args[0];
        if (!file) {
            console.log('Usage: cloud batch <file.json>');
            return;
        }
        
        const fs = require('fs').promises;
        try {
            const content = await fs.readFile(file, 'utf-8');
            const commands = JSON.parse(content);
            
            console.log(`Executing ${commands.length} commands...`);
            for (const cmd of commands) {
                console.log(`Running: ${cmd.path} ${cmd.command}`);
                const response = await this.apiCall(cmd.path, {
                    method: 'POST',
                    body: JSON.stringify({ 
                        command: cmd.command, 
                        params: cmd.params || []
                    })
                });
                
                if (response) {
                    console.log('  Result:', JSON.stringify(response));
                } else {
                    console.log('  Failed');
                }
            }
        } catch (err) {
            console.error('✗ Batch execution failed:', err.message);
        }
    }
    
    formatUptime(ms) {
        if (!ms) return '0h';
        const hours = Math.floor(ms / 3600000);
        const minutes = Math.floor((ms % 3600000) / 60000);
        return `${hours}h ${minutes}m`;
    }

    async apiCall(endpoint, options = {}) {
        const url = new URL(endpoint, this.config.serverUrl);
        
        const requestOptions = {
            method: options.method || 'GET',
            headers: {
                'Content-Type': 'application/json',
                ...(this.config.authToken ? {
                    'Cookie': `authorizationToken=${this.config.authToken}`
                } : {}),
                ...options.headers
            }
        };

        if (options.body) {
            requestOptions.body = options.body;
        }

        return new Promise((resolve, reject) => {
            const req = http.request(url, requestOptions, (res) => {
                let data = '';
                
                res.on('data', chunk => {
                    data += chunk;
                });
                
                res.on('end', () => {
                    try {
                        const json = JSON.parse(data);
                        resolve(json);
                    } catch (err) {
                        resolve(null);
                    }
                });
            });

            req.on('error', (err) => {
                debugLog('API call failed:', err.message);
                resolve(null);
            });

            if (requestOptions.body) {
                req.write(requestOptions.body);
            }
            
            req.end();
        });
    }

    promptPassword(prompt) {
        return new Promise((resolve) => {
            inputState.suspend();

            // Print prompt and read without echo
            process.stdout.write(prompt);

            let password = '';
            
            // Store original state
            const wasRaw = process.stdin.isRaw;
            const oldEncoding = process.stdin.readableEncoding;

            // Enable raw mode to hide input
            if (process.stdin.setRawMode) {
                process.stdin.setRawMode(true);
            }
            process.stdin.setEncoding('utf8');

            const cleanup = () => {
                // Remove only our listener, don't pause stdin
                process.stdin.removeListener('data', onData);
                
                // Restore original raw mode state
                if (process.stdin.setRawMode) {
                    process.stdin.setRawMode(wasRaw || false);
                }
                
                // Restore original encoding if it existed
                if (oldEncoding) {
                    process.stdin.setEncoding(oldEncoding);
                }
                
                inputState.resume();
            };

            const onData = (char) => {
                char = char.toString('utf8');

                if (char === '\n' || char === '\r' || char === '\u0004') {
                    // Enter pressed
                    process.stdout.write('\n');
                    cleanup();
                    resolve(password);
                } else if (char === '\u0003') {
                    // Ctrl+C - cancel the password prompt
                    process.stdout.write('\n');
                    cleanup();
                    resolve(null);
                } else if (char === '\u007f' || char === '\b') {
                    // Backspace
                    if (password.length > 0) {
                        password = password.slice(0, -1);
                        process.stdout.write('\b \b');
                    }
                } else if (char.charCodeAt(0) >= 32) {
                    // Regular character - don't echo it
                    password += char;
                    process.stdout.write('*');
                }
            };

            process.stdin.on('data', onData);
        });
    }

    showCloudHelp() {
        console.log(`
Ploinky Cloud Client Commands

Connection:
  cloud connect [url]               Connect to cloud server (default: localhost:8000)
  cloud status                      Show connection and server status
  cloud init                        Initialize server and generate Admin API Key
  cloud show                        Show current remote and API Key
  cloud logs [lines]                Show last N log lines
  cloud logs list                   List available log days
  cloud logs download <date>        Download logs (gz) for day
  cloud settings show|set           Show or update settings
  
Authentication:
  cloud login <API_KEY>             Login using Admin API Key
  cloud logout                      Logout from cloud server
  
Administration:
  cloud admin add <username>        Add new admin user
  cloud admin password              Change admin password
  cloud admin list                  List admin users
  
Host Management:
  cloud host add <hostname>         Add a new host/domain
  cloud host remove <hostname>      Remove a host/domain  
  cloud host list                   List configured hosts
  
Deployment:
  cloud deploy <host> <path> <agent>     Deploy agent to path
  cloud undeploy <host> <path>           Remove deployment
  cloud agent list                        List available agents
  cloud agent start <name>               Start an agent
  cloud agent stop <name>                Stop an agent
  
Operations:
  cloud call <path> <command> [args...]  Call agent command
  cloud status                           Show cloud status
  cloud config                           Show configuration
        `);
    }
}

module.exports = CloudCommands;
