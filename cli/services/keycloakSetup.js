import { resolveVarValue } from './secretVars.js';

const DEFAULT_ROLES = [
    { name: 'admin', description: 'Administrator - full access to all features' },
    { name: 'developer', description: 'Developer - can use interactive tools' },
    { name: 'user', description: 'Standard user - basic access' }
];

/**
 * Parse roles from command line string
 * Supports formats:
 *   - "admin,developer,user" (names only)
 *   - "admin:Full-access,developer:Dev-access" (with descriptions)
 */
function parseRolesString(rolesStr) {
    if (!rolesStr || typeof rolesStr !== 'string') return [];
    
    return rolesStr.split(',').map(role => {
        const trimmed = role.trim();
        if (trimmed.includes(':')) {
            const [name, description] = trimmed.split(':');
            return {
                name: name.trim(),
                description: description.trim().replace(/-/g, ' ')
            };
        }
        return {
            name: trimmed,
            description: `${trimmed} role`
        };
    }).filter(r => r.name);
}

/**
 * Load roles from JSON file
 */
async function loadRolesFromFile(filePath) {
    try {
        const fs = await import('fs');
        const path = await import('path');
        const fullPath = path.resolve(filePath);
        
        if (!fs.existsSync(fullPath)) {
            throw new Error(`File not found: ${fullPath}`);
        }
        
        const content = fs.readFileSync(fullPath, 'utf8');
        const data = JSON.parse(content);
        
        if (!data.roles || !Array.isArray(data.roles)) {
            throw new Error('JSON file must contain a "roles" array');
        }
        
        return data.roles.map(r => ({
            name: r.name,
            description: r.description || `${r.name} role`
        }));
    } catch (error) {
        throw new Error(`Failed to load roles file: ${error.message}`);
    }
}

/**
 * Get admin token from Keycloak
 */
async function getKeycloakAdminToken(baseUrl, adminUser, adminPassword) {
    const response = await fetch(`${baseUrl}/realms/master/protocol/openid-connect/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            username: adminUser,
            password: adminPassword,
            grant_type: 'password',
            client_id: 'admin-cli'
        })
    });
    
    if (!response.ok) {
        throw new Error(`Authentication failed: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    return data.access_token;
}

/**
 * Check if realm exists
 */
async function realmExists(baseUrl, token, realm) {
    const response = await fetch(`${baseUrl}/admin/realms/${realm}`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    return response.ok;
}

/**
 * Create realm if it doesn't exist
 */
async function createRealmIfNotExists(baseUrl, token, realm) {
    const exists = await realmExists(baseUrl, token, realm);
    
    if (exists) {
        console.log(`  ✓ Realm '${realm}' already exists`);
        return false;
    }
    
    const response = await fetch(`${baseUrl}/admin/realms`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            realm,
            enabled: true,
            displayName: `Ploinky ${realm}`
        })
    });
    
    if (!response.ok) {
        throw new Error(`Failed to create realm: ${response.status} ${response.statusText}`);
    }
    
    console.log(`  ✓ Created realm: ${realm}`);
    return true;
}

/**
 * Get client by clientId
 */
