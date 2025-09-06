const fs = require('fs').promises;
const path = require('path');

class MetricsCollector {
    constructor(options = {}) {
        this.metricsDir = options.metricsDir || './metrics';
        this.retentionDays = options.retentionDays || 7;
        this.flushInterval = options.flushInterval || 60000; // 1 minute
        
        // In-memory metrics
        this.requests = [];
        this.errors = [];
        this.agentMetrics = new Map();
        this.commandMetrics = new Map();
        
        this.startTime = Date.now();
        this.totalRequests = 0;
        this.totalErrors = 0;
        this.unauthorizedRequests = 0;
    }

    async init() {
        // Create metrics directory
        await fs.mkdir(this.metricsDir, { recursive: true });
        
        // Start periodic flush
        this.flushTimer = setInterval(() => {
            this.flush().catch(console.error);
        }, this.flushInterval);
        
        // Load previous metrics if available
        await this.loadPreviousMetrics();
    }

    recordRequest(url, duration, statusCode) {
        const timestamp = Date.now();
        const agentPath = this.extractAgentPath(url);
        
        // Add to requests array
        this.requests.push({
            timestamp,
            url,
            duration,
            statusCode,
            agentPath
        });
        
        // Update agent metrics
        if (!this.agentMetrics.has(agentPath)) {
            this.agentMetrics.set(agentPath, {
                count: 0,
                totalDuration: 0,
                minDuration: Infinity,
                maxDuration: 0,
                errors: 0
            });
        }
        
        const metrics = this.agentMetrics.get(agentPath);
        metrics.count++;
        metrics.totalDuration += duration;
        metrics.minDuration = Math.min(metrics.minDuration, duration);
        metrics.maxDuration = Math.max(metrics.maxDuration, duration);
        
        if (statusCode >= 400) {
            metrics.errors++;
        }
        
        this.totalRequests++;
    }

    recordCommand(agentPath, command, duration, success) {
        const key = `${agentPath}:${command}`;
        
        if (!this.commandMetrics.has(key)) {
            this.commandMetrics.set(key, {
                count: 0,
                totalDuration: 0,
                minDuration: Infinity,
                maxDuration: 0,
                failures: 0
            });
        }
        
        const metrics = this.commandMetrics.get(key);
        metrics.count++;
        metrics.totalDuration += duration;
        metrics.minDuration = Math.min(metrics.minDuration, duration);
        metrics.maxDuration = Math.max(metrics.maxDuration, duration);
        
        if (!success) {
            metrics.failures++;
        }
    }

    recordError(url, error) {
        this.errors.push({
            timestamp: Date.now(),
            url,
            error: error.message,
            stack: error.stack
        });
        
        this.totalErrors++;
    }

    recordUnauthorized(url) {
        this.unauthorizedRequests++;
        const agentPath = this.extractAgentPath(url);
        if (!this.agentMetrics.has(agentPath)) {
            this.agentMetrics.set(agentPath, {
                count: 0,
                totalDuration: 0,
                minDuration: Infinity,
                maxDuration: 0,
                errors: 0
            });
        }
        const metrics = this.agentMetrics.get(agentPath);
        metrics.count++;
        metrics.errors++;
    }

    extractAgentPath(url) {
        const parts = url.split('/').filter(Boolean);
        return parts[0] || 'root';
    }

    async flush() {
        if (this.requests.length === 0 && this.errors.length === 0) {
            return;
        }
        
        const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        const metricsFile = path.join(this.metricsDir, `metrics-${timestamp}.json`);
        
        try {
            // Read existing file or create new
            let existing = { requests: [], errors: [], summary: {} };
            try {
                const data = await fs.readFile(metricsFile, 'utf-8');
                existing = JSON.parse(data);
            } catch (err) {
                // File doesn't exist yet
            }
            
            // Append new data
            existing.requests.push(...this.requests);
            existing.errors.push(...this.errors);
            
            // Update summary
            existing.summary = this.getSummary();
            
            // Write back
            await fs.writeFile(metricsFile, JSON.stringify(existing, null, 2));
            
            // Clear in-memory data
            this.requests = [];
            this.errors = [];
            
        } catch (err) {
            console.error('Failed to flush metrics:', err);
        }
        
        // Clean up old metrics
        await this.cleanupOldMetrics();
    }

    async cleanupOldMetrics() {
        try {
            const files = await fs.readdir(this.metricsDir);
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - this.retentionDays);
            
            for (const file of files) {
                if (file.startsWith('metrics-')) {
                    const dateStr = file.replace('metrics-', '').replace('.json', '');
                    const fileDate = new Date(dateStr);
                    
                    if (fileDate < cutoffDate) {
                        await fs.unlink(path.join(this.metricsDir, file));
                    }
                }
            }
        } catch (err) {
            console.error('Failed to cleanup old metrics:', err);
        }
    }

    async loadPreviousMetrics() {
        try {
            const files = await fs.readdir(this.metricsDir);
            const today = new Date().toISOString().split('T')[0];
            const todayFile = `metrics-${today}.json`;
            
            if (files.includes(todayFile)) {
                const data = await fs.readFile(
                    path.join(this.metricsDir, todayFile), 
                    'utf-8'
                );
                const metrics = JSON.parse(data);
                
                // Restore summary data
                if (metrics.summary) {
                    this.totalRequests = metrics.summary.totalRequests || 0;
                    this.totalErrors = metrics.summary.totalErrors || 0;
                }
            }
        } catch (err) {
            console.error('Failed to load previous metrics:', err);
        }
    }

    getSummary() {
        const uptime = Date.now() - this.startTime;
        const avgRequestsPerMinute = (this.totalRequests / (uptime / 60000)).toFixed(2);
        
        const agentSummaries = {};
        for (const [agent, metrics] of this.agentMetrics.entries()) {
            agentSummaries[agent] = {
                count: metrics.count,
                avgDuration: (metrics.totalDuration / metrics.count).toFixed(2),
                minDuration: metrics.minDuration,
                maxDuration: metrics.maxDuration,
                errorRate: ((metrics.errors / metrics.count) * 100).toFixed(2) + '%'
            };
        }
        
        const commandSummaries = {};
        for (const [key, metrics] of this.commandMetrics.entries()) {
            commandSummaries[key] = {
                count: metrics.count,
                avgDuration: (metrics.totalDuration / metrics.count).toFixed(2),
                minDuration: metrics.minDuration,
                maxDuration: metrics.maxDuration,
                failureRate: ((metrics.failures / metrics.count) * 100).toFixed(2) + '%'
            };
        }
        
        return {
            uptime,
            totalRequests: this.totalRequests,
            totalErrors: this.totalErrors,
            avgRequestsPerMinute,
            errorRate: ((this.totalErrors / this.totalRequests) * 100).toFixed(2) + '%',
            unauthorizedRequests: this.unauthorizedRequests,
            agents: agentSummaries,
            commands: commandSummaries
        };
    }

    async getHistoricalMetrics(days = 7) {
        const metrics = [];
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        
        for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
            const dateStr = d.toISOString().split('T')[0];
            const fileName = `metrics-${dateStr}.json`;
            const filePath = path.join(this.metricsDir, fileName);
            
            try {
                const data = await fs.readFile(filePath, 'utf-8');
                const dayMetrics = JSON.parse(data);
                metrics.push({
                    date: dateStr,
                    ...dayMetrics
                });
            } catch (err) {
                // File doesn't exist for this day
            }
        }
        
        return metrics;
    }

    stop() {
        if (this.flushTimer) {
            clearInterval(this.flushTimer);
            this.flush().catch(console.error);
        }
    }
}

module.exports = { MetricsCollector };
