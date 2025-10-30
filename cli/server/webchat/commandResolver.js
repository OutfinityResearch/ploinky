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
    if (!cfg || !cfg.static) return { agentName: '', hostPath: '' };
    const agentName = trimCommand(cfg.static.agent);
    const hostPath = trimCommand(cfg.static.hostPath);
    return { agentName, hostPath };
}

function resolveWebchatCommands(options = {}) {
    const routingFilePath = options.routingFilePath || path.resolve('.ploinky/routing.json');
    const { agentName: staticAgentName, hostPath } = resolveStaticAgentDetails(routingFilePath);

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

    return {
        host: `ploinky cli ${staticAgentName}`,
        container: manifestCli,
        source: 'manifest',
        agentName: staticAgentName
    };
}

export {
    resolveWebchatCommands,
    extractManifestCli,
    trimCommand
};
