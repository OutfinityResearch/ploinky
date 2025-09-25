import readline from 'node:readline';

// The low-level LLM client used for all model invocations.
import { callLLMWithModel, cancelRequests as cancelLLMRequests } from './LLMClient.mjs';
import { loadModelsConfiguration } from './models/providers/modelsConfigLoader.mjs';
import SkillRegistry from './skills/SkillRegistry.mjs';

const operatorRegistry = new Map();
let agentRegistry = null;
let defaultAgentName = null;
let agentRegistrySummary = null;
const modelsConfiguration = loadModelsConfiguration();

const PROVIDER_PRIORITY = ['openai', 'google', 'anthropic', 'openrouter', 'mistral', 'deepseek', 'huggingface'];

const CONTEXT_ROLE_ALIASES = new Map([
    ['system', 'system'],
    ['user', 'human'],
    ['human', 'human'],
    ['assistant', 'assistant'],
    ['tool', 'assistant'],
    ['function', 'assistant'],
    ['observation', 'assistant'],
]);

const TOOL_LIKE_ROLES = new Set(['tool', 'function', 'observation']);

let configurationDiagnosticsEmitted = false;

let agentLibraryInstance = null;

function limitPreview(value, maxLength = 400) {
    if (value === undefined || value === null) {
        return '';
    }
    let text;
    if (typeof value === 'string') {
        text = value;
    } else {
        try {
            text = JSON.stringify(value);
        } catch (error) {
            text = String(value);
        }
    }
    if (text.length <= maxLength) {
        return text;
    }
    return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function buildSuggestionBlock(title, lines) {
    if (!lines || !lines.length) {
        return null;
    }
    const body = lines.map(line => `- ${line}`).join('\n');
    return `${title}:\n${body}`;
}

function emitConfigurationDiagnostics() {
    if (configurationDiagnosticsEmitted) {
        return;
    }
    configurationDiagnosticsEmitted = true;

    for (const error of modelsConfiguration.issues.errors) {
        console.error(`LLMAgentClient: ${error}`);
    }
    for (const warning of modelsConfiguration.issues.warnings) {
        console.warn(`LLMAgentClient: ${warning}`);
    }
}

function normalizeAgentKind(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === 'chat' ? 'chat' : 'task';
}

function buildAgentDescription(agent) {
    const kind = normalizeAgentKind(agent?.kind);
    const isChat = kind === 'chat';
    const classification = isChat ? 'Expert Conversationalist' : 'Expert Task Executor';
    const role = agent?.role ? String(agent.role).trim() : '';
    const job = agent?.job ? String(agent.job).trim() : '';
    const expertise = agent?.expertise ? String(agent.expertise).trim() : '';
    const instructions = agent?.instructions ? String(agent.instructions).trim() : '';
    const details = [
        `Type: ${kind}`,
        `Classification: ${classification}`,
        role && `Role: ${role}`,
        job && `Job: ${job}`,
        expertise && `Expertise: ${expertise}`,
        instructions && `Guidance: ${instructions}`,
    ].filter(Boolean).join(' | ');
    return details;
}

function getOrderedModelNames() {
    if (Array.isArray(modelsConfiguration.orderedModels) && modelsConfiguration.orderedModels.length) {
        return modelsConfiguration.orderedModels.slice();
    }
    return Array.from(modelsConfiguration.models.keys());
}

function categorizeModelsByMode(modelNames) {
    const fast = [];
    const deep = [];
    for (const name of modelNames) {
        const descriptor = getModelDescriptor(name);
        if (!descriptor) {
            continue;
        }
        if (descriptor.mode === 'deep') {
            deep.push(name);
        } else {
            fast.push(name);
        }
    }
    return { fast, deep };
}

function normalizeTaskContext(_agent, context) {
    if (Array.isArray(context)) {
        const normalizedMessages = context
            .map((entry) => {
                if (!entry || typeof entry !== 'object') {
                    return null;
                }

                const rawRole = typeof entry.role === 'string' ? entry.role.trim().toLowerCase() : '';
                const role = CONTEXT_ROLE_ALIASES.get(rawRole);
                if (!role) {
                    return null;
                }

                let message = entry.message;
                if (typeof message === 'undefined' || message === null) {
                    message = entry.content;
                }
                if (typeof message === 'undefined' || message === null) {
                    message = entry.result;
                }
                if (typeof message === 'undefined' || message === null) {
                    message = entry.output;
                }
                if (typeof message === 'undefined' || message === null) {
                    return null;
                }

                if (typeof message === 'object') {
                    try {
                        message = JSON.stringify(message, null, 2);
                    } catch (error) {
                        message = String(message);
                    }
                }

                if (TOOL_LIKE_ROLES.has(rawRole)) {
                    const label = entry.name ? `${rawRole}:${entry.name}` : rawRole;
                    message = `[${label}] ${String(message)}`;
                }

                return {
                    role,
                    message: String(message),
                };
            })
            .filter(Boolean);

        if (normalizedMessages.length) {
            return {
                type: 'messages',
                messages: normalizedMessages,
            };
        }

        return {
            type: 'text',
            text: '',
        };
    }

    const trimmed = context ? String(context).trim() : '';
    return {
        type: 'text',
        text: trimmed,
    };
}

function getProviderConfig(providerKey) {
    return modelsConfiguration.providers.get(providerKey) || null;
}

function getModelDescriptor(modelName) {
    return modelsConfiguration.models.get(modelName) || null;
}

function createAgentModelRecord(providerConfig, modelDescriptor) {
    if (!providerConfig || !modelDescriptor) {
        return null;
    }

    const apiKeyEnv = modelDescriptor.apiKeyEnv || providerConfig.apiKeyEnv || null;
    const baseURL = modelDescriptor.baseURL || providerConfig.baseURL || null;
    const mode = modelDescriptor.mode || 'fast';

    return {
        name: modelDescriptor.name,
        providerKey: modelDescriptor.providerKey,
        apiKeyEnv,
        baseURL,
        mode,
    };
}

function cloneAgentModelRecord(record) {
    return {
        name: record.name,
        providerKey: record.providerKey,
        apiKeyEnv: record.apiKeyEnv,
        baseURL: record.baseURL,
        mode: record.mode || 'fast',
    };
}

function normalizeModePreference(value) {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return normalized === 'deep' || normalized === 'fast' ? normalized : null;
}

function normalizeInvocationRequest(input) {
    if (typeof input === 'string') {
        return { mode: normalizeModePreference(input), modelName: null };
    }

    if (!input || typeof input !== 'object') {
        return { mode: null, modelName: null };
    }

    const mode = normalizeModePreference(input.mode || input.preferredMode || input.modePreference);
    const modelRaw = input.modelName || input.model || input.preferredModel;
    const modelName = typeof modelRaw === 'string' && modelRaw.trim() ? modelRaw.trim() : null;

    return { mode, modelName };
}

function createAgentRuntime(record) {
    const runtime = { ...record };

    const recordsByMode = new Map();
    for (const modelRecord of runtime.availableModelRecords) {
        const mode = normalizeModePreference(modelRecord.mode) || 'fast';
        if (!recordsByMode.has(mode)) {
            recordsByMode.set(mode, []);
        }
        recordsByMode.get(mode).push(modelRecord);
    }

    const getRecordForMode = (mode) => {
        const normalized = normalizeModePreference(mode);
        if (normalized && recordsByMode.has(normalized)) {
            return recordsByMode.get(normalized)[0];
        }
        if (normalized === 'deep' && recordsByMode.has('fast')) {
            return recordsByMode.get('fast')[0];
        }
        if (normalized === 'fast' && recordsByMode.has('deep')) {
            return recordsByMode.get('deep')[0];
        }
        if (runtime.model) {
            const configured = runtime.availableModelRecords.find(modelRecord => modelRecord.name === runtime.model);
            if (configured) {
                return configured;
            }
        }
        return runtime.availableModelRecords[0] || null;
    };

    runtime.supportedModes = Array.from(recordsByMode.keys());

    runtime.supportsMode = function supportsMode(mode) {
        const normalized = normalizeModePreference(mode);
        return normalized ? recordsByMode.has(normalized) : false;
    };

    const findRecordByName = (modelName) => {
        if (!modelName) {
            return null;
        }
        return runtime.availableModelRecords.find(modelRecord => modelRecord.name === modelName) || null;
    };

    const resolveRecord = (request) => {
        const recordByName = findRecordByName(request.modelName);
        if (recordByName) {
            return recordByName;
        }
        return getRecordForMode(request.mode);
    };

    runtime.selectModelRecord = function selectModelRecord(request) {
        const normalizedRequest = normalizeInvocationRequest(request);
        return resolveRecord(normalizedRequest);
    };

    runtime.getInvocationConfig = function getInvocationConfig(request) {
        const normalizedRequest = normalizeInvocationRequest(request);
        const record = resolveRecord(normalizedRequest);
        if (!record) {
            throw new Error(`Agent "${runtime.name}" has no available models.`);
        }

        const providerKey = record.providerKey || runtime.providerKey || null;
        const apiKeyEnv = record.apiKeyEnv || runtime.apiKeyEnv || null;
        const baseURL = record.baseURL
            || runtime.baseURL
            || (providerKey ? getProviderConfig(providerKey)?.baseURL : null);

        return {
            record,
            providerKey,
            apiKeyEnv,
            baseURL,
        };
    };

    return runtime;
}

function hasAvailableKey(record) {
    if (!record) {
        return false;
    }
    if (!record.apiKeyEnv) {
        return true;
    }
    if ((record.providerKey || '').toLowerCase() === 'huggingface') {
        return true;
    }
    return Boolean(process.env[record.apiKeyEnv]);
}

function buildModelRecordByName(modelName) {
    const descriptor = getModelDescriptor(modelName);
    if (!descriptor) {
        console.warn(`LLMAgentClient: models.json does not define model "${modelName}".`);
        return null;
    }
    const providerConfig = getProviderConfig(descriptor.providerKey);
    if (!providerConfig) {
        console.warn(`LLMAgentClient: Model "${modelName}" references unknown provider "${descriptor.providerKey}".`);
        return null;
    }
    return createAgentModelRecord(providerConfig, descriptor);
}

function dedupeRecordsByName(records) {
    const seen = new Set();
    const result = [];
    for (const record of records) {
        if (!record || !record.name) {
            continue;
        }
        if (seen.has(record.name)) {
            continue;
        }
        seen.add(record.name);
        result.push(record);
    }
    return result;
}

function commitAgentRecord({
    name,
    role = '',
    job = '',
    expertise = '',
    instructions = '',
    kind = 'task',
    configuredRecords = [],
    fastModelNames = [],
    deepModelNames = [],
    origin = 'config',
}) {
    if (!name || typeof name !== 'string') {
        throw new Error('commitAgentRecord requires a non-empty name.');
    }

    if (!agentRegistry) {
        agentRegistry = new Map();
    }

    const normalizedKind = kind === 'task' ? 'task' : 'chat';
    const summaryState = ensureAgentSummary();
    removeAgentFromSummary(name);

    const orderedRecords = dedupeRecordsByName(configuredRecords || []);
    const primaryProviderKey = orderedRecords[0]?.providerKey || null;

    if (!orderedRecords.length) {
        summaryState.inactive.push({
            name,
            kind: normalizedKind,
            role,
            job,
            expertise,
            instructions,
            providerKey: primaryProviderKey,
            reason: 'no models configured',
            origin,
        });
        agentRegistry.delete(name.toLowerCase());
        console.warn(`LLMAgentClient: Agent "${name}" could not be registered because no models were supplied.`);
        return { status: 'inactive', reason: 'no models configured' };
    }

    const availableRecords = orderedRecords.filter(hasAvailableKey);
    if (!availableRecords.length) {
        summaryState.inactive.push({
            name,
            kind: normalizedKind,
            role,
            job,
            expertise,
            instructions,
            providerKey: primaryProviderKey,
            reason: 'missing API keys',
            origin,
        });
        agentRegistry.delete(name.toLowerCase());
        console.warn(`LLMAgentClient: Agent "${name}" has no models with available API keys.`);
        return { status: 'inactive', reason: 'missing API keys' };
    }

    const defaultRecord = availableRecords[0];
    const fastSet = new Set((fastModelNames || []).map(value => value?.toString().trim()).filter(Boolean));
    const deepSet = new Set((deepModelNames || []).map(value => value?.toString().trim()).filter(Boolean));

    const fastRecords = availableRecords.filter(record => fastSet.has(record.name) || (fastSet.size === 0 && record.mode === 'fast'));
    const deepRecords = availableRecords.filter(record => deepSet.has(record.name) || (deepSet.size === 0 && record.mode === 'deep'));

    const agentRecord = {
        name,
        canonicalName: name,
        role,
        job,
        expertise,
        instructions,
        kind: normalizedKind,
        origin,
        model: defaultRecord.name,
        modelMode: defaultRecord.mode,
        apiKeyEnv: defaultRecord.apiKeyEnv || null,
        providerKey: defaultRecord.providerKey || null,
        baseURL: defaultRecord.baseURL || null,
        availableModels: availableRecords.map(record => record.name),
        availableModelRecords: availableRecords.map(cloneAgentModelRecord),
        configuredModels: orderedRecords.map(record => record.name),
        fastModels: fastRecords.map(record => record.name),
        deepModels: deepRecords.map(record => record.name),
        supportedModes: Array.from(new Set(availableRecords.map(record => record.mode).filter(Boolean))),
    };

    const runtimeAgent = createAgentRuntime(agentRecord);

    agentRegistry.set(name.toLowerCase(), runtimeAgent);

    summaryState.active.push({
        name,
        kind: normalizedKind,
        role,
        job,
        expertise,
        instructions,
        origin,
        providerKey: runtimeAgent.providerKey,
        defaultModel: runtimeAgent.model,
        availableModels: runtimeAgent.availableModels.slice(),
        fastModels: runtimeAgent.fastModels.slice(),
        deepModels: runtimeAgent.deepModels.slice(),
    });

    return { status: 'active', agent: runtimeAgent };
}

function normalizeModelNameList(list) {
    if (!Array.isArray(list)) {
        return [];
    }
    return list
        .map(value => (typeof value === 'string' ? value.trim() : ''))
        .filter(Boolean);
}

function registerLLMAgent(options = {}) {
    return getAgentLibrary().registerLLMAgent(options);
}

function registerDefaultLLMAgent(options = {}) {
    return getAgentLibrary().registerDefaultLLMAgent(options);
}

function autoRegisterProviders() {
    for (const providerConfig of modelsConfiguration.providers.values()) {
        const providerKey = providerConfig.providerKey;
        const descriptors = modelsConfiguration.providerModels.get(providerKey) || [];

        if (!descriptors.length) {
            console.warn(`LLMAgentClient: No models configured in models.json for provider "${providerKey}".`);
            commitAgentRecord({
                name: providerKey,
                role: `${providerKey} agent`,
                job: `Handle requests using ${providerKey} models.`,
                expertise: 'General',
                instructions: '',
                kind: 'task',
                configuredRecords: [],
                origin: 'provider',
            });
            continue;
        }

        const orderedNames = Array.isArray(modelsConfiguration.orderedModels)
            ? modelsConfiguration.orderedModels.filter(name => descriptors.some(descriptor => descriptor.name === name))
            : descriptors.map(descriptor => descriptor.name);

        const configuredRecords = [];
        for (const modelName of orderedNames) {
            const record = buildModelRecordByName(modelName);
            if (record && record.providerKey === providerKey) {
                configuredRecords.push(record);
            }
        }

        const fastNames = descriptors.filter(descriptor => descriptor.mode === 'fast').map(descriptor => descriptor.name);
        const deepNames = descriptors.filter(descriptor => descriptor.mode === 'deep').map(descriptor => descriptor.name);

        commitAgentRecord({
            name: providerKey,
            role: providerConfig.extra?.role || `${providerKey} agent`,
            job: providerConfig.extra?.job || `Handle requests routed to ${providerKey}.`,
            expertise: providerConfig.extra?.expertise || 'Provider specialist',
            instructions: providerConfig.extra?.instructions || '',
            kind: providerConfig.extra?.kind || providerConfig.extra?.type || 'task',
            configuredRecords,
            fastModelNames: fastNames,
            deepModelNames: deepNames,
            origin: 'provider',
        });
    }
}

function ensureAgentSummary() {
    if (!agentRegistrySummary) {
        agentRegistrySummary = { active: [], inactive: [] };
    }
    return agentRegistrySummary;
}

function removeAgentFromSummary(name) {
    if (!agentRegistrySummary) {
        return;
    }
    const filter = (entries) => entries.filter(entry => entry.name !== name);
    agentRegistrySummary.active = filter(agentRegistrySummary.active);
    agentRegistrySummary.inactive = filter(agentRegistrySummary.inactive);
}

function ensureAgentRegistry() {
    if (agentRegistry) {
        return agentRegistry;
    }

    emitConfigurationDiagnostics();

    agentRegistry = new Map();
    agentRegistrySummary = { active: [], inactive: [] };

    autoRegisterProviders();
    registerDefaultLLMAgent({});

    determineDefaultAgent();
    return agentRegistry;
}

function determineDefaultAgent() {
    defaultAgentName = null;
    if (!agentRegistry || agentRegistry.size === 0) {
        return;
    }

    if (agentRegistry.has('default')) {
        defaultAgentName = 'default';
        return;
    }

    for (const name of PROVIDER_PRIORITY) {
        if (agentRegistry.has(name)) {
            defaultAgentName = name;
            return;
        }
    }

    const firstAgent = agentRegistry.keys().next();
    if (!firstAgent.done) {
        defaultAgentName = firstAgent.value;
    }
}

function getAgent(agentName) {
    const registry = ensureAgentRegistry();
    if (!registry || registry.size === 0) {
        throw new Error('No agents are configured. Set provider API keys in the environment.');
    }

    if (agentName) {
        const normalized = agentName.toLowerCase();
        if (registry.has(normalized)) {
            return registry.get(normalized);
        }
    }

    if (defaultAgentName && registry.has(defaultAgentName)) {
        return registry.get(defaultAgentName);
    }

    throw new Error('Default agent is not configured.');
}

function registerOperator(operatorName, description, executionCallback) {
    if (!operatorName || typeof operatorName !== 'string') {
        throw new Error('operatorName must be a non-empty string.');
    }
    if (!/^[a-z][a-zA-Z0-9-]*$/.test(operatorName)) {
        throw new Error('operatorName must start with a lowercase letter and can only contain alphanumeric characters and dashes.');
    }
    if (!description || typeof description !== 'string') {
        throw new Error('description must be a non-empty string.');
    }
    if (typeof executionCallback !== 'function') {
        throw new Error('executionCallback must be a function.');
    }
    if (operatorRegistry.has(operatorName)) {
        throw new Error(`Operator "${operatorName}" is already registered.`);
    }

    operatorRegistry.set(operatorName, {
        name: operatorName,
        description,
        execute: executionCallback,
    });
}

async function callOperator(operatorName, params = {}) {
    if (!operatorRegistry.has(operatorName)) {
        throw new Error(`Operator "${operatorName}" is not registered.`);
    }
    const operator = operatorRegistry.get(operatorName);
    return operator.execute(params || {});
}

async function doTask(agentName, context, description, outputSchema = null, mode = 'fast', retries = 3) {
    return getAgentLibrary().doTask(agentName, context, description, outputSchema, mode, retries);
}

async function doTaskWithReview(agentName, context, description, outputSchema = null, mode = 'deep', maxIterations = 5) {
    return getAgentLibrary().doTaskWithReview(agentName, context, description, outputSchema, mode, maxIterations);
}

async function doTaskWithHumanReview(agentName, context, description, outputSchema = null, mode = 'deep') {
    return getAgentLibrary().doTaskWithHumanReview(agentName, context, description, outputSchema, mode);
}

async function brainstorm(agentName, question, generationCount, returnCount, reviewCriteria = null) {
    return getAgentLibrary().brainstormQuestion(agentName, question, generationCount, returnCount, reviewCriteria);
}

async function chooseOperator(agentName, currentTaskDescription, mode = 'fast', threshold = 0.5) {
    if (!operatorRegistry.size) {
        return { suitableOperators: [] };
    }

    const agent = getAgent(agentName);
    const normalizedMode = normalizeTaskMode(mode, null, agent, 'fast');

    const operatorList = Array.from(operatorRegistry.values()).map(op => ({
        operatorName: op.name,
        description: op.description,
    }));

    const contextInfo = normalizeTaskContext(agent, JSON.stringify({ operators: operatorList }, null, 2));
    const history = buildSystemHistory(agent, {
        instruction: normalizedMode === 'deep'
            ? 'Review the operator catalog and select the functions that can help with the task.'
            : 'Quickly select operators that can solve the task.',
        context: contextInfo,
        description: `Task description: ${currentTaskDescription}\nOnly return JSON: {"suitableOperators":[{"operatorName": string, "confidence": number}]}. Discard operators below confidence ${threshold}.`,
        mode: normalizedMode,
    });

    const raw = await invokeAgent(agent, history, { mode: normalizedMode });
    const parsed = safeJsonParse(raw);

    if (parsed?.suitableOperators) {
        const filtered = parsed.suitableOperators.filter(op => typeof op.confidence === 'number' && op.confidence >= threshold);
        return { suitableOperators: filtered };
    }

    // Second-chance parsing for raw JSON embedded in a string
    if (typeof raw === 'string') {
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const robustParsed = safeJsonParse(jsonMatch[0]);
            if (robustParsed?.suitableOperators) {
                const filtered = robustParsed.suitableOperators.filter(op => typeof op.confidence === 'number' && op.confidence >= threshold);
                return { suitableOperators: filtered };
            }
        }
    }

    throw new Error('Operator selection response is invalid.');
}

