const fs = require('fs').promises;
const path = require('path');

class Logger {
    constructor(workingDir, level = 'info') {
        this.workingDir = workingDir;
        this.level = level;
        this.levels = { error: 0, warn: 1, info: 2, debug: 3 };
        this.logsDir = path.join(workingDir, 'logs');
        this.ready = this.init();
    }

    async init() {
        await fs.mkdir(this.logsDir, { recursive: true });
    }

    setLevel(level) {
        if (this.levels[level] !== undefined) this.level = level;
    }

    shouldLog(level) {
        return this.levels[level] <= this.levels[this.level];
    }

    async log(level, message, meta = {}) {
        if (!this.shouldLog(level)) return;
        await this.ready;
        const line = JSON.stringify({ ts: new Date().toISOString(), level, message, ...meta }) + '\n';
        const file = this.currentLogFile();
        try { await fs.appendFile(file, line); } catch (_) { /* ignore */ }
        // Echo important messages to console
        if (level === 'error' || level === 'warn') console.error(`[${level.toUpperCase()}] ${message}`);
    }

    currentLogFile(date = new Date()) {
        const d = date.toISOString().split('T')[0];
        return path.join(this.logsDir, `p-cloud-${d}.log`);
    }

    async tail(lines = 200) {
        await this.ready;
        const file = this.currentLogFile();
        try {
            const data = await fs.readFile(file, 'utf-8');
            const arr = data.trim().split('\n');
            return arr.slice(-lines).join('\n');
        } catch (_) { return ''; }
    }

    async listDates() {
        await this.ready;
        try {
            const files = await fs.readdir(this.logsDir);
            return files.filter(f => f.startsWith('p-cloud-') && f.endsWith('.log'))
                .map(f => f.substring('p-cloud-'.length, 'p-cloud-'.length + 10))
                .sort();
        } catch (_) { return []; }
    }

    async readByDate(dateStr) {
        await this.ready;
        try {
            const file = this.currentLogFile(new Date(`${dateStr}T00:00:00Z`));
            return await fs.readFile(file, 'utf-8');
        } catch (_) { return ''; }
    }
}

module.exports = { Logger };