async function getClient(baseUrl, token, realm, clientId) {
    const response = await fetch(`${baseUrl}/admin/realms/${realm}/clients?clientId=${encodeURIComponent(clientId)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!response.ok) return null;
    
    const clients = await response.json();
    return clients.length > 0 ? clients[0] : null;
}

/**
 * Create OAuth2 client
 */
async function createClient(baseUrl, token, realm, clientConfig) {
    const { clientId, redirectUris, webOrigins } = clientConfig;
    
    // Check if already exists
    const existing = await getClient(baseUrl, token, realm, clientId);
    if (existing) {
        console.log(`  ✓ Client '${clientId}' already exists`);
        return existing.id;
    }
    
    const response = await fetch(`${baseUrl}/admin/realms/${realm}/clients`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            clientId,
            name: 'Ploinky Router',
            description: 'OAuth2 client for Ploinky routing server',
            enabled: true,
            publicClient: false,
            protocol: 'openid-connect',
            standardFlowEnabled: true,
            directAccessGrantsEnabled: false,
            redirectUris: Array.isArray(redirectUris) ? redirectUris : [redirectUris],
            webOrigins: Array.isArray(webOrigins) ? webOrigins : [webOrigins],
            attributes: {
                'pkce.code.challenge.method': 'S256'
            }
        })
    });
    
    if (!response.ok) {
        throw new Error(`Failed to create client: ${response.status} ${response.statusText}`);
    }
    
    console.log(`  ✓ Created client: ${clientId}`);
    
    // Get the created client to return its UUID
    const newClient = await getClient(baseUrl, token, realm, clientId);
    return newClient.id;
}

/**
 * Get client secret
 */
async function getClientSecret(baseUrl, token, realm, clientUuid) {
    const response = await fetch(`${baseUrl}/admin/realms/${realm}/clients/${clientUuid}/client-secret`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!response.ok) {
        throw new Error(`Failed to get client secret: ${response.status}`);
    }
    
    const data = await response.json();
    return data.value;
}

/**
 * Check if role exists
 */
async function roleExists(baseUrl, token, realm, roleName) {
    const response = await fetch(`${baseUrl}/admin/realms/${realm}/roles/${encodeURIComponent(roleName)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    return response.ok;
}

/**
 * Create realm role
 */
async function createRole(baseUrl, token, realm, role) {
    const exists = await roleExists(baseUrl, token, realm, role.name);
    
    if (exists) {
        console.log(`  • Role '${role.name}' already exists`);
        return false;
    }
    
    const response = await fetch(`${baseUrl}/admin/realms/${realm}/roles`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            name: role.name,
            description: role.description
        })
    });
    
    if (!response.ok) {
        throw new Error(`Failed to create role '${role.name}': ${response.status}`);
    }
    
    console.log(`  ✓ Created role: ${role.name}`);
    return true;
}

/**
 * Create multiple roles
 */
async function createRoles(baseUrl, token, realm, roles) {
    let created = 0;
    let skipped = 0;
    
    for (const role of roles) {
        const wasCreated = await createRole(baseUrl, token, realm, role);
        if (wasCreated) created++;
        else skipped++;
    }
    
    return { created, skipped };
}

/**
 * Wait for Keycloak to be ready
 */
async function waitForKeycloak(baseUrl, timeoutSeconds = 30) {
    const startTime = Date.now();
    const timeout = timeoutSeconds * 1000;
    
    console.log('⏳ Waiting for Keycloak to be ready...');
    
    while (Date.now() - startTime < timeout) {
        try {
            const response = await fetch(`${baseUrl}/realms/master/.well-known/openid-configuration`);
            if (response.ok) {
                console.log('✓ Keycloak is ready!\n');
                return true;
            }
        } catch (error) {
            // Keep waiting
        }
        
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    return false;
}

/**
 * Main setup function
 */
async function setupKeycloakRealm(options) {
    const {
        baseUrl,
        realm,
        clientId,
        redirectUri,
        logoutRedirectUri,
        adminUser,
        adminPassword,
        roles = DEFAULT_ROLES
    } = options;
    
    console.log('🔧 Configuring Keycloak...\n');
    
    // 1. Wait for Keycloak
    const ready = await waitForKeycloak(baseUrl, 30);
    if (!ready) {
        throw new Error('Keycloak is not reachable. Make sure it\'s running: ploinky start keycloak');
    }
    
    // 2. Authenticate
    console.log('🔐 Authenticating...');
    const token = await getKeycloakAdminToken(baseUrl, adminUser, adminPassword);
    console.log('  ✓ Authenticated as admin\n');
    
    // 3. Setup realm
    console.log('🌐 Setting up realm...');
    await createRealmIfNotExists(baseUrl, token, realm);
    console.log();
    
    // 4. Create client
    console.log('🔑 Setting up OAuth2 client...');
    const clientUuid = await createClient(baseUrl, token, realm, {
        clientId,
        redirectUris: [redirectUri, logoutRedirectUri],
        webOrigins: [new URL(redirectUri).origin]
    });
    
    // 5. Get client secret
    const clientSecret = await getClientSecret(baseUrl, token, realm, clientUuid);
    console.log(`  ✓ Client secret retrieved\n`);
    
    // 6. Create roles
    console.log('👥 Setting up roles...');
    const { created, skipped } = await createRoles(baseUrl, token, realm, roles);
    console.log(`  ✓ Created ${created} new role(s), ${skipped} already existed\n`);
    
    return {
        realm,
        clientId,
        clientSecret,
        roles: roles.map(r => r.name)
    };
}

export {
    setupKeycloakRealm,
    parseRolesString,
    loadRolesFromFile,
    DEFAULT_ROLES,
    waitForKeycloak,
    getKeycloakAdminToken
};