function cancelTasks() {
    getAgentLibrary().cancelTasks();
}

function normalizeTaskMode(mode, outputSchema, agent, fallback = 'fast') {
    const normalized = (mode || '').toLowerCase();
    const agentModes = Array.isArray(agent?.supportedModes) ? agent.supportedModes.slice() : [];
    if (!agentModes.length && agent?.modelMode) {
        agentModes.push(agent.modelMode);
    }

    const supportsMode = (candidate) => {
        if (!candidate) {
            return false;
        }
        if (typeof agent?.supportsMode === 'function') {
            return agent.supportsMode(candidate);
        }
        return agentModes.includes(candidate);
    };

    if (normalized === 'deep' || normalized === 'fast') {
        return supportsMode(normalized) ? normalized : (supportsMode(fallback) ? fallback : (agentModes[0] || fallback));
    }

    if (normalized === 'any' || normalized === '') {
        if (outputSchema && supportsMode('deep')) {
            return 'deep';
        }
        if (supportsMode('fast')) {
            return 'fast';
        }
        if (supportsMode('deep')) {
            return 'deep';
        }
    }

    if (supportsMode(fallback)) {
        return fallback;
    }

    return agentModes[0] || fallback;
}

async function executeFastTask(agent, context, description, outputSchema) {
    const contextInfo = normalizeTaskContext(agent, context);
    const history = buildSystemHistory(agent, {
        instruction: 'Complete the task in a single response.',
        context: contextInfo,
        description,
        outputSchema,
        mode: 'fast',
    });
    const raw = await invokeAgent(agent, history, { mode: 'fast' });
    return buildTaskResult(raw, outputSchema);
}

