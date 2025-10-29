import fs from 'fs';
import path from 'path';

import * as workspaceSvc from '../services/workspace.js';
import { REPOS_DIR } from '../services/config.js';
import { ensureAgentService } from '../services/docker/index.js';
import { isContainerRunning } from '../services/docker/common.js';

function noopLog() {}

function logEvent(monitor, level, event, data = {}) {
    const logger = typeof monitor?.log === 'function' ? monitor.log : noopLog;
    logger(level, event, data);
}

function cleanRestartHistory(monitor, target) {
    if (!target) return;
    const windowMs = monitor?.config?.RESTART_WINDOW_MS ?? 60000;
    const now = Date.now();
    target.restartHistory = (target.restartHistory || []).filter((ts) => (now - ts) < windowMs);
}

function calculateBackoff(monitor, target) {
    if (!target) return monitor?.config?.INITIAL_BACKOFF_MS ?? 1000;
    const initial = monitor?.config?.INITIAL_BACKOFF_MS ?? 1000;
    const maxBackoff = monitor?.config?.MAX_BACKOFF_MS ?? 30000;
    const multiplier = monitor?.config?.BACKOFF_MULTIPLIER ?? 2;
    if (typeof target.currentBackoff !== 'number' || Number.isNaN(target.currentBackoff) || target.currentBackoff <= 0) {
        target.currentBackoff = initial;
    }
    const backoff = Math.min(target.currentBackoff, maxBackoff);
    target.currentBackoff = Math.min(target.currentBackoff * multiplier, maxBackoff);
    return backoff;
}

function createContainerTarget(info, monitor) {
    const initial = monitor?.config?.INITIAL_BACKOFF_MS ?? 1000;
    return {
        containerName: info.containerName,
        agentName: info.agentName,
        repoName: info.repoName,
        type: info.type,
        manifestPath: info.manifestPath,
        restartHistory: [],
        totalRestarts: 0,
        currentBackoff: initial,
        isRestarting: false,
        pendingRestartTimer: null,
        lastStartTime: null,
        lastSeenRunningAt: null,
        circuitBreakerTripped: false,
        lastError: null
    };
}

function syncManagedContainers(monitor) {
    const monitorRef = monitor;
    if (!monitorRef) return;

    let agentsMap = {};
    try {
        agentsMap = workspaceSvc.loadAgents() || {};
    } catch (error) {
        logEvent(monitorRef, 'error', 'container_sync_failed', { error: error?.message || error });
        return;
    }

    const desired = new Map();

    for (const [containerName, record] of Object.entries(agentsMap)) {
        if (!record || typeof record !== 'object') continue;
        if (containerName === '_config' || containerName.startsWith('_')) continue;

        const type = record.type || 'agent';
        if (type !== 'agent') continue;

        const agentName = record.agentName || record.shortAgentName || null;
        const repoName = record.repoName || record.repo || null;
        if (!agentName || !repoName) continue;

        const manifestPath = path.join(REPOS_DIR, repoName, agentName, 'manifest.json');
        if (!fs.existsSync(manifestPath)) {
            logEvent(monitorRef, 'warn', 'container_manifest_missing', {
                container: containerName,
                agent: agentName,
                repo: repoName,
                manifest: manifestPath
            });
            continue;
        }

        const info = { containerName, type, agentName, repoName, manifestPath };
        desired.set(containerName, info);

        let target = monitorRef.targets.get(containerName);
        if (!target) {
            target = createContainerTarget(info, monitorRef);
            monitorRef.targets.set(containerName, target);
            logEvent(monitorRef, 'info', 'container_watch_added', {
                container: containerName,
                agent: agentName,
                repo: repoName
            });
        } else {
            target.agentName = agentName;
            target.repoName = repoName;
            target.type = type;
            target.manifestPath = manifestPath;
        }
    }

    for (const [containerName, target] of Array.from(monitorRef.targets.entries())) {
        if (!desired.has(containerName)) {
            if (target?.pendingRestartTimer) {
                clearTimeout(target.pendingRestartTimer);
            }
            monitorRef.targets.delete(containerName);
            logEvent(monitorRef, 'info', 'container_watch_removed', { container: containerName });
        }
    }
}

function scheduleContainerRestart(monitor, target, reason) {
    if (!monitor || !target) return;
    if (monitor.isShuttingDown()) return;
    if (target.circuitBreakerTripped || target.isRestarting || target.pendingRestartTimer) return;

    cleanRestartHistory(monitor, target);
    const maxRestarts = monitor?.config?.MAX_RESTARTS_IN_WINDOW ?? 5;
    if (target.restartHistory.length >= maxRestarts) {
        target.circuitBreakerTripped = true;
        logEvent(monitor, 'fatal', 'container_circuit_breaker_tripped', {
            container: target.containerName,
            agent: target.agentName,
            repo: target.repoName,
            restarts: target.restartHistory.length,
            windowMs: monitor?.config?.RESTART_WINDOW_MS ?? 60000
        });
        return;
    }

    const now = Date.now();
    target.restartHistory.push(now);
    target.totalRestarts = (target.totalRestarts || 0) + 1;

    const backoff = calculateBackoff(monitor, target);

    logEvent(monitor, 'warn', 'container_scheduling_restart', {
        container: target.containerName,
        agent: target.agentName,
        repo: target.repoName,
        reason,
        backoffMs: backoff,
        attemptsInWindow: target.restartHistory.length
    });

    target.isRestarting = true;
    target.pendingRestartTimer = setTimeout(() => {
        target.pendingRestartTimer = null;
        performContainerRestart(monitor, target, reason);
    }, backoff);
}

