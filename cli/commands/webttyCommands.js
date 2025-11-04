import fs from 'fs';
import path from 'path';
import * as envSvc from '../services/secretVars.js';

function configureWebttyShell(input) {
    const allowed = new Set(['sh', 'zsh', 'dash', 'ksh', 'csh', 'tcsh', 'fish']);
    const name = String(input || '').trim();
    if (!allowed.has(name) && !name.startsWith('/')) {
        console.error(`Unsupported shell '${name}'. Allowed: ${Array.from(allowed).join(', ')}, or an absolute path.`);
        return false;
    }
    const pathDirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
    const candidates = name.startsWith('/') ? [name] : pathDirs.map(d => path.join(d, name));
    let found = null;
    for (const p of candidates) {
        try { fs.accessSync(p, fs.constants.X_OK); found = p; break; } catch (_) { }
    }
    if (!found) {
        console.error(`Cannot execute shell '${name}': not found or not executable in PATH.`);
        return false;
    }
    try {
        envSvc.setEnvVar('WEBTTY_SHELL', found);
        envSvc.setEnvVar('WEBTTY_COMMAND', `exec ${name}`);
        console.log(`✓ Configured WebTTY shell: ${name} (${found}).`);
        console.log('Note: Restart the router (restart) for changes to take effect.');
        return true;
    } catch (e) {
        console.error(`Failed to configure WebTTY shell: ${e?.message || e}`);
        return false;
    }
}

export { configureWebttyShell };
