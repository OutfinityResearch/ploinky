import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import http from 'http';

import { createContainerMonitor, startContainerMonitor, stopContainerMonitor, clearContainerTargets } from './containerMonitor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const CONFIG = {
    SERVER_SCRIPT: path.join(__dirname, 'RoutingServer.js'),
    LOG_DIR: path.resolve(process.cwd(), 'logs'),
    PROCESS_LOG: path.join(path.resolve(process.cwd(), 'logs'), 'watchdog.log'),
    
    // Restart configuration
    MAX_RESTARTS_IN_WINDOW: 5,        // Max restarts allowed in time window
    RESTART_WINDOW_MS: 60000,          // Time window (60 seconds)
    INITIAL_BACKOFF_MS: 1000,          // Initial backoff (1 second)
    MAX_BACKOFF_MS: 30000,             // Max backoff (30 seconds)
    BACKOFF_MULTIPLIER: 2,             // Exponential backoff multiplier

    // Health check configuration
    HEALTH_CHECK_ENABLED: process.env.HEALTH_CHECK_ENABLED !== 'false',
    HEALTH_CHECK_INTERVAL_MS: 30000,   // Check every 30 seconds
    HEALTH_CHECK_TIMEOUT_MS: 5000,     // 5 second timeout
    HEALTH_CHECK_FAILURES_THRESHOLD: 3, // Restart after 3 consecutive failures

    // Process configuration
    PORT: process.env.PORT || 8080,
    NODE_OPTIONS: process.env.NODE_OPTIONS || '',

    // Container monitoring
    CONTAINER_CHECK_INTERVAL_MS: 5000, // Poll containers every 5 seconds
};

const IS_TEST_MODE = process.env.PLOINKY_WATCHDOG_TEST_MODE === '1';
const testLogBuffer = [];

function createInitialState() {
    return {
        childProcess: null,
        restartHistory: [],
        consecutiveFailures: 0,
        currentBackoff: CONFIG.INITIAL_BACKOFF_MS,
        isShuttingDown: false,
        healthCheckFailures: 0,
        healthCheckTimer: null,
        totalRestarts: 0,
        lastStartTime: null,
        circuitBreakerTripped: false,
        containerMonitor: null
    };
}

// State management
const state = createInitialState();

// Ensure log directory exists
function ensureLogDirectory() {
    try {
        fs.mkdirSync(CONFIG.LOG_DIR, { recursive: true });
    } catch (err) {
        console.error('[ProcessManager] Failed to create log directory:', err.message);
    }
}

// Logging function
function log(level, event, data = {}) {
    const logEntry = {
        ts: new Date().toISOString(),
        level,
        event,
        pid: state.childProcess?.pid || null,
        managerPid: process.pid,
        ...data
    };
    
    const logLine = JSON.stringify(logEntry);
    const consolePrefix = `[Watchdog:${level.toUpperCase()}]`;

    if (IS_TEST_MODE) {
        testLogBuffer.push(logEntry);
    }
    
    if (!IS_TEST_MODE) {
        // Console output with color
        switch (level) {
            case 'fatal':
            case 'error':
                console.error(consolePrefix, event, data);
                break;
            case 'warn':
                console.warn(consolePrefix, event, data);
                break;
            case 'info':
                console.log(consolePrefix, event, data);
                break;
            case 'debug':
                if (process.env.DEBUG) {
                    console.log(consolePrefix, event, data);
                }
                break;
        }
    }
    
    if (!IS_TEST_MODE) {
        // Write to log file
        try {
            ensureLogDirectory();
            fs.appendFileSync(CONFIG.PROCESS_LOG, logLine + '\n');
        } catch (err) {
            console.error('[Watchdog] Failed to write log:', err.message);
        }
    }
}

function ensureContainerMonitor() {
    if (!state.containerMonitor) {
        state.containerMonitor = createContainerMonitor({
            config: CONFIG,
            log,
            isShuttingDown: () => state.isShuttingDown
        });
    }
}

ensureContainerMonitor();

// Clean old restart history entries
function cleanRestartHistory() {
    const now = Date.now();
    state.restartHistory = state.restartHistory.filter(
        timestamp => now - timestamp < CONFIG.RESTART_WINDOW_MS
    );
}