function performContainerRestart(monitor, target, reason) {
    if (!monitor || !target) return;
    if (monitor.isShuttingDown()) {
        target.isRestarting = false;
        return;
    }

    if (!fs.existsSync(target.manifestPath)) {
        target.circuitBreakerTripped = true;
        logEvent(monitor, 'error', 'container_manifest_missing', {
            container: target.containerName,
            agent: target.agentName,
            repo: target.repoName,
            manifest: target.manifestPath
        });
        target.isRestarting = false;
        return;
    }

    if (target.type !== 'agent') {
        logEvent(monitor, 'warn', 'container_restart_skipped_type', {
            container: target.containerName,
            type: target.type
        });
        target.isRestarting = false;
        return;
    }

    let manifest;
    try {
        const manifestContent = fs.readFileSync(target.manifestPath, 'utf8');
        manifest = JSON.parse(manifestContent || '{}');
    } catch (error) {
        target.circuitBreakerTripped = true;
        target.lastError = error?.message || error;
        logEvent(monitor, 'error', 'container_manifest_parse_error', {
            container: target.containerName,
            manifest: target.manifestPath,
            error: target.lastError
        });
        target.isRestarting = false;
        return;
    }

    try {
        const agentDir = path.dirname(target.manifestPath);
        const result = ensureAgentService(target.agentName, manifest, agentDir);
        if (result?.containerName && result.containerName !== target.containerName) {
            const oldName = target.containerName;
            monitor.targets.delete(oldName);
            target.containerName = result.containerName;
            monitor.targets.set(target.containerName, target);
        }

        const now = Date.now();
        target.lastStartTime = now;
        target.lastSeenRunningAt = now;
        target.currentBackoff = monitor?.config?.INITIAL_BACKOFF_MS ?? 1000;
        target.circuitBreakerTripped = false;
        target.lastError = null;

        logEvent(monitor, 'info', 'container_restart_success', {
            container: target.containerName,
            agent: target.agentName,
            repo: target.repoName,
            reason
        });
    } catch (error) {
        target.lastError = error?.message || error;
        logEvent(monitor, 'error', 'container_restart_failed', {
            container: target.containerName,
            agent: target.agentName,
            repo: target.repoName,
            reason,
            error: target.lastError
        });
        target.isRestarting = false;
        scheduleContainerRestart(monitor, target, 'restart_failed');
        return;
    }

    target.isRestarting = false;
}

function monitorTick(monitor) {
    if (!monitor || monitor.isShuttingDown()) return;

    syncManagedContainers(monitor);

    for (const target of monitor.targets.values()) {
        if (!target || target.circuitBreakerTripped) continue;
        if (target.isRestarting || target.pendingRestartTimer) continue;

        let running = false;
        try {
            running = isContainerRunning(target.containerName);
        } catch (error) {
            logEvent(monitor, 'error', 'container_status_check_failed', {
                container: target.containerName,
                agent: target.agentName,
                repo: target.repoName,
                error: error?.message || error
            });
        }

        if (running) {
            const now = Date.now();
            target.lastSeenRunningAt = now;
            if (!target.lastStartTime) target.lastStartTime = now;
            const resetAfter = 60000;
            if ((now - target.lastStartTime) > resetAfter && target.currentBackoff !== (monitor?.config?.INITIAL_BACKOFF_MS ?? 1000)) {
                target.currentBackoff = monitor?.config?.INITIAL_BACKOFF_MS ?? 1000;
                cleanRestartHistory(monitor, target);
                target.circuitBreakerTripped = false;
                logEvent(monitor, 'debug', 'container_backoff_reset', {
                    container: target.containerName,
                    agent: target.agentName,
                    repo: target.repoName
                });
            }
            continue;
        }

        scheduleContainerRestart(monitor, target, 'not_running');
    }
}

export function createContainerMonitor({ config, log, isShuttingDown } = {}) {
    return {
        config: config || {},
        log,
        isShuttingDown: typeof isShuttingDown === 'function' ? isShuttingDown : () => false,
        targets: new Map(),
        timer: null
    };
}

export function startContainerMonitor(monitor) {
    if (!monitor || monitor.timer) return;
    if (monitor.isShuttingDown()) return;

    syncManagedContainers(monitor);
    monitorTick(monitor);

    const interval = monitor?.config?.CONTAINER_CHECK_INTERVAL_MS ?? 5000;
    monitor.timer = setInterval(() => {
        try {
            monitorTick(monitor);
        } catch (error) {
            logEvent(monitor, 'error', 'container_monitor_tick_error', { error: error?.message || error });
        }
    }, interval);

    logEvent(monitor, 'info', 'container_monitor_started', { intervalMs: interval });
}

export function stopContainerMonitor(monitor) {
    if (!monitor) return;
    if (monitor.timer) {
        clearInterval(monitor.timer);
        monitor.timer = null;
    }
    for (const target of monitor.targets.values()) {
        if (target?.pendingRestartTimer) {
            clearTimeout(target.pendingRestartTimer);
            target.pendingRestartTimer = null;
        }
        target.isRestarting = false;
    }
    logEvent(monitor, 'info', 'container_monitor_stopped', {
        tracked: monitor.targets.size
    });
}

export function clearContainerTargets(monitor) {
    if (!monitor) return;
    stopContainerMonitor(monitor);
    monitor.targets.clear();
}