async function executeDeepTask(agent, context, description, outputSchema) {
    const contextInfo = normalizeTaskContext(agent, context);
    const plan = await generatePlan(agent, context, description);

    const extraParts = [`Plan:\n${JSON.stringify(plan)}`];

    const executionHistory = buildSystemHistory(agent, {
        instruction: 'Follow the plan and produce a final answer. Iterate internally as needed.',
        context: contextInfo,
        extraContextParts: extraParts,
        description,
        outputSchema,
        mode: 'deep',
    });
    const raw = await invokeAgent(agent, executionHistory, { mode: 'deep' });
    return buildTaskResult(raw, outputSchema);
}

async function executeIteration(agent, context, description, outputSchema, iteration, feedback, plan, mode, options = {}) {
    const contextInfo = normalizeTaskContext(agent, context);
    const extraParts = [`Task:\n${description}`, `Iteration: ${iteration}`];
    if (plan) {
        extraParts.push(`Plan:\n${JSON.stringify(plan)}`);
    }
    if (feedback) {
        extraParts.push(`Prior feedback:\n${feedback}`);
    }
    const hints = Array.isArray(options.hints) ? options.hints : [];
    if (hints.length) {
        const block = buildSuggestionBlock('Retrieved guidance', hints.map((hint, index) => `${index + 1}. ${limitPreview(hint, 200)}`));
        if (block) {
            extraParts.push(block);
        }
    }

    const history = buildSystemHistory(agent, {
        instruction: 'Work step-by-step, applying the plan and feedback to improve the solution.',
        context: contextInfo,
        extraContextParts: extraParts,
        description: 'Return only the updated solution, no commentary unless necessary.',
        outputSchema,
        mode,
    });
    const raw = await invokeAgent(agent, history, { mode });
    const parsed = buildTaskResult(raw, outputSchema);
    return { raw, parsed };
}

