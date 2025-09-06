const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

/**
 * Guardian - Security middleware for Ploinky Cloud
 * Handles authentication, authorization, and security context injection
 */
class Guardian {
    constructor(options) {
        this.workingDir = options.workingDir;
        this.baseDir = options.baseDir || path.dirname(this.workingDir);
        this.config = options.config;
        this.activeUsersDir = path.join(this.workingDir, 'activeUsers');
        this.adminFilePath = path.join(this.workingDir, '.admin');
        this.adminApiKeysPath = path.join(this.baseDir, '.ploinky', 'admin_api_keys.json');
    }

    async init() {
        // Create active users directory
        await fs.mkdir(this.activeUsersDir, { recursive: true });
        // Do not create default admin/password anymore; API keys are used
    }

    /**
     * Process incoming request for security
     */
    async processRequest(req) {
        // Extract authorization token from cookies
        const token = this.extractToken(req);
        
        if (!token) {
            return {
                userId: 'InternetUser',
                permissions: [],
                isAuthenticated: false
            };
        }

        // Special case for Admin token
        if (token === 'Admin') {
            return {
                userId: 'Admin',
                permissions: ['*'], // All permissions
                isAuthenticated: true,
                isAdmin: true
            };
        }

        // Look up user session
        const userSession = await this.getUserSession(token);
        
        if (!userSession) {
            return {
                userId: 'InternetUser',
                permissions: [],
                isAuthenticated: false
            };
        }

        // Check if session is expired
        if (userSession.expiresAt && new Date(userSession.expiresAt) < new Date()) {
            await this.removeUserSession(token);
            return {
                userId: 'InternetUser',
                permissions: [],
                isAuthenticated: false,
                expired: true
            };
        }

        return {
            userId: userSession.userId,
            permissions: userSession.allowedCommands || [],
            isAuthenticated: true,
            token
        };
    }

    /**
     * Extract authorization token from request
     */
    extractToken(req) {
        const cookieHeader = req.headers.cookie || '';
        const cookies = this.parseCookies(cookieHeader);
        return cookies.authorizationToken;
    }

    /**
     * Parse cookie header
     */
    parseCookies(cookieHeader) {
        const cookies = {};
        cookieHeader.split(';').forEach(cookie => {
            const parts = cookie.trim().split('=');
            if (parts.length === 2) {
                cookies[parts[0]] = decodeURIComponent(parts[1]);
            }
        });
        return cookies;
    }

    /**
     * Get user session by token
     */
    async getUserSession(token) {
        const sessionPath = path.join(this.activeUsersDir, `${token}.json`);
        
        try {
            const data = await fs.readFile(sessionPath, 'utf-8');
            return JSON.parse(data);
        } catch (err) {
            return null;
        }
    }

    /**
     * Create user session
     */
    async createUserSession(userId, permissions = [], expirationHours = 24) {
        const token = this.generateToken();
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + expirationHours);
        
        const session = {
            userId,
            token,
            allowedCommands: permissions,
            expiresAt: expiresAt.toISOString(),
            createdAt: new Date().toISOString()
        };

        const sessionPath = path.join(this.activeUsersDir, `${token}.json`);
        await fs.writeFile(sessionPath, JSON.stringify(session, null, 2));
        
