#!/usr/bin/env node

import readline from 'readline';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import {
    suggestCommandWithLLM,
    extractSingleCommandFromSuggestion,
    formatValidApiKeyList,
    promptToExecuteSuggestedCommand,
} from './commands/llmSystemCommands.js';
import {
    loadValidLlmApiKeys,
    collectAvailableLlmKeys,
    populateProcessEnvFromEnvFile,
    resolveEnvFilePath,
} from './services/llmProviderUtils.js';
import * as inputState from './services/inputState.js';
import { isKnownCommand } from './services/commandRegistry.js';

const WORKSPACE_ENV_FILENAME = '.env';
const ANSI_RESET = '\x1b[0m';
const ANSI_BOLD = '\x1b[1m';
const ANSI_MAGENTA = '\x1b[35m';
const ANSI_CYAN = '\x1b[36m';
const ANSI_GREEN = '\x1b[32m';
let envInfoLogged = false;
let modelsInfoLogged = false;

function printUsage() {
    console.log('Ploinky Light only provides LLM-based command recommendations.');
    console.log('Usage:');
    console.log('  ploinky -l                   # Interactive light mode');
    console.log('  ploinky -l <command or text> # Single recommendation and exit');
}

async function ensureLlmKeyAvailability() {
    const envPath = resolveEnvFilePath(process.cwd());
    logEnvDetails(envPath);
    populateProcessEnvFromEnvFile(envPath);
    await logAvailableModels();
    const availableKeys = collectAvailableLlmKeys(envPath);
    const validKeys = loadValidLlmApiKeys();

    return {
        availableKeys,
        validKeys,
        ok: availableKeys.length > 0,
    };
}

function showMissingKeyMessage(validKeys) {
    const validKeysList = formatValidApiKeyList(validKeys);
    console.log(`[Ploinky Light] No LLM API key configured. Add one of ${validKeysList} to ${WORKSPACE_ENV_FILENAME} or export it as an environment variable before retrying.`);
}

async function logAvailableModels() {
    if (modelsInfoLogged) return;
    modelsInfoLogged = true;
    try {
        const { listModelsFromCache } = await import('achillesAgentLib/utils/LLMClient.mjs');
        const { fast = [], deep = [] } = listModelsFromCache() || {};
        const names = [...new Set([
            ...fast.map((entry) => entry?.name || entry),
            ...deep.map((entry) => entry?.name || entry),
        ].filter(Boolean))];
        if (names.length) {
            console.log(`[Ploinky Light] Available LLM models: ${names.join(', ')}`);
        } else {
            console.log('[Ploinky Light] No LLM models configured.');
        }
    } catch (error) {
        console.log(`[Ploinky Light] Failed to list LLM models: ${error?.message || error}`);
    }
}

function logEnvDetails(envPath) {
    if (envInfoLogged) return;
    envInfoLogged = true;
    if (!envPath) {
        console.log('[Ploinky Light] No .env path resolved.');
        return;
    }
    if (fs.existsSync(envPath)) {
        console.log(`[Ploinky Light] Loading .env from ${envPath}`);
        try {
            const contents = fs.readFileSync(envPath, 'utf8');
            console.log('[Ploinky Light] .env contents:');
            console.log(contents);
        } catch (error) {
            console.log(`[Ploinky Light] Failed to read .env at ${envPath}: ${error?.message || error}`);
        }
    } else {
        console.log(`[Ploinky Light] No .env found at ${envPath}`);
    }
}

function getRelativePath() {
    const home = process.env.HOME || process.env.USERPROFILE;
    const cwd = process.cwd();
    if (home && cwd === home) return '~';
    if (home && cwd.startsWith(home)) return '~' + cwd.slice(home.length);
    return cwd;
}

function getColoredPrompt() {
    return `${ANSI_BOLD}${ANSI_MAGENTA}ploinky-light${ANSI_RESET} ${ANSI_CYAN}${getRelativePath()}${ANSI_RESET}${ANSI_GREEN}>${ANSI_RESET} `;
}

function renderLlmSuggestion(llmResult) {
    if (!llmResult?.status) {
        console.log('No suggestion received from the LLM. Try rephrasing your request.');
        return { ok: false, singleCommand: null };
    }

    if (llmResult.status === 'ok' && llmResult.suggestion) {
        const singleCommand = extractSingleCommandFromSuggestion(llmResult.suggestion);
        if (!singleCommand) {
            console.log('LLM suggested:');
            console.log(llmResult.suggestion);
        }
        return { ok: true, singleCommand };
    }

    if (llmResult.status === 'error' && llmResult.error) {
        if (llmResult.error.code === 401) {
            console.log('LLM call failed: API key invalid.');
        } else {
            console.log(`LLM call failed: ${llmResult.error.message}`);
        }
        return { ok: false, singleCommand: null };
    }

    console.log('No suggestion received from the LLM. Try rephrasing your request.');
    return { ok: false, singleCommand: null };
}