async function reviewCandidate(agent, context, description, candidate, outputSchema, iteration, mode) {
    const contextInfo = normalizeTaskContext(agent, context || 'N/A');
    const reviewHistory = buildSystemHistory(agent, {
        instruction: 'Review the candidate solution for quality, correctness, and alignment with the task.',
        context: contextInfo,
        extraContextParts: [
            `Task:\n${description}`,
            `Iteration: ${iteration}`,
            `Candidate:\n${candidate}`,
        ],
        description: 'Return JSON: {"approved": boolean, "feedback": string}.',
        outputSchema: null,
        mode,
    });

    const reviewRaw = await invokeAgent(agent, reviewHistory, { mode });
    const review = safeJsonParse(reviewRaw);

    if (typeof review?.approved !== 'boolean') {
        return { approved: false, feedback: 'Review response invalid; improve the solution with more rigor.' };
    }

    return { approved: review.approved, feedback: review.feedback };
}

async function generatePlan(agent, context, description, options = {}) {
    const contextInfo = normalizeTaskContext(agent, context);
    const hints = Array.isArray(options.hints) ? options.hints : [];
    const extraParts = [];
    if (hints.length) {
        const lines = hints.slice(0, 3).map((hint, index) => {
            const steps = Array.isArray(hint?.steps) ? hint.steps.slice(0, 3).map((step, stepIndex) => `${stepIndex + 1}. ${typeof step === 'string' ? step : JSON.stringify(step)}`).join(' | ') : limitPreview(hint, 200);
            return `Plan #${index + 1}: ${steps}`;
        });
        const block = buildSuggestionBlock('Candidate plans for reuse', lines);
        if (block) {
            extraParts.push(block);
        }
    }

    const history = buildSystemHistory(agent, {
        instruction: 'Create a concise step-by-step plan for the task before solving it.',
        context: contextInfo,
        description,
        outputSchema: { type: 'object', properties: { steps: { type: 'array' } }, required: ['steps'] },
        mode: 'deep',
        extraContextParts: extraParts,
    });

    const raw = await invokeAgent(agent, history, { mode: 'deep' });
    const parsed = safeJsonParse(raw);

    if (parsed?.steps && Array.isArray(parsed.steps)) {
        return parsed;
    }

    return { steps: Array.from(String(raw).split('\n').filter(Boolean)).map((line, index) => ({ id: index + 1, action: line.trim() })) };
}

