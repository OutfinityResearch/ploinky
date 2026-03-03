import fs from 'fs';
import path from 'path';
import { PLOINKY_DIR } from '../config.js';
import { debugLog } from '../utils.js';

const BWRAP_PIDS_DIR = path.join(PLOINKY_DIR, 'bwrap-pids');
const SLEEP_ARRAY = new Int32Array(new SharedArrayBuffer(4));

function sleepMs(ms) {
    Atomics.wait(SLEEP_ARRAY, 0, 0, ms);
}

function ensurePidDir() {
    if (!fs.existsSync(BWRAP_PIDS_DIR)) {
        fs.mkdirSync(BWRAP_PIDS_DIR, { recursive: true });
    }
}

function getPidFile(agentName) {
    return path.join(BWRAP_PIDS_DIR, `${agentName}.pid`);
}

function getBwrapPid(agentName) {
    const pidFile = getPidFile(agentName);
    if (!fs.existsSync(pidFile)) return 0;
    try {
        const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
        return Number.isFinite(pid) && pid > 0 ? pid : 0;
    } catch (_) {
        return 0;
    }
}

function saveBwrapPid(agentName, pid) {
    ensurePidDir();
    fs.writeFileSync(getPidFile(agentName), String(pid));
}

function clearBwrapPid(agentName) {
    const pidFile = getPidFile(agentName);
    try { fs.unlinkSync(pidFile); } catch (_) { }
}

function isBwrapProcessRunning(agentName) {
    const pid = getBwrapPid(agentName);
    if (!pid) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        // Process doesn't exist — clean up stale PID file
        clearBwrapPid(agentName);
        return false;
    }
}

function stopBwrapProcess(agentName, { signal = 'SIGTERM', timeout = 5000 } = {}) {
    const pid = getBwrapPid(agentName);
    if (!pid) {
        debugLog(`[bwrap] ${agentName}: no PID file found`);
        return false;
    }

    // Send signal to process group (negative PID)
    try {
        process.kill(-pid, signal);
        console.log(`[bwrap] ${agentName}: sent ${signal} to process group ${pid}`);
    } catch (e) {
        if (e.code === 'ESRCH') {
            console.log(`[bwrap] ${agentName}: process ${pid} already exited`);
            clearBwrapPid(agentName);
            return true;
        }
        // EPERM — try killing just the process, not the group
        try {
            process.kill(pid, signal);
        } catch (e2) {
            if (e2.code === 'ESRCH') {
                clearBwrapPid(agentName);
                return true;
            }
            debugLog(`[bwrap] ${agentName}: kill failed: ${e2.message}`);
        }
    }

    // Wait for process to die
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        try {
            process.kill(pid, 0);
            sleepMs(200);
        } catch {
            console.log(`[bwrap] ${agentName}: process ${pid} exited`);
            clearBwrapPid(agentName);
            return true;
        }
    }

    // Force kill
    console.log(`[bwrap] ${agentName}: force killing process ${pid}`);
    try { process.kill(-pid, 'SIGKILL'); } catch (_) { }
    try { process.kill(pid, 'SIGKILL'); } catch (_) { }
    clearBwrapPid(agentName);
    return true;
}

function stopAllBwrapProcesses() {
    if (!fs.existsSync(BWRAP_PIDS_DIR)) return [];
    const stopped = [];
    for (const file of fs.readdirSync(BWRAP_PIDS_DIR)) {
        if (!file.endsWith('.pid')) continue;
        const agentName = file.replace('.pid', '');
        if (stopBwrapProcess(agentName)) {
            stopped.push(agentName);
        }
    }
    return stopped;
}

export {
    BWRAP_PIDS_DIR,
    getBwrapPid,
    saveBwrapPid,
    clearBwrapPid,
    isBwrapProcessRunning,
    stopBwrapProcess,
    stopAllBwrapProcesses
};