async function runSuggestedCommand(commandText) {
    const trimmedSuggestion = (commandText || '').trim();
    if (!trimmedSuggestion) return;
    const shellMetaPattern = /[|&;<>(){}\[\]`$]/;
    if (shellMetaPattern.test(trimmedSuggestion)) {
        console.log(`[LLM] Executing shell command: ${trimmedSuggestion}`);
        await new Promise((resolve) => {
            const restoreInput = inputState.prepareForExternalCommand?.() || (() => {});
            let finished = false;
            const finish = () => {
                if (finished) return;
                finished = true;
                try { restoreInput(); } catch (_) {}
                resolve();
            };
            let child;
            try {
                child = spawn(process.env.SHELL || 'bash', ['-lc', trimmedSuggestion], { stdio: 'inherit' });
            } catch (error) {
                console.error(`[LLM] Failed to start suggested command: ${error?.message || error}`);
                finish();
                return;
            }
            child.on('exit', (code) => {
                if (code && code !== 0) {
                    console.error(`[LLM] Command exited with code ${code}`);
                }
                finish();
            });
            child.on('error', (error) => {
                console.error(`[LLM] Failed to run suggested command: ${error?.message || error}`);
                finish();
            });
        });
        return;
    }

    const argsToRun = trimmedSuggestion.split(/\s+/).filter(Boolean);
    if (!argsToRun.length) return;
    await new Promise((resolve) => {
        const restoreInput = inputState.prepareForExternalCommand?.() || (() => {});
        let finished = false;
        const finish = () => {
            if (finished) return;
            finished = true;
            try { restoreInput(); } catch (_) {}
            resolve();
        };
        let child;
        try {
            child = spawn(argsToRun[0], argsToRun.slice(1), { stdio: 'inherit' });
        } catch (error) {
            console.error(`[LLM] Failed to start suggested command: ${error?.message || error}`);
            finish();
            return;
        }
        child.on('exit', (code) => {
            if (code && code !== 0) {
                console.error(`[LLM] Command exited with code ${code}`);
            }
            finish();
        });
        child.on('error', (error) => {
            console.error(`[LLM] Failed to run suggested command: ${error?.message || error}`);
            finish();
        });
    });
}

async function handleUserInput(rawInput) {
    const normalized = (rawInput || '').trim();
    if (!normalized) {
        console.log('Enter a command or question to get an LLM recommendation.');
        return false;
    }

    const firstToken = normalized.split(/\s+/)[0];
    if (isKnownCommand(firstToken)) {
        console.log(`[Ploinky Light] '${normalized}' is a Ploinky CLI command. Light mode cannot execute it; run 'ploinky ${normalized}' without -l to use the full CLI.`);
        return false;
    }

    const keyState = await ensureLlmKeyAvailability();
    if (!keyState.ok) {
        showMissingKeyMessage(keyState.validKeys);
        return false;
    }

    console.log('Asking the LLM for guidance...');
    const llmResult = await suggestCommandWithLLM(normalized);
    const { ok, singleCommand } = renderLlmSuggestion(llmResult);
    if (!ok) {
        return false;
    }

    if (singleCommand) {
        if (process.stdin.isTTY) {
            const shouldExecute = await promptToExecuteSuggestedCommand(singleCommand);
            if (shouldExecute) {
                await runSuggestedCommand(singleCommand);
            }
        } else {
            console.log('LLM suggested command:');
            console.log(singleCommand);
        }
    }

    return true;
}

function startInteractiveMode() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: getColoredPrompt(),
    });
    inputState.registerInterface?.(rl);
    const envPath = resolveEnvFilePath(process.cwd());
    logEnvDetails(envPath);
    ensureLlmKeyAvailability().catch(() => {});

    console.log('Ploinky Light mode. Ploinky commands are disabled; only LLM recommendations are available.');
    console.log("Type 'exit' or 'quit' to leave.");
    rl.prompt();

    rl.on('line', async (line) => {
        const trimmed = (line || '').trim();
        if (trimmed === 'exit' || trimmed === 'quit') {
            rl.close();
            return;
        }
        await handleUserInput(trimmed);
        rl.setPrompt(getColoredPrompt());
        rl.prompt();
    });

    rl.on('SIGINT', () => {
        try { process.stdout.write('\n'); } catch (_) {}
        rl.close();
    });

    rl.on('close', () => {
        inputState.registerInterface?.(null);
        process.exit(0);
    });
}

async function main() {
    const args = process.argv.slice(2);
    const envPath = resolveEnvFilePath(process.cwd());
    logEnvDetails(envPath);
    await ensureLlmKeyAvailability();
    if (args.includes('-h') || args.includes('--help')) {
        printUsage();
        return;
    }

    if (args.length === 0) {
        startInteractiveMode();
        return;
    }

    const inlineInput = args.join(' ');
    const ok = await handleUserInput(inlineInput);
    process.exit(ok ? 0 : 1);
}

main().catch((error) => {
    console.error(`ploinky-light failed: ${error?.message || error}`);
    process.exit(1);
});