function buildSystemHistory(agent, { instruction, context, description, outputSchema, extraContextParts = [] }) {
    const history = [];
    const agentLabel = agent.canonicalName || agent.name;
    const agentDescription = buildAgentDescription(agent);
    history.push({
        role: 'system',
        message: `You are the ${agentLabel} agent. ${agentDescription} ${instruction}`.trim(),
    });

    const normalizedContext = context && typeof context === 'object' && (context.type === 'text' || context.type === 'messages')
        ? context
        : normalizeTaskContext(agent, context);

    if (normalizedContext.type === 'messages') {
        for (const entry of normalizedContext.messages) {
            history.push({ role: entry.role, message: entry.message });
        }
    }

    const parts = [];
    if (normalizedContext.type === 'text' && normalizedContext.text) {
        parts.push(`Context:\n${normalizedContext.text}`);
    }

    if (Array.isArray(extraContextParts) && extraContextParts.length) {
        for (const part of extraContextParts) {
            if (part) {
                parts.push(part);
            }
        }
    }

    if (description) {
        parts.push(`Task:\n${description}`);
    }
    if (outputSchema) {
        parts.push(`Desired output schema (JSON Schema):\n${JSON.stringify(outputSchema, null, 2)}`);
        parts.push('Respond with JSON that strictly matches the schema.');
    }

    if (parts.length) {
        history.push({
            role: 'human',
            message: parts.join('\n\n'),
        });
    }

    return history;
}

function buildEvaluationContext(question, generationResults, reviewCriteria) {
    return JSON.stringify({
        question,
        reviewCriteria: reviewCriteria || 'Use balanced judgement for quality and relevance.',
        alternatives: generationResults.map(entry => ({ index: entry.index, agent: entry.agent, content: entry.content })),
    }, null, 2);
}

async function invokeAgent(agent, history, options = {}) {
    const request = normalizeInvocationRequest(options);

    const {
        record,
        providerKey,
        apiKeyEnv,
        baseURL,
    } = typeof agent.getInvocationConfig === 'function'
            ? agent.getInvocationConfig(request)
            : buildLegacyInvocationConfig(agent);

    if (!record?.name) {
        throw new Error(`Agent "${agent.name}" does not have a usable model.`);
    }

    const effectiveProviderKey = providerKey || record.providerKey;
    const effectiveBaseURL = baseURL || getProviderConfig(effectiveProviderKey)?.baseURL;
    if (!effectiveBaseURL) {
        throw new Error(`Missing base URL for agent "${agent.name}" (${effectiveProviderKey || 'unknown provider'}).`);
    }

    const apiKeyName = apiKeyEnv || record.apiKeyEnv || agent.apiKeyEnv || null;
    const apiKey = apiKeyName ? process.env[apiKeyName] : null;
    if (!apiKey && effectiveProviderKey !== 'huggingface') {
        throw new Error(`Missing API key for agent "${agent.name}" (${apiKeyName || 'unspecified env var'}).`);
    }

    return callLLMWithModel(record.name, [...history], null, {
        apiKey,
        baseURL: effectiveBaseURL,
        providerKey: effectiveProviderKey,
    });
}