// Check if circuit breaker should trip
function checkCircuitBreaker() {
    cleanRestartHistory();
    
    if (state.restartHistory.length >= CONFIG.MAX_RESTARTS_IN_WINDOW) {
        state.circuitBreakerTripped = true;
        log('fatal', 'circuit_breaker_tripped', {
            restarts: state.restartHistory.length,
            windowMs: CONFIG.RESTART_WINDOW_MS,
            message: `Server crashed ${state.restartHistory.length} times in ${CONFIG.RESTART_WINDOW_MS / 1000} seconds`
        });
        return true;
    }
    
    return false;
}

// Calculate next backoff delay
function calculateBackoff() {
    const backoff = Math.min(
        state.currentBackoff,
        CONFIG.MAX_BACKOFF_MS
    );
    
    // Exponential backoff for next time
    state.currentBackoff = Math.min(
        state.currentBackoff * CONFIG.BACKOFF_MULTIPLIER,
        CONFIG.MAX_BACKOFF_MS
    );
    
    return backoff;
}

// Reset backoff on successful long-running process
function resetBackoff() {
    state.currentBackoff = CONFIG.INITIAL_BACKOFF_MS;
    state.consecutiveFailures = 0;
    state.healthCheckFailures = 0;
}

// Health check function
async function performHealthCheck() {
    if (!CONFIG.HEALTH_CHECK_ENABLED || state.isShuttingDown) {
        return true;
    }
    
    return new Promise((resolve) => {
        const healthUrl = `http://127.0.0.1:${CONFIG.PORT}/health`;
        
        const timeout = setTimeout(() => {
            req.destroy();
            resolve(false);
        }, CONFIG.HEALTH_CHECK_TIMEOUT_MS);
        
        const req = http.get(healthUrl, (res) => {
            clearTimeout(timeout);
            
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const health = JSON.parse(data);
                    const isHealthy = res.statusCode === 200 && health.status === 'healthy';
                    resolve(isHealthy);
                } catch (err) {
                    resolve(false);
                }
            });
        });
        
        req.on('error', () => {
            clearTimeout(timeout);
            resolve(false);
        });
    });
}

// Start health check monitoring
function startHealthCheckMonitoring() {
    if (!CONFIG.HEALTH_CHECK_ENABLED) {
        return;
    }
    
    stopHealthCheckMonitoring();
    
    state.healthCheckTimer = setInterval(async () => {
        if (state.isShuttingDown || !state.childProcess) {
            return;
        }
        
        const isHealthy = await performHealthCheck();
        
        if (isHealthy) {
            if (state.healthCheckFailures > 0) {
                log('info', 'health_check_recovered', {
                    previousFailures: state.healthCheckFailures
                });
            }
            state.healthCheckFailures = 0;
        } else {
            state.healthCheckFailures++;
            log('warn', 'health_check_failed', {
                consecutiveFailures: state.healthCheckFailures,
                threshold: CONFIG.HEALTH_CHECK_FAILURES_THRESHOLD
            });
            
            if (state.healthCheckFailures >= CONFIG.HEALTH_CHECK_FAILURES_THRESHOLD) {
                log('error', 'health_check_threshold_exceeded', {
                    failures: state.healthCheckFailures,
                    action: 'restarting_process'
                });
                
                // Kill the unresponsive process
                if (state.childProcess) {
                    state.childProcess.kill('SIGTERM');
                }
            }
        }
    }, CONFIG.HEALTH_CHECK_INTERVAL_MS);
}

// Stop health check monitoring
function stopHealthCheckMonitoring() {
    if (state.healthCheckTimer) {
        clearInterval(state.healthCheckTimer);
        state.healthCheckTimer = null;
    }
}

function resetManagerState() {
    stopHealthCheckMonitoring();
    clearContainerTargets(state.containerMonitor);
    const initial = createInitialState();
    for (const key of Object.keys(initial)) {
        state[key] = initial[key];
    }
    ensureContainerMonitor();
}

function getTestLogs() {
    return testLogBuffer.slice();
}

function clearTestLogs() {
    testLogBuffer.length = 0;
}

