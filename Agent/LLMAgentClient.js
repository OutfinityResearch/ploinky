const fs = require('fs');
const path = require('path');
const readline = require('readline');

// The low-level LLM client used for all model invocations.
const { callLLMWithModel, cancelRequests: cancelLLMRequests } = require('./LLMClient');

const operatorRegistry = new Map();
let agentRegistry = null;
let modelAliasRegistry = null;
let defaultAgentName = null;

const modelsConfig = loadModelsConfig();
const modelInventory = computeModelInventory();
const SUPPORTED_MODELS = modelInventory.supportedModels;

const PROVIDER_PRIORITY = ['openai', 'gemini', 'anthropic', 'openrouter', 'mistral', 'deepseek', 'huggingface'];

const PREDEFINED_PROVIDERS = [
    {
        name: 'openai',
        providerKey: 'openai',
        apiKeyEnv: 'OPENAI_API_KEY',
        modelEnv: 'OPENAI_MODEL',
    },
    {
        name: 'gemini',
        providerKey: 'google',
        apiKeyEnv: 'GEMINI_API_KEY',
        modelEnv: 'GEMINI_MODEL',
    },
    {
        name: 'anthropic',
        providerKey: 'anthropic',
        apiKeyEnv: 'ANTHROPIC_API_KEY',
        modelEnv: 'ANTHROPIC_MODEL',
    },
    {
        name: 'mistral',
        providerKey: 'mistral',
        apiKeyEnv: 'MISTRAL_API_KEY',
        modelEnv: 'MISTRAL_MODEL',
    },
    {
        name: 'openrouter',
        providerKey: 'openrouter',
        apiKeyEnv: 'OPENROUTER_API_KEY',
        modelEnv: 'OPENROUTER_MODEL',
    },
    {
        name: 'deepseek',
        providerKey: 'deepseek',
        apiKeyEnv: 'DEEPSEEK_API_KEY',
        modelEnv: 'DEEPSEEK_MODEL',
    },
    {
        name: 'huggingface',
        providerKey: 'huggingface',
        apiKeyEnv: 'HUGGINGFACE_API_KEY',
        modelEnv: 'HUGGINGFACE_MODEL',
    }
];

function loadModelsConfig() {
    const configPath = path.join(__dirname, 'models.json');
    if (!fs.existsSync(configPath)) {
        return { models: {}, providers: {} };
    }
    try {
        const raw = fs.readFileSync(configPath, 'utf-8');
        return JSON.parse(raw);
    } catch (error) {
        throw new Error(`Failed to read models.json: ${error.message}`);
    }
}

function computeModelInventory() {
    const supportedModels = new Set();
    const modelsByProvider = new Map();
    const modelsByName = new Map();
    const models = modelsConfig.models || {};

    for (const [modelName, entry] of Object.entries(models)) {
        let providerKey = null;
        let modes = ['fast'];

        if (typeof entry === 'string') {
            providerKey = entry;
        } else if (entry && typeof entry === 'object') {
            providerKey = entry.provider || entry.providerKey || null;
            modes = normalizeModes(entry.modes ?? entry.mode);
        } else {
            console.warn(`LLMAgentClient: Invalid configuration for model "${modelName}" in models.json.`);
            continue;
        }

        if (!providerKey) {
            console.warn(`LLMAgentClient: Model "${modelName}" is missing a provider in models.json.`);
            continue;
        }

        supportedModels.add(modelName);

        const record = {
            name: modelName,
            providerKey,
            modes,
        };

        modelsByName.set(modelName, record);

        if (!modelsByProvider.has(providerKey)) {
            modelsByProvider.set(providerKey, []);
        }
        modelsByProvider.get(providerKey).push(record);
    }

    return {
        supportedModels,
        modelsByProvider,
        modelsByName,
    };
}

function normalizeModes(rawModes) {
    if (rawModes === undefined || rawModes === null) {
        return ['fast'];
    }

    const valueArray = Array.isArray(rawModes) ? rawModes : [rawModes];
    const normalized = Array.from(new Set(valueArray
        .map(mode => typeof mode === 'string' ? mode.toLowerCase() : '')
        .filter(mode => mode === 'fast' || mode === 'deep')));

    if (!normalized.length) {
        console.warn('LLMAgentClient: Model modes must be "fast" or "deep". Defaulting to "fast".');
        return ['fast'];
    }

    return normalized;
}