function buildLegacyInvocationConfig(agent) {
    const providerKey = agent.providerKey || null;
    const apiKeyEnv = agent.apiKeyEnv || null;
    const baseURL = agent.baseURL || (providerKey ? getProviderConfig(providerKey)?.baseURL : null);
    return {
        record: {
            name: agent.model,
            providerKey,
            apiKeyEnv,
            baseURL,
            mode: agent.modelMode || 'fast',
        },
        providerKey,
        apiKeyEnv,
        baseURL,
    };
}

function buildTaskResult(raw, outputSchema) {
    if (!outputSchema) {
        return { result: raw };
    }

    const parsed = safeJsonParse(raw);
    if (!parsed || typeof parsed !== 'object') {
        // throw new Error('Agent response could not be parsed as JSON to satisfy the output schema.');
        return { result: raw };
    }
    return parsed;
}

function safeJsonParse(value) {
    if (typeof value !== 'string') {
        return value;
    }
    try {
        return JSON.parse(value);
    } catch (error) {
        return null;
    }
}

function cloneAgentSummary(summary) {
    return {
        name: summary.name,
        kind: summary.kind,
        role: summary.role,
        job: summary.job,
        expertise: summary.expertise,
        instructions: summary.instructions,
        origin: summary.origin,
        providerKey: summary.providerKey || null,
        defaultModel: summary.defaultModel,
        availableModels: Array.isArray(summary.availableModels) ? summary.availableModels.slice() : [],
        fastModels: Array.isArray(summary.fastModels) ? summary.fastModels.slice() : [],
        deepModels: Array.isArray(summary.deepModels) ? summary.deepModels.slice() : [],
        reason: summary.reason,
    };
}

function listAgents() {
    ensureAgentRegistry();

    const summaries = agentRegistrySummary || { active: [], inactive: [] };

    return {
        defaultAgent: defaultAgentName,
        agents: {
            active: summaries.active.map(cloneAgentSummary),
            inactive: summaries.inactive.map(cloneAgentSummary),
        },
    };
}

function resetForTests() {
    agentRegistry = null;
    defaultAgentName = null;
    agentRegistrySummary = null;
    configurationDiagnosticsEmitted = false;
    agentLibraryInstance = null;
}

class Agent {
    constructor(options = {}) {
        const providedRegistry = options?.skillRegistry;
        if (providedRegistry && typeof providedRegistry.registerSkill === 'function' && typeof providedRegistry.rankSkill === 'function') {
            this.skillRegistry = providedRegistry;
        } else {
            this.skillRegistry = new SkillRegistry(options?.skillRegistryOptions);
        }
    }

    async readUserPrompt(query) {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        return new Promise(resolve => {
            rl.question(query, answer => {
                rl.close();
                resolve(answer);
            });
        });
    }

    registerSkill(skillObj) {
        return this.skillRegistry.registerSkill(skillObj);
    }

    async rankSkill(taskDescription, options = {}) {
        const matches = this.skillRegistry.rankSkill(taskDescription, options);

        if (!Array.isArray(matches) || matches.length === 0) {
            throw new Error('No skills matched the provided task description.');
        }

        if (matches.length === 1) {
            return matches[0];
        }

        const normalizeName = (value) => typeof value === 'string' ? value.trim().toLowerCase() : '';

        const candidates = matches.map(name => {
            const skill = this.getSkill(name);
            if (!skill) {
                return null;
            }
            const canonical = normalizeName(skill.name || name);
            return {
                canonical,
                name: skill.name || name,
                spec: skill,
            };
        }).filter(Boolean);

        if (!candidates.length) {
            throw new Error('Unable to load candidate skill specifications for selection.');
        }

        let selectorAgent;
        try {
            selectorAgent = getAgent(options?.agentName);
        } catch (error) {
            throw new Error(`Unable to obtain language model for skill selection: ${error.message}`);
        }

        const selectionMode = normalizeTaskMode(options?.mode || 'fast', null, selectorAgent, 'fast');

        const candidateSummaries = candidates.map(entry => ({
            name: entry.name,
            description: entry.spec.description,
            what: entry.spec.what,
            why: entry.spec.why,
            args: entry.spec.args,
            requiredArgs: entry.spec.requiredArgs,
        }));

        const contextPayload = {
            taskDescription,
            candidates: candidateSummaries,
        };

        const history = buildSystemHistory(selectorAgent, {
            instruction: 'Review the candidate skills and choose the single best match for the task.',
            context: JSON.stringify(contextPayload, null, 2),
            description: 'Return JSON like {"skill": "<skill name>"}. If no skills are suitable, return {"skill": null}.',
            mode: selectionMode,
        });

        const raw = await invokeAgent(selectorAgent, history, { mode: selectionMode });

        const candidateMap = new Map();
        for (const candidate of candidates) {
            candidateMap.set(candidate.canonical, candidate.name);
        }

        const parseSelection = (value) => {
            const parsed = safeJsonParse(typeof value === 'string' ? value : '');
            if (parsed && typeof parsed === 'object' && Object.prototype.hasOwnProperty.call(parsed, 'skill')) {
                return parsed.skill;
            }
            return null;
        };

        let selected = parseSelection(raw);

        if (selected === null || selected === undefined) {
            if (typeof raw === 'string') {
                const trimmed = raw.trim();
                const normalized = normalizeName(trimmed);
                if (candidateMap.has(normalized)) {
                    selected = candidateMap.get(normalized);
                }
            }
        }

        if (selected === null || normalizeName(selected) === 'none' || normalizeName(selected) === 'no skill') {
            throw new Error('No suitable skill was selected for the task description.');
        }

        if (typeof selected !== 'string' || !selected.trim()) {
            throw new Error('Skill selection response was invalid.');
        }

        const normalizedSelected = normalizeName(selected);
        if (!candidateMap.has(normalizedSelected)) {
            throw new Error(`Selected skill "${selected}" was not among the matched candidates.`);
        }

        return candidateMap.get(normalizedSelected);
    }

