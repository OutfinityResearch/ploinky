import fs from 'fs';
import path from 'path';
function trimCommand(value) {
    if (!value) return '';
    const text = String(value).trim();
    return text.length ? text : '';
}

function readRoutingConfig(routingFilePath) {
    try {
        const raw = fs.readFileSync(routingFilePath, 'utf8');
        return JSON.parse(raw);
    } catch (_) {
        return null;
    }
}

function extractManifestCli(manifest) {
    if (!manifest || typeof manifest !== 'object') return '';
    const candidates = [
        manifest.cli,
        manifest.commands && manifest.commands.cli,
        manifest.run,
        manifest.commands && manifest.commands.run
    ];
    for (const entry of candidates) {
        const candidate = trimCommand(entry);
        if (candidate) return candidate;
    }
    return '';
}

function resolveStaticAgentDetails(routingFilePath) {
    const cfg = readRoutingConfig(routingFilePath);
    if (!cfg || !cfg.static) {
        return { agentName: '', hostPath: '', containerName: '', alias: '' };
    }
    const agentName = trimCommand(cfg.static.agent);
    const hostPath = trimCommand(cfg.static.hostPath);
    const containerName = trimCommand(cfg.static.container);
    const alias = trimCommand(cfg.static.alias);
    return { agentName, hostPath, containerName, alias };
}

function resolveCliTarget(record = {}, fallbackName = '') {
    // Priority: alias > agent name (fallback) > container name
    // The CLI command expects agent names or aliases, not container names
    const alias = trimCommand(record.alias);
    if (alias) return alias;
    // Prefer agent name over container name - container names cause lookup issues
    const agentName = trimCommand(fallbackName);
    if (agentName) return agentName;
    const container = trimCommand(record.container);
    if (container) return container;
    return '';
}

function resolveWebchatCommands(options = {}) {
    const routingFilePath = options.routingFilePath || path.resolve('.ploinky/routing.json');
    const { agentName: staticAgentName, hostPath, containerName, alias } = resolveStaticAgentDetails(routingFilePath);

    if (!staticAgentName || !hostPath) {
        return { host: '', container: '', source: 'unset', agentName: '' };
    }

    const manifestPath = options.manifestPathOverride || path.join(hostPath, 'manifest.json');
    let manifestCli = '';
    try {
        if (fs.existsSync(manifestPath)) {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            manifestCli = extractManifestCli(manifest);
        }
    } catch (_) {
        manifestCli = '';
    }

    if (!manifestCli) {
        // If we have an agent but no manifest command, we should still return the agent name
        // as other features like blob storage might depend on it.
        // The TTY factory will simply have no command to run, which is handled elsewhere.
        return { host: '', container: '', source: 'unset', agentName: staticAgentName };
    }

    const cliTarget = resolveCliTarget({ alias, container: containerName }, staticAgentName);
    const hostCommand = cliTarget ? `ploinky cli ${cliTarget}` : '';
    return {
        host: hostCommand,
        container: manifestCli,
        source: 'manifest',
        agentName: staticAgentName,
        cliTarget,
        cacheKey: 'webchat'
    };
}

function resolveWebchatCommandsForAgent(agentRef, options = {}) {
    const routingFilePath = options.routingFilePath || path.resolve('.ploinky/routing.json');
    const routing = readRoutingConfig(routingFilePath);
    if (!routing) return null;
    const routes = routing.routes || {};
    let record = routes[agentRef];
    if (!record) {
        const staticAgent = trimCommand(routing.static?.agent);
        if (staticAgent && staticAgent === agentRef) {
            record = routing.static;
        }
    }

    if (!record || !record.hostPath) {
        return null;
    }

    const manifestPath = path.join(record.hostPath, 'manifest.json');
    let manifestCli = '';
    try {
        if (fs.existsSync(manifestPath)) {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            manifestCli = extractManifestCli(manifest);
        }
    } catch (_) {
        manifestCli = '';
    }
    const cliTarget = resolveCliTarget(record, agentRef);
    const hostCommand = cliTarget ? `ploinky cli ${cliTarget}` : '';
    return {
        host: hostCommand,
        container: manifestCli,
        source: 'manifest',
        agentName: agentRef,
        cliTarget,
        cacheKey: `webchat:${agentRef}`
    };
}

export {
    resolveWebchatCommands,
    resolveWebchatCommandsForAgent,
    extractManifestCli,
    trimCommand
};