        return token;
    }

    /**
     * Remove user session
     */
    async removeUserSession(token) {
        const sessionPath = path.join(this.activeUsersDir, `${token}.json`);
        try {
            await fs.unlink(sessionPath);
        } catch (err) {
            // Session might not exist
        }
    }

    /**
     * Validate command permission
     */
    hasPermission(securityContext, command) {
        if (securityContext.isAdmin) {
            return true;
        }

        if (!securityContext.isAuthenticated) {
            return false;
        }

        // Check if user has specific permission
        const permissions = securityContext.permissions || [];
        
        // Check for exact match
        if (permissions.includes(command)) {
            return true;
        }

        // Check for wildcard permissions
        for (const perm of permissions) {
            if (perm === '*') {
                return true;
            }
            
            // Check namespace wildcard (e.g., "user.*")
            if (perm.endsWith('.*')) {
                const namespace = perm.slice(0, -2);
                if (command.startsWith(namespace + '.')) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Check admin authentication
     */
    async checkAdminAuth(req) {
        // 1) Accept session cookie set during /auth or /management/login
        const token = this.extractToken(req);
        if (token) {
            const session = await this.getUserSession(token);
            if (session && session.isAdmin === true) return true;
        }

        // 2) Accept static API key via header for management/API access
        const headerKey = req.headers['x-api-key'];
        if (headerKey && await this.isValidAdminApiKey(headerKey)) return true;

        return false;
    }

    /**
     * Authenticate admin
     */
    async authenticateAdmin(password) {
        // Password auth is deprecated; always fail
        return null;
    }

    async authenticateAdminApiKey(apiKey) {
        const valid = await this.isValidAdminApiKey(apiKey);
        if (!valid) return null;

        // Create short-lived admin session cookie
        const token = await this.createUserSession('admin', ['*'], 24);
        const sessionPath = path.join(this.activeUsersDir, `${token}.json`);
        const session = JSON.parse(await fs.readFile(sessionPath, 'utf-8'));
        session.isAdmin = true;
        await fs.writeFile(sessionPath, JSON.stringify(session, null, 2));
        return token;
    }

    /**
     * Check if the admin password is the default 'admin'
     */
    async isDefaultPassword() { return false; }

    /**
     * Change admin password
     */
    async changeAdminPassword() { return false; }

    /**
     * Ensure default admin exists
     */
    async ensureDefaultAdmin() { /* no-op for API key mode */ }

    /**
     * Hash password using PBKDF2
     */
    hashPassword(password) {
        const salt = crypto.randomBytes(32).toString('hex');
        const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
        return { hash, salt };
    }

    /**
     * Verify password
     */
    verifyPassword(password, hash, salt) {
        const testHash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
        return hash === testHash;
    }

    /**
     * Generate secure token
     */
    generateToken() {
        return crypto.randomBytes(32).toString('hex');
    }

    // API Key helpers
    async isInitialized() {
        try {
            const data = await fs.readFile(this.adminApiKeysPath, 'utf-8');
            const parsed = JSON.parse(data);
            return Array.isArray(parsed.keys) && parsed.keys.length > 0;
        } catch (_) {
            return false;
        }
    }

    async generateAdminApiKey() {
        const key = crypto.randomBytes(32).toString('hex');
        let store = { keys: [] };
        try {
            const data = await fs.readFile(this.adminApiKeysPath, 'utf-8');
            store = JSON.parse(data);
        } catch (_) { /* ignore */ }
        store.keys.push({ key, createdAt: new Date().toISOString(), role: 'admin' });
        await fs.writeFile(this.adminApiKeysPath, JSON.stringify(store, null, 2));
        return key;
    }

    async isValidAdminApiKey(apiKey) {
        try {
            const data = await fs.readFile(this.adminApiKeysPath, 'utf-8');
            const parsed = JSON.parse(data);
            return Array.isArray(parsed.keys) && parsed.keys.some(k => k.key === apiKey);
        } catch (_) {
            return false;
        }
    }

    /**
     * Clean up expired sessions
     */
    async cleanupExpiredSessions() {
        try {
            const files = await fs.readdir(this.activeUsersDir);
            const now = new Date();
            
            for (const file of files) {
                if (!file.endsWith('.json')) continue;
                
                const sessionPath = path.join(this.activeUsersDir, file);
                const data = await fs.readFile(sessionPath, 'utf-8');
                const session = JSON.parse(data);
                
                if (session.expiresAt && new Date(session.expiresAt) < now) {
                    await fs.unlink(sessionPath);
                    console.log(`[Guardian] Cleaned up expired session for ${session.userId}`);
                }
            }
        } catch (err) {
            console.error('[Guardian] Error cleaning up sessions:', err);
        }
    }

    /**
     * Start periodic cleanup
     */
    startCleanup(intervalMinutes = 60) {
        setInterval(() => {
            this.cleanupExpiredSessions().catch(console.error);
        }, intervalMinutes * 60 * 1000);
    }
}

module.exports = { Guardian };