    async useSkill(skillName, providedArgs = {}) {
        const skill = this.getSkill(skillName);
        if (!skill) {
            throw new Error(`Skill "${skillName}" is not registered.`);
        }

        const action = this.getSkillAction(skillName);
        if (typeof action !== 'function') {
            throw new Error(`No executable action found for skill "${skillName}".`);
        }

        const normalizedArgs = providedArgs && typeof providedArgs === 'object' ? { ...providedArgs } : {};
        const requiredArgs = Array.isArray(skill.requiredArgs) ? skill.requiredArgs.filter(name => typeof name === 'string' && name) : [];
        const argumentDefinitions = Array.isArray(skill.args) ? skill.args.filter(entry => entry && typeof entry.name === 'string' && entry.name) : [];

        const missingRequiredArgs = () => requiredArgs.filter((name) => !Object.prototype.hasOwnProperty.call(normalizedArgs, name) || normalizedArgs[name] === undefined || normalizedArgs[name] === null);

        while (missingRequiredArgs().length > 0) {
            const missing = missingRequiredArgs();

            const descriptors = missing.map((name) => {
                const definition = argumentDefinitions.find(arg => arg.name === name);
                return definition?.description ? `${name} (${definition.description})` : name;
            });

            const userInput = await this.readUserPrompt(`Missing required arguments: ${descriptors.join(', ')}. Provide values (or type 'cancel' to abort): `);
            const trimmedInput = typeof userInput === 'string' ? userInput.trim() : '';

            if (!trimmedInput) {
                continue;
            }

            if (trimmedInput.toLowerCase() === 'cancel') {
                throw new Error('Skill execution cancelled by user.');
            }

            let agent;
            try {
                agent = getAgent();
            } catch (error) {
                throw new Error(`Unable to obtain language model for parsing arguments: ${error.message}`);
            }

            const systemPrompt = 'You extract structured JSON arguments for tool execution. Respond with JSON only, no commentary.';
            const humanPromptSections = [
                `Skill name: ${skill.name}`,
                `Skill description: ${skill.description}`,
            ];

            if (argumentDefinitions.length) {
                humanPromptSections.push(`Argument definitions: ${JSON.stringify(argumentDefinitions, null, 2)}`);
            }

            humanPromptSections.push(`Missing argument names: ${JSON.stringify(missing)}`);
            humanPromptSections.push(`User response: ${trimmedInput}`);
            humanPromptSections.push('Return a JSON object containing values for the missing argument names. Omit any extraneous fields.');

            let rawExtraction;
            try {
                rawExtraction = await invokeAgent(agent, [
                    { role: 'system', message: systemPrompt },
                    { role: 'human', message: humanPromptSections.join('\n\n') },
                ], { mode: 'fast' });
            } catch (error) {
                throw new Error(`Failed to parse arguments with the language model: ${error.message}`);
            }

            const parsedExtraction = safeJsonParse(typeof rawExtraction === 'string' ? rawExtraction.trim() : rawExtraction);

            if (!parsedExtraction || typeof parsedExtraction !== 'object') {
                console.warn('The language model did not return valid JSON. Please try providing the details again.');
                continue;
            }

            for (const [name, value] of Object.entries(parsedExtraction)) {
                if (value !== undefined && value !== null) {
                    normalizedArgs[name] = value;
                }
            }
        }

        const orderedNames = argumentDefinitions.length
            ? argumentDefinitions.map(def => def.name)
            : requiredArgs.slice();

        if (!orderedNames.length) {
            return action({ ...normalizedArgs });
        }

        const positionalValues = orderedNames.map(name => normalizedArgs[name]);

        if (action.length > 1) {
            return action(...positionalValues);
        }

        if (orderedNames.length === 1) {
            return action(positionalValues[0]);
        }

        return action({ ...normalizedArgs });
    }

    getSkill(skillName) {
        return this.skillRegistry.getSkill(skillName);
    }

    getSkillAction(skillName) {
        return this.skillRegistry.getSkillAction(skillName);
    }

    clearSkills() {
        this.skillRegistry.clear();
    }

    registerLLMAgent(options = {}) {
        const {
            name,
            role = '',
            job = '',
            expertise = '',
            instructions = '',
            fastModels = [],
            deepModels = [],
            kind = 'task',
            modelOrder = [],
            origin = 'registerLLMAgent',
        } = options;

        if (!name || typeof name !== 'string') {
            throw new Error('registerLLMAgent requires a non-empty "name".');
        }

        let normalizedFast = normalizeModelNameList(fastModels);
        let normalizedDeep = normalizeModelNameList(deepModels);

        if (!normalizedFast.length && !normalizedDeep.length) {
            const fallbackNames = getOrderedModelNames();
            const categorized = categorizeModelsByMode(fallbackNames);
            normalizedFast = categorized.fast;
            normalizedDeep = categorized.deep;
        }

        const explicitOrder = normalizeModelNameList(modelOrder);
        const combinedOrder = [];
        const seen = new Set();

        const pushInOrder = (list) => {
            for (const value of list) {
                if (!seen.has(value)) {
                    seen.add(value);
                    combinedOrder.push(value);
                }
            }
        };

        if (explicitOrder.length) {
            pushInOrder(explicitOrder);
        }
        pushInOrder(normalizedFast);
        pushInOrder(normalizedDeep);

        const configuredRecords = [];
        for (const modelName of combinedOrder) {
            const record = buildModelRecordByName(modelName);
            if (record) {
                configuredRecords.push(record);
            }
        }

        return commitAgentRecord({
            name,
            role,
            job,
            expertise,
            instructions,
            kind,
            configuredRecords,
            fastModelNames: normalizedFast,
            deepModelNames: normalizedDeep,
            origin,
        });
    }

    registerDefaultLLMAgent(options = {}) {
        const {
            role = 'General-purpose assistant',
            job = 'Plan and execute tasks accurately and reliably.',
            expertise = 'Generalist',
            instructions = 'Select the most capable model for each request.',
            kind = 'task',
        } = options;

        const orderedNames = Array.isArray(modelsConfiguration.orderedModels)
            ? modelsConfiguration.orderedModels.slice()
            : Array.from(modelsConfiguration.models.keys());

        const configuredRecords = [];
        const fastNames = [];
        const deepNames = [];

        for (const modelName of orderedNames) {
            const record = buildModelRecordByName(modelName);
            if (!record) {
                continue;
            }
            configuredRecords.push(record);
            if (record.mode === 'fast') {
                fastNames.push(record.name);
            }
            if (record.mode === 'deep') {
                deepNames.push(record.name);
            }
        }

        commitAgentRecord({
            name: 'default',
            role,
            job,
            expertise,
            instructions,
            kind,
            configuredRecords,
            fastModelNames: fastNames,
            deepModelNames: deepNames,
            origin: 'default',
        });
    }

