import { createGenericAuthBridge } from './genericAuthBridge.js';

function createAuthService(options = {}) {
    return createGenericAuthBridge(options);
}

export { createAuthService };