// Spawn the server process
function spawnServer() {
    if (state.circuitBreakerTripped) {
        log('fatal', 'spawn_blocked_circuit_breaker', {
            message: 'Circuit breaker is tripped. Manual intervention required.'
        });
        console.error('\n========================================');
        console.error('CRITICAL: Circuit breaker tripped!');
        console.error(`Server crashed ${CONFIG.MAX_RESTARTS_IN_WINDOW} times in ${CONFIG.RESTART_WINDOW_MS / 1000} seconds.`);
        console.error('Manual intervention required. Check logs at:', CONFIG.PROCESS_LOG);
        console.error('========================================\n');
        process.exit(100);
    }
    
    state.lastStartTime = Date.now();
    
    log('info', 'spawning_server', {
        script: CONFIG.SERVER_SCRIPT,
        attempt: state.totalRestarts + 1,
        backoff: state.currentBackoff
    });
    
    const env = {
        ...process.env,
        MANAGED_BY_PROCESS_MANAGER: 'true',
    };
    
    const child = spawn('node', [CONFIG.SERVER_SCRIPT], {
        stdio: ['inherit', 'inherit', 'inherit'],
        env,
        detached: false
    });
    
    state.childProcess = child;
    
    log('info', 'server_spawned', {
        pid: child.pid,
        totalRestarts: state.totalRestarts
    });
    
    // Handle process exit
    child.on('exit', (code, signal) => {
        handleProcessExit(code, signal);
    });
    
    child.on('error', (err) => {
        log('error', 'spawn_error', {
            error: err.message,
            code: err.code
        });
    });
    
    // Start health monitoring after a brief delay
    setTimeout(() => {
        if (!state.isShuttingDown && state.childProcess === child) {
            startHealthCheckMonitoring();
        }
    }, 10000); // Wait 10 seconds for server to start
}

// Handle process exit
function handleProcessExit(code, signal) {
    stopHealthCheckMonitoring();
    
    const uptime = state.lastStartTime ? Date.now() - state.lastStartTime : 0;
    const uptimeSeconds = Math.floor(uptime / 1000);
    
    log('warn', 'process_exited', {
        exitCode: code,
        signal,
        uptime,
        uptimeSeconds,
        wasExpected: state.isShuttingDown
    });
    
    state.childProcess = null;
    
    // If we're shutting down, don't restart
    if (state.isShuttingDown) {
        log('info', 'shutdown_complete', { exitCode: code });
        process.exit(code || 0);
        return;
    }
    
    // Check if this was a successful run (uptime > 60 seconds)
    if (uptime > 60000) {
        log('info', 'successful_run_detected', {
            uptimeSeconds,
            message: 'Resetting backoff and failure counters'
        });
        resetBackoff();
    }
    
    // Determine if we should restart
    const shouldRestart = determineShouldRestart(code, signal);
    
    if (!shouldRestart) {
        log('info', 'restart_skipped', { exitCode: code, signal });
        process.exit(code || 0);
        return;
    }
    
    // Record restart attempt
    state.restartHistory.push(Date.now());
    state.consecutiveFailures++;
    state.totalRestarts++;
    
    // Check circuit breaker
    if (checkCircuitBreaker()) {
        return; // Will exit with code 100
    }
    
    // Calculate backoff
    const backoff = calculateBackoff();
    
    log('info', 'scheduling_restart', {
        backoffMs: backoff,
        consecutiveFailures: state.consecutiveFailures,
        totalRestarts: state.totalRestarts,
        recentRestarts: state.restartHistory.length
    });
    
    // Restart after backoff
    setTimeout(() => {
        spawnServer();
    }, backoff);
}

// Determine if we should restart based on exit conditions
function determineShouldRestart(code, signal) {
    // Clean exit (code 0) = no restart
    if (code === 0) {
        log('info', 'clean_exit', { message: 'Process exited cleanly, no restart needed' });
        return false;
    }
    
    // Port conflict or permission error (code 2) = no restart
    if (code === 2) {
        log('error', 'configuration_error', {
            exitCode: code,
            message: 'Configuration error (port conflict or permission). Fix required.'
        });
        return false;
    }
    
    // Fatal error that should not restart (code >= 100)
    if (code >= 100) {
        log('fatal', 'fatal_error_no_restart', {
            exitCode: code,
            message: 'Fatal error, manual intervention required'
        });
        return false;
    }
    
    // SIGTERM or SIGINT from external source = assume intentional, no restart
    if (signal === 'SIGTERM' || signal === 'SIGINT') {
        log('info', 'intentional_signal', {
            signal,
            message: 'Process received shutdown signal, no restart'
        });
        return false;
    }
    
    // All other exits = restart
    log('info', 'unexpected_exit', {
        exitCode: code,
        signal,
        message: 'Unexpected exit, will restart'
    });
    return true;
}