    async doTask(agentName, context, description, outputSchema = null, mode = 'fast', retries = 3) {
        const agent = getAgent(agentName);
        const normalizedMode = normalizeTaskMode(mode, outputSchema, agent);

        let attempt = 0;
        let lastError = null;

        while (attempt < Math.max(retries, 1)) {
            try {
                if (normalizedMode === 'deep') {
                    return await executeDeepTask(agent, context, description, outputSchema);
                }
                return await executeFastTask(agent, context, description, outputSchema);
            } catch (error) {
                lastError = error;
                attempt += 1;
            }
        }

        throw new Error(`Task failed after ${retries} retries: ${lastError?.message || 'unknown error'}`);
    }

    async doTaskWithReview(agentName, context, description, outputSchema = null, mode = 'deep', maxIterations = 5) {
        const agent = getAgent(agentName);
        const normalizedMode = normalizeTaskMode(mode, outputSchema, agent, 'deep');

        const plan = normalizedMode === 'deep' ? await generatePlan(agent, context, description) : null;

        let iteration = 0;
        let feedback = '';

        while (iteration < Math.max(maxIterations, 1)) {
            iteration += 1;
            const candidate = await executeIteration(agent, context, description, outputSchema, iteration, feedback, plan, normalizedMode);

            const review = await reviewCandidate(agent, context, description, candidate.raw, outputSchema, iteration, normalizedMode);

            if (review.approved) {
                return candidate.parsed ?? { result: candidate.raw };
            }

            feedback = review.feedback || 'Improve and correct the prior answer.';
        }

        throw new Error('Maximum review iterations exceeded without an approved result.');
    }

    async doTaskWithHumanReview(agentName, context, description, outputSchema = null, mode = 'deep') {
        const agent = getAgent(agentName);
        const normalizedMode = normalizeTaskMode(mode, outputSchema, agent, 'deep');
        const plan = normalizedMode === 'deep' ? await generatePlan(agent, context, description) : null;
        let feedback = '';
        let iteration = 0;

        /* eslint-disable no-constant-condition */
        while (true) {
            iteration += 1;
            const candidate = await executeIteration(agent, context, description, outputSchema, iteration, feedback || '', plan, normalizedMode);
            const finalResult = candidate.parsed ?? { result: candidate.raw };

            console.log('----- Agent Result -----');
            console.log(typeof candidate.raw === 'string' ? candidate.raw : JSON.stringify(candidate.raw, null, 2));

            const approval = await this.readUserPrompt('Is the result okay? [Y/n/cancel]: ');
            const normalized = (approval || '').trim().toLowerCase();

            if (normalized === '' || normalized === 'y' || normalized === 'yes') {
                return finalResult;
            }
            if (normalized === 'cancel') {
                throw new Error('Task cancelled by user.');
            }

            feedback = await this.readUserPrompt('Please provide feedback for the agent: ');
        }
        /* eslint-enable no-constant-condition */
    }

    cancelTasks() {
        cancelLLMRequests();
    }

    async brainstormQuestion(agentName, question, generationCount, returnCount, reviewCriteria = null) {
        if (!question) {
            throw new Error('question is required for brainstorm.');
        }
        if (!Number.isInteger(generationCount) || generationCount < 1) {
            throw new Error('generationCount must be a positive integer.');
        }
        if (!Number.isInteger(returnCount) || returnCount < 1) {
            throw new Error('returnCount must be a positive integer.');
        }

        const registry = ensureAgentRegistry();
        const agents = Array.from(registry.values());
        if (!agents.length) {
            throw new Error('No agents available for brainstorming.');
        }

        const generationResults = [];
        let nextIndex = 1;

        let generatedCount = 0;
        while (generationResults.length < generationCount) {
            const agent = agents[generatedCount % agents.length];
            const history = buildSystemHistory(agent, {
                instruction: 'Generate one creative, self-contained answer option.',
                context: '',
                description: `Question: ${question}\nYou are variant #${nextIndex}.`,
                mode: 'fast',
            });
            const raw = await invokeAgent(agent, history, { mode: 'fast' });
            generationResults.push({ index: nextIndex, agent: agent.name, content: raw });
            nextIndex += 1;
            generatedCount += 1;
        }

        const evaluator = getAgent(agentName);
        const evaluationMode = evaluator.supportsMode && evaluator.supportsMode('deep') ? 'deep' : 'fast';
        const evaluationHistory = buildSystemHistory(evaluator, {
            instruction: 'Evaluate brainstormed alternatives and return the top choices ranked by quality.',
            context: buildEvaluationContext(question, generationResults, reviewCriteria),
            description: 'Return JSON with property "ranked" listing objects {"index": number, "score": number, "rationale": string}.',
            mode: evaluationMode,
        });
        const evaluationRaw = await invokeAgent(evaluator, evaluationHistory, { mode: evaluationMode });
        const evaluation = safeJsonParse(evaluationRaw);

        if (!evaluation?.ranked || !Array.isArray(evaluation.ranked)) {
            throw new Error('Brainstorm evaluation response did not include ranked results.');
        }

        const ranked = evaluation.ranked
            .filter(entry => typeof entry.index === 'number')
            .slice(0, returnCount);

        return ranked.map(entry => {
            const match = generationResults.find(option => option.index === entry.index);
            if (!match) {
                return null;
            }
            return {
                choice: match.content,
                metadata: {
                    agent: match.agent,
                    index: match.index,
                    score: entry.score,
                    rationale: entry.rationale,
                }
            };
        }).filter(Boolean);
    }
}

function getAgentLibrary() {
    if (!agentLibraryInstance) {
        agentLibraryInstance = new Agent();
    }
    return agentLibraryInstance;
}

export {
    Agent
};

export const __resetForTests = resetForTests;