function cloneModelRecord(record) {
    return {
        name: record.name,
        providerKey: record.providerKey,
        modes: Array.isArray(record.modes) ? record.modes.slice() : ['fast'],
    };
}

function getModelInfo(modelName) {
    return modelInventory.modelsByName.get(modelName) || null;
}

function buildModelsByProvider() {
    const mapping = new Map();

    for (const [providerKey, records] of modelInventory.modelsByProvider.entries()) {
        mapping.set(providerKey, records.map(cloneModelRecord));
    }

    return mapping;
}

function ensureAgentRegistry() {
    if (agentRegistry) {
        return agentRegistry;
    }

    agentRegistry = new Map();
    modelAliasRegistry = new Map();

    const providersConfig = modelsConfig.providers || {};
    const modelsByProvider = buildModelsByProvider();

    for (const provider of PREDEFINED_PROVIDERS) {
        const apiKey = process.env[provider.apiKeyEnv];
        if (!apiKey) {
            continue;
        }

        const availableModelRecords = modelsByProvider.get(provider.providerKey) || [];
        if (!availableModelRecords.length) {
            console.warn(`LLMAgentClient: No models configured in models.json for provider "${provider.providerKey}".`);
            continue;
        }

        const selectedModel = resolveModelRecord(provider, availableModelRecords);
        if (!selectedModel) {
            continue;
        }

        const baseURL = providersConfig?.[provider.providerKey]?.baseURL;
        const record = {
            name: provider.name,
            canonicalName: provider.name,
            providerKey: provider.providerKey,
            apiKeyEnv: provider.apiKeyEnv,
            baseURL,
            model: selectedModel.name,
            modelModes: selectedModel.modes.slice(),
            availableModels: availableModelRecords.map(model => model.name),
            availableModelRecords: availableModelRecords.map(cloneModelRecord),
        };

        const registryKey = provider.name.toLowerCase();
        agentRegistry.set(registryKey, record);
        const providerAliasKey = provider.providerKey.toLowerCase();
        if (!agentRegistry.has(providerAliasKey)) {
            agentRegistry.set(providerAliasKey, record);
        }

        registerModelAliases(record, record.availableModelRecords);
    }

    registerCustomAgents(agentRegistry, providersConfig);

    determineDefaultAgent();
    return agentRegistry;
}

function resolveModelRecord(provider, availableModelRecords) {
    const fromEnv = provider.modelEnv ? process.env[provider.modelEnv] : undefined;
    if (fromEnv) {
        const match = availableModelRecords.find(model => model.name === fromEnv);
        if (match) {
            return match;
        }
        console.warn(`LLMAgentClient: Model "${fromEnv}" is not listed for provider "${provider.name}". Falling back to models.json.`);
    }

    const deepModel = availableModelRecords.find(model => model.modes.includes('deep'));
    if (deepModel) {
        return deepModel;
    }

    return availableModelRecords[0] || null;
}

function registerCustomAgents(registry, providersConfig) {
    const envEntries = Object.keys(process.env);
    const apiKeyPattern = /^CUSTOM_LLM_([A-Z0-9_]+)_API_KEY$/;

    for (const key of envEntries) {
        const match = key.match(apiKeyPattern);
        if (!match) {
            continue;
        }
        const suffix = match[1];
        const agentName = suffix.toLowerCase();
        const baseUrlKey = `CUSTOM_LLM_${suffix}_BASE_URL`;
        const modelKey = `CUSTOM_LLM_${suffix}_MODEL`;

        const baseURL = process.env[baseUrlKey];
        const apiKeyEnv = key;
        const modelName = process.env[modelKey];

        if (!baseURL || !modelName) {
            console.warn(`LLMAgentClient: Missing base URL or model configuration for custom provider "${agentName}".`);
            continue;
        }

        if (!SUPPORTED_MODELS.has(modelName)) {
            console.warn(`LLMAgentClient: Custom model "${modelName}" is not listed in models.json. Skipping registration.`);
            continue;
        }

        const modelInfo = getModelInfo(modelName);
        if (!modelInfo) {
            console.warn(`LLMAgentClient: models.json does not include details for model "${modelName}". Skipping custom agent "${agentName}".`);
            continue;
        }
        const providerKey = modelInfo.providerKey;
        if (!providerKey) {
            console.warn(`LLMAgentClient: models.json does not map "${modelName}" to a provider. Skipping custom agent "${agentName}".`);
            continue;
        }
        const agent = {
            name: agentName,
            canonicalName: agentName,
            model: modelName,
            apiKeyEnv,
            providerKey,
            baseURL: baseURL || providersConfig?.[providerKey]?.baseURL,
            modelModes: modelInfo.modes.slice(),
            availableModels: [modelName],
            availableModelRecords: [cloneModelRecord(modelInfo)],
        };
        const registryKey = agentName.toLowerCase();
        registry.set(registryKey, agent);
        registerModelAliases(agent, agent.availableModelRecords);
    }
}

