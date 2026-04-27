import * as workspaceSvc from './workspace.js';

const ENV_DISABLE_HOST_SANDBOX = 'PLOINKY_DISABLE_HOST_SANDBOX';

function parseBooleanEnv(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function getSandboxConfig() {
    const cfg = workspaceSvc.getConfig() || {};
    const sandbox = cfg.sandbox && typeof cfg.sandbox === 'object' && !Array.isArray(cfg.sandbox)
        ? cfg.sandbox
        : {};
    return {
        disableHostRuntimes: sandbox.disableHostRuntimes === true,
    };
}

function setHostSandboxDisabled(disabled) {
    const cfg = workspaceSvc.getConfig() || {};
    const sandbox = cfg.sandbox && typeof cfg.sandbox === 'object' && !Array.isArray(cfg.sandbox)
        ? { ...cfg.sandbox }
        : {};

    sandbox.disableHostRuntimes = Boolean(disabled);
    cfg.sandbox = sandbox;
    workspaceSvc.setConfig(cfg);
    return getSandboxStatus();
}

function isHostSandboxDisabled() {
    if (parseBooleanEnv(process.env[ENV_DISABLE_HOST_SANDBOX])) {
        return true;
    }
    return getSandboxConfig().disableHostRuntimes;
}

function getSandboxStatus() {
    const envDisabled = parseBooleanEnv(process.env[ENV_DISABLE_HOST_SANDBOX]);
    const config = getSandboxConfig();
    return {
        disabled: envDisabled || config.disableHostRuntimes,
        source: envDisabled ? 'environment' : (config.disableHostRuntimes ? 'workspace' : 'default'),
        envVar: ENV_DISABLE_HOST_SANDBOX,
    };
}

export {
    ENV_DISABLE_HOST_SANDBOX,
    getSandboxConfig,
    getSandboxStatus,
    isHostSandboxDisabled,
    setHostSandboxDisabled,
};
