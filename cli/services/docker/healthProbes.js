import { spawnSync } from 'child_process';

import {
    containerRuntime,
    waitForContainerRunning,
    sleepMs
} from './common.js';

const DEFAULT_PROBES = [
    { type: 'liveness', script: 'liveness_probe.sh', success: 'live', failure: 'not live' },
    { type: 'readiness', script: 'readiness_probe.sh', success: 'ready', failure: 'not ready' }
];

const MAX_ATTEMPTS = 5;
const RETRY_DELAY_MS = 1000;

function runSingleProbe(agentName, containerName, probe) {
    const scriptPath = `/code/${probe.script}`;
    const exists = spawnSync(containerRuntime, ['exec', containerName, 'sh', '-lc', `[ -f "${scriptPath}" ]`], { stdio: 'ignore' });

    if (exists.error) {
        throw new Error(`[probe] ${agentName}: unable to inspect ${probe.type} probe: ${exists.error.message}`);
    }

    if (exists.status !== 0) {
        console.log(`[probe] ${agentName}: ${probe.type}: ${probe.success}`);
        return;
    }

    console.log(`[probe] ${agentName}: found ${probe.type} probe at ${scriptPath}.`);

    let attempt = 0;
    let lastOutput = '';

    while (attempt < MAX_ATTEMPTS) {
        attempt += 1;
        console.log(`[probe] ${agentName}: running ${probe.type} probe (attempt ${attempt}/${MAX_ATTEMPTS}).`);
        const execRes = spawnSync(
            containerRuntime,
            ['exec', containerName, 'sh', '-lc', `cd /code && sh "./${probe.script}"`],
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
        );

        if (execRes.error) {
            lastOutput = execRes.error.message || '';
            if (attempt >= MAX_ATTEMPTS) {
                throw new Error(`[probe] ${agentName}: failed to start; ${probe.type} probe execution error: ${lastOutput}`);
            }
            console.log(`[probe] ${agentName}: ${probe.type} probe error '${lastOutput}', retrying (${attempt}/${MAX_ATTEMPTS})...`);
            sleepMs(RETRY_DELAY_MS);
            continue;
        }

        const exitCode = typeof execRes.status === 'number' ? execRes.status : 0;
        const stdout = (execRes.stdout || '').trim();
        const stderr = (execRes.stderr || '').trim();
        lastOutput = stdout || stderr;
        const normalized = (lastOutput || '').trim().toLowerCase();

        if (normalized === probe.success && exitCode === 0) {
            console.log(`[probe] ${agentName}: ${probe.type}: ${probe.success}`);
            return;
        }

        if (normalized === probe.failure) {
            if (attempt >= MAX_ATTEMPTS) {
                throw new Error(`[probe] ${agentName}: failed to start; ${probe.type} probe reported '${probe.failure}'.`);
            }
            console.log(`[probe] ${agentName}: ${probe.type} probe reported '${probe.failure}', retrying (${attempt}/${MAX_ATTEMPTS})...`);
            sleepMs(RETRY_DELAY_MS);
            continue;
        }

        if (exitCode !== 0) {
            if (attempt >= MAX_ATTEMPTS) {
                throw new Error(`[probe] ${agentName}: failed to start; ${probe.type} probe exited with code ${exitCode}.`);
            }
            console.log(`[probe] ${agentName}: ${probe.type} probe exited with code ${exitCode}, retrying (${attempt}/${MAX_ATTEMPTS})...`);
            sleepMs(RETRY_DELAY_MS);
            continue;
        }

        if (!normalized) {
            if (attempt >= MAX_ATTEMPTS) {
                throw new Error(`[probe] ${agentName}: failed to start; ${probe.type} probe produced no output.`);
            }
            console.log(`[probe] ${agentName}: ${probe.type} probe produced no output, retrying (${attempt}/${MAX_ATTEMPTS})...`);
            sleepMs(RETRY_DELAY_MS);
            continue;
        }

        if (attempt >= MAX_ATTEMPTS) {
            throw new Error(`[probe] ${agentName}: failed to start; ${probe.type} probe output '${lastOutput}'.`);
        }

        console.log(`[probe] ${agentName}: ${probe.type} probe output '${lastOutput}', retrying (${attempt}/${MAX_ATTEMPTS})...`);
        sleepMs(RETRY_DELAY_MS);
    }
}

export function runHealthProbes(agentName, containerName) {
    if (!waitForContainerRunning(containerName, 40, 250)) {
        throw new Error(`[probe] ${agentName}: failed to start; container is not running.`);
    }

    for (const probe of DEFAULT_PROBES) {
        runSingleProbe(agentName, containerName, probe);
    }
}
