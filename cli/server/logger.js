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

export { LOG_DIR, LOG_PATH };
