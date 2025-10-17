import fs from 'fs';
import path from 'path';

const LOG_DIR = path.resolve(process.cwd(), 'logs');
const LOG_PATH = path.join(LOG_DIR, 'router.log');

function ensureLogDirectory() {
    try {
        fs.mkdirSync(LOG_DIR, { recursive: true });
    } catch (_) {
        // Ignore logging directory errors to avoid crashing the server.
    }
}

export function appendLog(type, data = {}) {
    try {
        ensureLogDirectory();
        const record = JSON.stringify({
            ts: new Date().toISOString(),
            level: 'debug',
            type,
            ...data
        });
        fs.appendFileSync(LOG_PATH, `${record}\n`);
    } catch (_) {
        // Ignore logging failures; diagnostics should not interrupt routing.
    }
}

export function logBootEvent(action, details = {}) {
    appendLog('boot_operation', { action, ...details });
}

export function logCrash(errorType, error, additionalData = {}) {
    const errorDetails = {
        level: 'fatal',
        errorType,
        message: error?.message || String(error),
        stack: error?.stack || null,
        code: error?.code || null,
        pid: process.pid,
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
        ...additionalData
    };
    
    try {
        ensureLogDirectory();
        const record = JSON.stringify({
            ts: new Date().toISOString(),
            type: 'crash',
            ...errorDetails
        });
        fs.appendFileSync(LOG_PATH, `${record}\n`);
        
        // Also write to stderr for immediate visibility
        console.error(`[CRASH] ${errorType}:`, error?.message || String(error));
        if (error?.stack) {
            console.error(error.stack);
        }
    } catch (_) {
        // Last resort: write to stderr
        console.error('[CRASH] Failed to log crash:', errorType, error);
    }
}

export function logMemoryUsage() {
    const usage = process.memoryUsage();
    appendLog('memory_usage', {
        rss: usage.rss,
        heapTotal: usage.heapTotal,
        heapUsed: usage.heapUsed,
        external: usage.external,
        arrayBuffers: usage.arrayBuffers,
        rssMB: Math.round(usage.rss / 1024 / 1024),
        heapUsedMB: Math.round(usage.heapUsed / 1024 / 1024)
    });
}

export function logShutdown(reason, exitCode = 0, additionalData = {}) {
    const shutdownDetails = {
        level: exitCode === 0 ? 'info' : 'error',
        reason,
        exitCode,
        pid: process.pid,
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
        ...additionalData
    };
    
    try {
        ensureLogDirectory();
        const record = JSON.stringify({
            ts: new Date().toISOString(),
            type: 'shutdown',
            ...shutdownDetails
        });
        fs.appendFileSync(LOG_PATH, `${record}\n`);
        console.log(`[SHUTDOWN] ${reason} (exit code: ${exitCode})`);
    } catch (_) {
        console.error('[SHUTDOWN] Failed to log shutdown:', reason);
    }
}

export { LOG_DIR, LOG_PATH };
