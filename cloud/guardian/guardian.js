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
        this.config = options.config;
        this.activeUsersDir = path.join(this.workingDir, 'activeUsers');
        this.adminFilePath = path.join(this.workingDir, '.admin');
    }

    async init() {
        // Create active users directory
        await fs.mkdir(this.activeUsersDir, { recursive: true });
        
        // Create default admin if not exists
        await this.ensureDefaultAdmin();
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
        const token = this.extractToken(req);
        
        if (token === 'Admin') {
            return true;
        }

        const session = await this.getUserSession(token);
        return session && session.isAdmin === true;
    }

    /**
     * Authenticate admin
     */
    async authenticateAdmin(password) {
        try {
            const adminData = await fs.readFile(this.adminFilePath, 'utf-8');
            const admins = JSON.parse(adminData);
            
            // Check against all admin passwords
            for (const admin of admins) {
                const match = this.verifyPassword(password, admin.passwordHash, admin.salt);
                if (match) {
                    // Create admin session
                    const token = await this.createUserSession(admin.username || 'admin', ['*'], 24);
                    
                    // Mark session as admin
                    const sessionPath = path.join(this.activeUsersDir, `${token}.json`);
                    const session = JSON.parse(await fs.readFile(sessionPath, 'utf-8'));
                    session.isAdmin = true;
                    await fs.writeFile(sessionPath, JSON.stringify(session, null, 2));
                    
                    return token;
                }
            }
            
            return null;
        } catch (err) {
            console.error('Admin authentication error:', err);
            return null;
        }
    }

    /**
     * Check if the admin password is the default 'admin'
     */
    async isDefaultPassword() {
        try {
            const adminData = await fs.readFile(this.adminFilePath, 'utf-8');
            const admins = JSON.parse(adminData);
            const admin = admins.find(a => a.username === 'admin');
            if (!admin) {
                return false; // No admin user
            }
            // Check if the password is 'admin'
            return this.verifyPassword('admin', admin.passwordHash, admin.salt);
        } catch (err) {
            console.error('Error checking default password:', err);
            return false;
        }
    }

    /**
     * Change admin password
     */
    async changeAdminPassword(oldPassword, newPassword, username = 'admin') {
        try {
            const adminData = await fs.readFile(this.adminFilePath, 'utf-8');
            const admins = JSON.parse(adminData);
            
            // Find admin entry
            const adminIndex = admins.findIndex(a => a.username === username);
            if (adminIndex === -1) {
                throw new Error('Admin not found');
            }

            // Verify old password
            const match = this.verifyPassword(oldPassword, admins[adminIndex].passwordHash, admins[adminIndex].salt);
            if (!match) {
                throw new Error('Invalid old password');
            }

            // Hash new password
            const { hash, salt } = this.hashPassword(newPassword);
            admins[adminIndex].passwordHash = hash;
            admins[adminIndex].salt = salt;
            admins[adminIndex].updatedAt = new Date().toISOString();
            
            // Save updated admin data
            await fs.writeFile(this.adminFilePath, JSON.stringify(admins, null, 2));
            
            return true;
        } catch (err) {
            console.error('Change password error:', err);
            return false;
        }
    }

    /**
     * Ensure default admin exists
     */
    async ensureDefaultAdmin() {
        try {
            await fs.access(this.adminFilePath);
        } catch (err) {
            // Admin file doesn't exist, create default
            const defaultPassword = 'admin'; // Should be changed on first login
            const { hash, salt } = this.hashPassword(defaultPassword);
            
            const adminData = [{
                username: 'admin',
                passwordHash: hash,
                salt: salt,
                createdAt: new Date().toISOString(),
                mustChangePassword: true
            }];
            
            await fs.writeFile(this.adminFilePath, JSON.stringify(adminData, null, 2));
            console.log('[Guardian] Default admin created (username: admin, password: admin)');
            console.log('[Guardian] IMPORTANT: Change the default password immediately!');
        }
    }

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