function registerModelAliases(agentRecord, modelRecords) {
    if (!modelAliasRegistry) {
        modelAliasRegistry = new Map();
    }

    const canonicalName = agentRecord.canonicalName || agentRecord.name;
    let records = modelRecords;

    if (!Array.isArray(records) || !records.length) {
        records = (agentRecord.availableModelRecords || []).map(cloneModelRecord);
    }

    for (const modelRecord of records) {
        if (!modelRecord || !modelRecord.name) {
            continue;
        }
        const aliasKey = modelRecord.name.toLowerCase();
        if (modelAliasRegistry.has(aliasKey)) {
            continue;
        }
        modelAliasRegistry.set(aliasKey, {
            name: modelRecord.name,
            canonicalName,
            providerKey: agentRecord.providerKey,
            apiKeyEnv: agentRecord.apiKeyEnv,
            baseURL: agentRecord.baseURL,
            model: modelRecord.name,
            modelModes: Array.isArray(modelRecord.modes) ? modelRecord.modes.slice() : ['fast'],
            availableModels: agentRecord.availableModels ? agentRecord.availableModels.slice() : [modelRecord.name],
            availableModelRecords: agentRecord.availableModelRecords ? agentRecord.availableModelRecords.map(cloneModelRecord) : [cloneModelRecord(modelRecord)],
        });
    }
}

