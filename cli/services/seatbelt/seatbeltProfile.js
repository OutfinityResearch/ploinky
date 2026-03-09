import fs from 'fs';
import path from 'path';
import { PLOINKY_DIR } from '../config.js';

const SEATBELT_PROFILES_DIR = path.join(PLOINKY_DIR, 'seatbelt-profiles');

/**
 * Build an SBPL (Seatbelt Profile Language) string for sandbox-exec.
 *
 * Unlike bwrap which creates a virtual filesystem via bind mounts,
 * sandbox-exec uses macOS's Seatbelt framework to restrict filesystem
 * access at the kernel level.  Processes see real host paths.
 */
function buildSeatbeltProfile(options) {
    const {
        agentCodePath,
        agentLibPath,
        nodeModulesDir,
        sharedDir,
        cwd,
        skillsPath,
        codeReadOnly,
        skillsReadOnly,
        volumes
    } = options;

    const lines = [];
    lines.push('(version 1)');
    lines.push('(deny default)');
    lines.push('');

    // System read access (macOS paths)
    lines.push('; System read access');
    lines.push('(allow file-read* (literal "/"))');
    lines.push('(allow file-read*');
    lines.push('    (subpath "/usr")');
    lines.push('    (subpath "/System")');
    lines.push('    (subpath "/Library")');
    lines.push('    (subpath "/Applications")');
    lines.push('    (subpath "/private")');
    lines.push('    (subpath "/dev")');
    lines.push('    (subpath "/var")');
    lines.push('    (subpath "/etc")');
    lines.push('    (subpath "/tmp")');
    lines.push('    (subpath "/bin")');
    lines.push('    (subpath "/sbin")');
    lines.push('    (subpath "/opt")');
    lines.push(')');
    lines.push('');

    // Temp and device write access (HOME=/tmp for agents)
    lines.push('; Temp and device write access');
    lines.push('(allow file-write* (subpath "/tmp") (subpath "/private/tmp") (subpath "/dev"))');
    lines.push('');

    // Full network (agents use host network)
    lines.push('; Network access');
    lines.push('(allow network*)');
    lines.push('');

    // Process operations + Mach IPC (required on macOS)
    lines.push('; Process and IPC');
    lines.push('(allow process-fork process-exec*)');
    lines.push('(allow mach-lookup mach-register)');
    lines.push('(allow ipc-posix* signal sysctl-read)');
    lines.push('');

    // Agent library (always read-only)
    lines.push('; Agent library (read-only)');
    lines.push(`(allow file-read* (subpath ${sbplQuote(agentLibPath)}))`);
    lines.push('');

    // Agent code directory
    lines.push('; Agent code');
    lines.push(`(allow file-read* (subpath ${sbplQuote(agentCodePath)}))`);
    if (!codeReadOnly) {
        lines.push(`(allow file-write* (subpath ${sbplQuote(agentCodePath)}))`);
    }
    lines.push('');

    // node_modules — always rw
    lines.push('; node_modules (read-write)');
    lines.push(`(allow file-read* file-write* (subpath ${sbplQuote(nodeModulesDir)}))`);
    lines.push('');

    // Shared directory
    lines.push('; Shared directory');
    lines.push(`(allow file-read* file-write* (subpath ${sbplQuote(sharedDir)}))`);
    lines.push('');

    // CWD passthrough (workspace agent dir)
    lines.push('; Agent work directory');
    lines.push(`(allow file-read* file-write* (subpath ${sbplQuote(cwd)}))`);
    lines.push('');

    // Skills directory
    if (skillsPath && fs.existsSync(skillsPath)) {
        lines.push('; Skills directory');
        lines.push(`(allow file-read* (subpath ${sbplQuote(skillsPath)}))`);
        if (!skillsReadOnly) {
            lines.push(`(allow file-write* (subpath ${sbplQuote(skillsPath)}))`);
        }
        lines.push('');
    }

    // Custom volumes from manifest
    if (volumes && typeof volumes === 'object') {
        const volumeEntries = Object.entries(volumes);
        if (volumeEntries.length) {
            lines.push('; Custom volumes');
            for (const [hostPath] of volumeEntries) {
                const resolvedHostPath = path.isAbsolute(hostPath)
                    ? hostPath
                    : path.resolve(cwd, hostPath);
                lines.push(`(allow file-read* file-write* (subpath ${sbplQuote(resolvedHostPath)}))`);
            }
            lines.push('');
        }
    }

    // Parent directory traversal — macOS sandbox requires read access to every
    // ancestor directory in order to stat/traverse into allowed subpaths.
    const allPaths = [agentCodePath, agentLibPath, nodeModulesDir, sharedDir, cwd, skillsPath].filter(Boolean);
    const parentLiterals = new Set();
    for (const p of allPaths) {
        let dir = path.dirname(p);
        while (dir && dir !== '/' && dir !== '.') {
            parentLiterals.add(dir);
            dir = path.dirname(dir);
        }
    }
    if (parentLiterals.size) {
        lines.push('; Parent directory traversal');
        const sorted = [...parentLiterals].sort();
        for (const dir of sorted) {
            lines.push(`(allow file-read* (literal ${sbplQuote(dir)}))`);
        }
        lines.push('');
    }

    return lines.join('\n') + '\n';
}

/**
 * Quote a path for SBPL (Seatbelt Profile Language).
 * Paths are quoted with double quotes.
 */
function sbplQuote(str) {
    return `"${String(str).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Write a seatbelt profile to disk.
 * Returns the file path.
 */
function writeSeatbeltProfile(agentName, content) {
    if (!fs.existsSync(SEATBELT_PROFILES_DIR)) {
        fs.mkdirSync(SEATBELT_PROFILES_DIR, { recursive: true });
    }
    const profilePath = path.join(SEATBELT_PROFILES_DIR, `${agentName}.sb`);
    fs.writeFileSync(profilePath, content, 'utf8');
    return profilePath;
}

export {
    SEATBELT_PROFILES_DIR,
    buildSeatbeltProfile,
    writeSeatbeltProfile
};