// Graceful shutdown of watchdog
function shutdownManager(signal) {
    if (state.isShuttingDown) {
        return;
    }
    
    state.isShuttingDown = true;
    log('info', 'watchdog_shutting_down', { signal });
    
    stopHealthCheckMonitoring();
    stopContainerMonitor(state.containerMonitor);
    
    if (state.childProcess) {
        log('info', 'stopping_child_process', { pid: state.childProcess.pid });
        
        // Forward the signal to the child
        state.childProcess.kill(signal || 'SIGTERM');
        
        // Set a timeout to force kill
        setTimeout(() => {
            if (state.childProcess) {
                log('warn', 'force_killing_child', { pid: state.childProcess.pid });
                state.childProcess.kill('SIGKILL');
                setTimeout(() => process.exit(0), 1000);
            }
        }, 15000); // 15 second timeout
    } else {
        process.exit(0);
    }
}

// Main startup
function main() {
    log('info', 'process_manager_starting', {
        serverScript: CONFIG.SERVER_SCRIPT,
        port: CONFIG.PORT,
        healthCheckEnabled: CONFIG.HEALTH_CHECK_ENABLED,
        maxRestartsInWindow: CONFIG.MAX_RESTARTS_IN_WINDOW,
        restartWindowSeconds: CONFIG.RESTART_WINDOW_MS / 1000
    });
    
    // Verify server script exists
    if (!fs.existsSync(CONFIG.SERVER_SCRIPT)) {
        log('fatal', 'server_script_not_found', {
            path: CONFIG.SERVER_SCRIPT,
            message: 'Server script does not exist'
        });
        console.error(`[Watchdog] FATAL: Server script not found: ${CONFIG.SERVER_SCRIPT}`);
        process.exit(1);
    }
    
    // Setup signal handlers
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGQUIT']) {
        process.on(signal, () => shutdownManager(signal));
    }
    
    // Handle watchdog errors
    process.on('uncaughtException', (error) => {
        log('fatal', 'watchdog_uncaught_exception', {
            error: error.message,
            stack: error.stack
        });
        console.error('[Watchdog] FATAL: Uncaught exception:', error);
        shutdownManager('SIGTERM');
    });
    
    process.on('unhandledRejection', (reason) => {
        log('error', 'watchdog_unhandled_rejection', {
            reason: String(reason)
        });
        console.error('[Watchdog] Unhandled rejection:', reason);
    });
    
    // Log on exit
    process.on('exit', (code) => {
        log('info', 'watchdog_exiting', { exitCode: code });
    });
    
    // Start the server and monitoring
    ensureContainerMonitor();
    spawnServer();
    startContainerMonitor(state.containerMonitor);

    console.log('\n========================================');
    console.log('Watchdog Started');
    console.log('========================================');
    console.log(`Server script: ${CONFIG.SERVER_SCRIPT}`);
    console.log(`Port: ${CONFIG.PORT}`);
    console.log(`Health checks: ${CONFIG.HEALTH_CHECK_ENABLED ? 'Enabled' : 'Disabled'}`);
    console.log(`Max restarts: ${CONFIG.MAX_RESTARTS_IN_WINDOW} in ${CONFIG.RESTART_WINDOW_MS / 1000}s`);
    console.log(`Logs: ${CONFIG.PROCESS_LOG}`);
    console.log('========================================\n');
}

// Start the process manager
if (!IS_TEST_MODE) {
    main();
}

export {
    CONFIG,
    state,
    resetManagerState,
    determineShouldRestart,
    calculateBackoff,
    resetBackoff,
    cleanRestartHistory,
    checkCircuitBreaker,
    getTestLogs,
    clearTestLogs,
    IS_TEST_MODE as __IS_TEST_MODE
};