function determineDefaultAgent() {
    defaultAgentName = null;
    if (!agentRegistry || agentRegistry.size === 0) {
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
        if (modelAliasRegistry?.has(normalized)) {
            return modelAliasRegistry.get(normalized);
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
    if (!/^[a-z][a-zA-Z0-9]*$/.test(operatorName)) {
        throw new Error('operatorName must be camelCase and alphanumeric.');
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

async function doTaskWithReview(agentName, context, description, outputSchema = null, mode = 'deep', maxIterations = 5) {
    const agent = getAgent(agentName);
    const normalizedMode = normalizeTaskMode(mode, outputSchema, agent, 'deep');

    const plan = normalizedMode === 'deep' ? await generatePlan(agent, context, description) : null;

    let iteration = 0;
    let feedback = '';

    while (iteration < Math.max(maxIterations, 1)) {
        iteration += 1;
        const candidate = await executeIteration(agent, context, description, outputSchema, iteration, feedback, plan);
        const review = await reviewCandidate(agent, context, description, candidate.raw, outputSchema, iteration);
        if (review.approved) {
            return candidate.parsed ?? { result: candidate.raw };
        }
        feedback = review.feedback || 'Improve and correct the prior answer.';
    }

    throw new Error('Maximum review iterations exceeded without an approved result.');
}

async function doTaskWithHumanReview(agentName, context, description, outputSchema = null, mode = 'deep') {
    const agent = getAgent(agentName);
    const normalizedMode = normalizeTaskMode(mode, outputSchema, agent, 'deep');
    const plan = normalizedMode === 'deep' ? await generatePlan(agent, context, description) : null;
    let feedback = '';
    let iteration = 0;

    /* eslint-disable no-constant-condition */
    while (true) {
        iteration += 1;
        const candidate = await executeIteration(agent, context, description, outputSchema, iteration, feedback || '', plan);
        const finalResult = candidate.parsed ?? { result: candidate.raw };

        console.log('----- Agent Result -----');
        console.log(typeof candidate.raw === 'string' ? candidate.raw : JSON.stringify(candidate.raw, null, 2));

        const approval = await promptUser('Is the result okay? [Y/n/cancel]: ');
        const normalized = (approval || '').trim().toLowerCase();

        if (normalized === '' || normalized === 'y' || normalized === 'yes') {
            return finalResult;
        }
        if (normalized === 'cancel') {
            throw new Error('Task cancelled by user.');
        }

        feedback = await promptUser('Please provide feedback for the agent: ');
    }
    /* eslint-enable no-constant-condition */
}

async function brainstorm(agentName, question, generationCount, returnCount, reviewCriteria = null) {
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
    for (let i = 0; i < generationCount; i += 1) {
        const agent = agents[i % agents.length];
        const history = buildSystemHistory(agent, {
            instruction: 'Generate one creative, self-contained answer option.',
            context: '',
            description: `Question: ${question}\nYou are variant #${i + 1}.`,
        });
        const raw = await invokeAgent(agent, history);
        generationResults.push({ index: i + 1, agent: agent.name, content: raw });
    }

    const evaluator = getAgent(agentName);
    const evaluationHistory = buildSystemHistory(evaluator, {
        instruction: 'Evaluate brainstormed alternatives and return the top choices ranked by quality.',
        context: buildEvaluationContext(question, generationResults, reviewCriteria),
        description: 'Return JSON with property "ranked" listing objects {"index": number, "score": number, "rationale": string}.',
    });

    const evaluationRaw = await invokeAgent(evaluator, evaluationHistory);
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

    const history = buildSystemHistory(agent, {
        instruction: normalizedMode === 'deep'
            ? 'Review the operator catalog and select the functions that can help with the task.'
            : 'Quickly select operators that can solve the task.',
        context: JSON.stringify({ operators: operatorList }, null, 2),
        description: `Task description: ${currentTaskDescription}\nOnly return JSON: {"suitableOperators":[{"operatorName": string, "confidence": number}]}. Discard operators below confidence ${threshold}.`,
    });

    const raw = await invokeAgent(agent, history);
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
    cancelLLMRequests();
}

function normalizeTaskMode(mode, outputSchema, agent, fallback = 'fast') {
    const normalized = (mode || '').toLowerCase();
    if (normalized === 'deep' || normalized === 'fast') {
        return normalized;
    }

    const agentModes = Array.isArray(agent?.modelModes) ? agent.modelModes : [];

    if (normalized === 'any' || normalized === '') {
        if (outputSchema && agentModes.includes('deep')) {
            return 'deep';
        }
        if (agentModes.includes('fast')) {
            return 'fast';
        }
        if (agentModes.includes('deep')) {
            return 'deep';
        }
    }

    if (agentModes.includes(fallback)) {
        return fallback;
    }

    return agentModes[0] || fallback;
}

async function executeFastTask(agent, context, description, outputSchema) {
    const history = buildSystemHistory(agent, {
        instruction: 'Complete the task in a single response.',
        context,
        description,
        outputSchema,
    });
    const raw = await invokeAgent(agent, history);
    return buildTaskResult(raw, outputSchema);
}

async function executeDeepTask(agent, context, description, outputSchema) {
    const plan = await generatePlan(agent, context, description);
    const executionHistory = buildSystemHistory(agent, {
        instruction: 'Follow the plan and produce a final answer. Iterate internally as needed.',
        context: `${context || ''}\nPlan: ${JSON.stringify(plan)}`,
        description,
        outputSchema,
    });
    const raw = await invokeAgent(agent, executionHistory);
    return buildTaskResult(raw, outputSchema);
}

async function executeIteration(agent, context, description, outputSchema, iteration, feedback, plan) {
    const pieces = [];
    if (context) {
        pieces.push(`Context:\n${context}`);
    }
    pieces.push(`Task:\n${description}`);
    pieces.push(`Iteration: ${iteration}`);
    if (plan) {
        pieces.push(`Plan:\n${JSON.stringify(plan)}`);
    }
    if (feedback) {
        pieces.push(`Prior feedback:\n${feedback}`);
    }

    const history = buildSystemHistory(agent, {
        instruction: 'Work step-by-step, applying the plan and feedback to improve the solution.',
        context: pieces.join('\n\n'),
        description: 'Return only the updated solution, no commentary unless necessary.',
        outputSchema,
    });
    const raw = await invokeAgent(agent, history);
    const parsed = buildTaskResult(raw, outputSchema);
    return { raw, parsed };
}

async function reviewCandidate(agent, context, description, candidate, outputSchema, iteration) {
    const reviewHistory = buildSystemHistory(agent, {
        instruction: 'Review the candidate solution for quality, correctness, and alignment with the task.',
        context: `Context:\n${context || 'N/A'}\nTask:\n${description}\nIteration: ${iteration}\nCandidate:\n${candidate}`,
        description: 'Return JSON: {"approved": boolean, "feedback": string}.',
        outputSchema: null,
    });

    const reviewRaw = await invokeAgent(agent, reviewHistory);
    const review = safeJsonParse(reviewRaw);

    if (typeof review?.approved !== 'boolean') {
        return { approved: false, feedback: 'Review response invalid; improve the solution with more rigor.' };
    }

    return { approved: review.approved, feedback: review.feedback };
}

async function generatePlan(agent, context, description) {
    const history = buildSystemHistory(agent, {
        instruction: 'Create a concise step-by-step plan for the task before solving it.',
        context,
        description,
        outputSchema: { type: 'object', properties: { steps: { type: 'array' } }, required: ['steps'] },
    });

    const raw = await invokeAgent(agent, history);
    const parsed = safeJsonParse(raw);

    if (parsed?.steps && Array.isArray(parsed.steps)) {
        return parsed;
    }

    return { steps: Array.from(String(raw).split('\n').filter(Boolean)).map((line, index) => ({ id: index + 1, action: line.trim() })) };
}

function buildSystemHistory(agent, { instruction, context, description, outputSchema }) {
    const history = [];
    const agentLabel = agent.canonicalName || agent.name;
    const modelDescriptor = agent.model ? ` using model "${agent.model}"` : '';
    history.push({
        role: 'system',
        message: `You are the ${agentLabel} agent${modelDescriptor}. ${instruction}`.trim(),
    });

    const parts = [];
    if (context) {
        parts.push(`Context:\n${context}`);
    }
    if (description) {
        parts.push(`Task:\n${description}`);
    }
    if (outputSchema) {
        parts.push(`Desired output schema (JSON Schema):\n${JSON.stringify(outputSchema, null, 2)}`);
        parts.push('Respond with JSON that strictly matches the schema.');
    }

    history.push({
        role: 'human',
        message: parts.join('\n\n'),
    });

    return history;
}

function buildEvaluationContext(question, generationResults, reviewCriteria) {
    return JSON.stringify({
        question,
        reviewCriteria: reviewCriteria || 'Use balanced judgement for quality and relevance.',
        alternatives: generationResults.map(entry => ({ index: entry.index, agent: entry.agent, content: entry.content })),
    }, null, 2);
}

async function invokeAgent(agent, history) {
    const apiKey = process.env[agent.apiKeyEnv];
    if (!apiKey) {
        throw new Error(`Missing API key for agent "${agent.name}" (${agent.apiKeyEnv}).`);
    }

    const previousKey = process.env.LLM_API_KEY;
    const previousModel = process.env.LLM_MODEL;
    const previousProvider = process.env.LLM_PROVIDER;
    const previousBaseUrl = process.env.LLM_BASE_URL;

    process.env.LLM_API_KEY = apiKey;

    try {
        return await callLLMWithModel(agent.model, [...history]);
    } finally {
        if (previousKey === undefined) {
            delete process.env.LLM_API_KEY;
        } else {
            process.env.LLM_API_KEY = previousKey;
        }
        if (previousModel === undefined) {
            delete process.env.LLM_MODEL;
        } else {
            process.env.LLM_MODEL = previousModel;
        }
        if (previousProvider === undefined) {
            delete process.env.LLM_PROVIDER;
        } else {
            process.env.LLM_PROVIDER = previousProvider;
        }
        if (previousBaseUrl === undefined) {
            delete process.env.LLM_BASE_URL;
        } else {
            process.env.LLM_BASE_URL = previousBaseUrl;
        }
    }
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

function promptUser(query) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => {
        rl.question(query, answer => {
            rl.close();
            resolve(answer);
        });
    });
}

module.exports = {
    registerOperator,
    callOperator,
    doTask,
    doTaskWithReview,
    doTaskWithHumanReview,
    brainstorm,
    chooseOperator,
    cancelTasks,
};
