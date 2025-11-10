import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync, spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { defaultLLMInvokerStrategy } from 'achillesAgentLib/utils/LLMClient.mjs';
import { debugLog } from '../services/utils.js';
import { loadValidLlmApiKeys, collectAvailableLlmKeys } from '../services/llmProviderUtils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const LLM_SYSTEM_CONTEXT_PATH = path.join(PROJECT_ROOT, 'docs', 'ploinky-overview.md');
const WORKSPACE_ENV_FILENAME = '.env';

let cachedLlmSystemContext = null;

function loadLlmSystemContext() {
    if (cachedLlmSystemContext !== null) {
        return cachedLlmSystemContext;
    }

    try {
        const content = fs.readFileSync(LLM_SYSTEM_CONTEXT_PATH, 'utf8');
        cachedLlmSystemContext = content.trim();
    } catch (error) {
        cachedLlmSystemContext = '';
        debugLog('loadLlmSystemContext failed:', error?.message || error);
    }

    return cachedLlmSystemContext;
}

function formatValidApiKeyList(validKeys) {
    if (!Array.isArray(validKeys) || !validKeys.length) return '[]';
    return `[${validKeys.join(', ')}]`;
}

function composeUserCommand(command, options = []) {
    const parts = [command, ...options].filter(Boolean);
    return parts.join(' ').trim();
}

function buildLlmPrompt(rawInput) {
    const sections = [];
    const systemContext = loadLlmSystemContext();
    if (systemContext) {
        sections.push('System context for Ploinky CLI and runtime:\n' + systemContext);
    }

    sections.push(
        'You are a command guide for the Ploinky CLI.',
        'Given the user input, propose the best next step the user should execute inside the CLI. '
            + 'If more than one action is required, return a numbered list with each step on its own line.',
        'Each step should reference either a concrete Ploinky command (for example "add repo demo" or "enable agent basic/chatbot") '
            + 'or, if the user clearly wants a shell/system action, the exact system command they should run (for example "ls" or "npm install").',
        'If the input is unclear, respond with a short tip suggesting they run "help".',
        `User input: "${rawInput}"`
    );

    return sections.join('\n\n');
}

function extractLlmErrorDetails(error) {
    const attempts = Array.isArray(error?.attempts) ? error.attempts : [];
    const firstAttempt = attempts.length ? attempts[0] : null;
    const candidate = firstAttempt?.error || error;
    let code = null;

    if (candidate?.response?.status && Number.isInteger(candidate.response.status)) {
        code = Number(candidate.response.status);
    } else if (typeof candidate?.status === 'number') {
        code = Number(candidate.status);
    }

    let primaryMessage = '';
    if (typeof candidate?.message === 'string' && candidate.message.trim()) {
        primaryMessage = candidate.message;
    } else if (typeof candidate === 'string' && candidate.trim()) {
        primaryMessage = candidate;
    } else if (typeof error?.message === 'string' && error.message.trim()) {
        primaryMessage = error.message;
    }

    if (!code) {
        const codeMatch = primaryMessage.match(/\b(\d{3})\b/);
        if (codeMatch) {
            code = Number(codeMatch[1]);
        }
    }

    let message = primaryMessage || 'All model invocations failed.';
    if (message.includes('\n')) {
        message = message.split(/\r?\n/)[0].trim();
    }
    const MAX_LEN = 200;
    if (message.length > MAX_LEN) {
        message = `${message.slice(0, MAX_LEN)}...`;
    }

    return {
        code,
        message,
    };
}

async function suggestCommandWithLLM(commandLabel, options = []) {
    const rawInput = composeUserCommand(commandLabel, options) || commandLabel || '';
    if (!rawInput.trim()) {
        return { status: 'empty' };
    }

    const prompt = buildLlmPrompt(rawInput);
    try {
        const response = await defaultLLMInvokerStrategy({
            prompt,
            mode: 'fast',
            params: { temperature: 0.1 },
        });
        if (typeof response === 'string' && response.trim()) {
            return { status: 'ok', suggestion: response.trim() };
        }
        return { status: 'empty' };
    } catch (error) {
        debugLog('LLM suggestion failed:', error?.message || error);
        const details = extractLlmErrorDetails(error);
        return { status: 'error', error: details };
    }
}

function commandExistsSync(cmd) {
    if (!cmd) return false;
    const checker = process.platform === 'win32' ? 'where' : 'which';
    try {
        execSync(`${checker} ${cmd}`, { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

function resolveCdTarget(target) {
    const homeDir = os.homedir() || process.cwd();
    if (!target || target === '~') {
        return homeDir;
    }
    if (target.startsWith('~/')) {
        return path.join(homeDir, target.slice(2));
    }
    return path.isAbsolute(target) ? target : path.resolve(process.cwd(), target);
}

export async function handleSystemCommand(command, options = []) {
    if (!command) return false;

    if (command === 'cd') {
        const destination = resolveCdTarget(options[0]);
        try {
            process.chdir(destination);
        } catch (error) {
            console.error(`cd: ${error?.message || error}`);
        }
        return true;
    }

    if (!commandExistsSync(command)) {
        return false;
    }

    return await new Promise((resolve) => {
        const child = spawn(command, options, { stdio: 'inherit' });
        let settled = false;

        child.on('error', (error) => {
            settled = true;
            if (error?.code === 'ENOENT') {
                resolve(false);
            } else {
                console.error(error?.message || error);
                resolve(true);
            }
        });

        child.on('exit', () => {
            if (!settled) {
                resolve(true);
            }
        });
    });
}

export async function handleInvalidCommand(command, options = []) {
    const commandLabel = command || '';
    const validKeyNames = loadValidLlmApiKeys();
    const envPath = path.resolve(process.cwd(), WORKSPACE_ENV_FILENAME);
    const availableKeys = collectAvailableLlmKeys(envPath);
    const validKeysList = formatValidApiKeyList(validKeyNames);

    if (!availableKeys.length) {
        console.log(`Command '${commandLabel}' is not recognized as a Ploinky command or system executable. Type help to see options or configure .env file in current directory with one of these api keys : ${validKeysList}`);
        return;
    }

    console.log('Asking the LLM for guidance...');

    const llmResult = await suggestCommandWithLLM(commandLabel, options);
    if (llmResult?.status === 'ok' && llmResult.suggestion) {
        console.log('[LLM] Suggested next steps:');
        console.log(llmResult.suggestion);
        return;
    }

    if (llmResult?.status === 'error' && llmResult.error) {
        if (llmResult.error.code === 401) {
            console.log('LLM call failed: API key invalid.');
        } else {
            console.log(`LLM call failed: ${llmResult.error.message}`);
        }
        console.log('Run `help` to see all available Ploinky commands and their usage.');
        return;
    }

    console.log(`Command '${commandLabel}' is not recognized as a Ploinky command or system executable. Type help to see options or configure .env file in current directory with one of these api keys : ${validKeysList}`);
}
