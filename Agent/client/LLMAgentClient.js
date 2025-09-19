const readline = require('readline');

// The low-level LLM client used for all model invocations.
const { callLLMWithModel, cancelRequests: cancelLLMRequests } = require('./LLMClient');
const { loadModelsConfiguration } = require('./modelsConfigLoader');

const operatorRegistry = new Map();
let agentRegistry = null;
let modelAliasRegistry = null;
let defaultAgentName = null;
let providerRegistrySummary = null;
let customAgentSummaries = null;

const modelsConfiguration = loadModelsConfiguration();
const SUPPORTED_MODELS = new Set(modelsConfiguration.models.keys());

const PROVIDER_PRIORITY = ['openai', 'gemini', 'anthropic', 'openrouter', 'mistral', 'deepseek', 'huggingface'];

let configurationDiagnosticsEmitted = false;

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
        alias: modelDescriptor.alias || null,
    };
}

function cloneAgentModelRecord(record) {
    return {
        name: record.name,
        providerKey: record.providerKey,
        apiKeyEnv: record.apiKeyEnv,
        baseURL: record.baseURL,
        mode: record.mode || 'fast',
        alias: record.alias || null,
    };
}

function selectDefaultModelRecord(providerConfig, availableModels) {
    if (!availableModels || !availableModels.length) {
        return null;
    }

    const pickByName = (name) => availableModels.find(model => model.name === name);

    if (providerConfig?.defaultModel) {
        const preferred = pickByName(providerConfig.defaultModel);
        if (preferred) {
            return preferred;
        }
    }

    const deepModel = availableModels.find(model => model.mode === 'deep');
    if (deepModel) {
        return deepModel;
    }

    const fastModel = availableModels.find(model => model.mode === 'fast');
    if (fastModel) {
        return fastModel;
    }

    return availableModels[0];
}

function registerProviderAgent(providerConfig) {
    if (!providerConfig) {
        return;
    }

    const summary = {
        providerKey: providerConfig.providerKey,
        baseURL: providerConfig.baseURL || null,
        availableModels: [],
    };

    const modelDescriptors = modelsConfiguration.providerModels.get(providerConfig.providerKey) || [];
    if (!modelDescriptors.length) {
        summary.status = 'inactive';
        summary.reason = 'no models configured';
        providerRegistrySummary?.inactive.push(summary);
        console.warn(`LLMAgentClient: No models configured in models.json for provider "${providerConfig.providerKey}".`);
        return;
    }

    const resolvedModels = modelDescriptors
        .map(descriptor => createAgentModelRecord(providerConfig, descriptor))
        .filter(record => record && record.apiKeyEnv);

    summary.availableModels = resolvedModels.map(record => ({
        name: record.name,
        apiKeyEnv: record.apiKeyEnv,
        mode: record.mode,
    }));

    if (!resolvedModels.length) {
        summary.status = 'inactive';
        summary.reason = 'models missing apiKeyEnv';
        providerRegistrySummary?.inactive.push(summary);
        console.warn(`LLMAgentClient: Provider "${providerConfig.providerKey}" has no models with configured apiKeyEnv.`);
        return;
    }

    const availableModels = resolvedModels.filter(record => Boolean(process.env[record.apiKeyEnv]));
    if (!availableModels.length) {
        summary.status = 'inactive';
        summary.reason = 'missing API keys';
        providerRegistrySummary?.inactive.push(summary);
        console.warn(`LLMAgentClient: Provider "${providerConfig.providerKey}" has no models with available API keys.`);
        return;
    }

    const selectedModel = selectDefaultModelRecord(providerConfig, availableModels);
    if (!selectedModel) {
        summary.status = 'inactive';
        summary.reason = 'no default model available';
        providerRegistrySummary?.inactive.push(summary);
        console.warn(`LLMAgentClient: Provider "${providerConfig.providerKey}" could not determine a default model.`);
        return;
    }

    const canonicalName = providerConfig.providerKey;
    const agentName = canonicalName;

    const agentRecord = {
        name: agentName,
        canonicalName,
        providerKey: providerConfig.providerKey,
        apiKeyEnv: selectedModel.apiKeyEnv,
        baseURL: selectedModel.baseURL,
        model: selectedModel.name,
        modelMode: selectedModel.mode,
        availableModels: availableModels.map(model => model.name),
        availableModelRecords: availableModels.map(cloneAgentModelRecord),
        supportedModes: Array.from(new Set(availableModels.map(model => model.mode).filter(Boolean))),
    };

    summary.status = 'active';
    summary.defaultModel = selectedModel.name;
    summary.availableModels = availableModels.map(model => ({
        name: model.name,
        apiKeyEnv: model.apiKeyEnv,
        mode: model.mode,
        isDefault: model.name === selectedModel.name,
    }));
    providerRegistrySummary?.active.push(summary);

    const registryKeys = new Set([
        canonicalName,
        agentName,
    ]);

    for (const key of registryKeys) {
        if (!key) {
            continue;
        }
        agentRegistry.set(key.toLowerCase(), agentRecord);
    }

    registerModelAliases(agentRecord, availableModels);
}

function ensureAgentRegistry() {
    if (agentRegistry) {
        return agentRegistry;
    }

    emitConfigurationDiagnostics();

    agentRegistry = new Map();
    modelAliasRegistry = new Map();
    providerRegistrySummary = { active: [], inactive: [] };
    customAgentSummaries = [];

    for (const providerConfig of modelsConfiguration.providers.values()) {
        registerProviderAgent(providerConfig);
    }

    registerCustomAgents(agentRegistry);

    determineDefaultAgent();
    return agentRegistry;
}

function registerCustomAgents(registry) {
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
        const apiKeyValue = process.env[apiKeyEnv];

        if (!apiKeyValue) {
            console.warn(`LLMAgentClient: API key environment variable "${apiKeyEnv}" is not set for custom agent "${agentName}".`);
            continue;
        }

        if (!modelName) {
            console.warn(`LLMAgentClient: Missing model name for custom agent "${agentName}". Set ${modelKey}.`);
            continue;
        }

        if (!SUPPORTED_MODELS.has(modelName)) {
            console.warn(`LLMAgentClient: Custom model "${modelName}" is not listed in models.json. Skipping registration.`);
            continue;
        }

        const modelDescriptor = getModelDescriptor(modelName);
        if (!modelDescriptor) {
            console.warn(`LLMAgentClient: models.json does not include details for model "${modelName}". Skipping custom agent "${agentName}".`);
            continue;
        }
        const providerKey = modelDescriptor.providerKey;
        if (!providerKey) {
            console.warn(`LLMAgentClient: models.json does not map "${modelName}" to a provider. Skipping custom agent "${agentName}".`);
            continue;
        }

        const providerConfig = getProviderConfig(providerKey);
        const resolvedBaseURL = baseURL || modelDescriptor.baseURL || providerConfig?.baseURL || null;

        const mode = modelDescriptor.mode || 'fast';

        const modelRecord = {
            name: modelName,
            providerKey,
            apiKeyEnv,
            baseURL: resolvedBaseURL,
            mode,
            alias: modelDescriptor.alias || null,
        };

        const agent = {
            name: agentName,
            canonicalName: agentName,
            model: modelName,
            apiKeyEnv,
            providerKey,
            baseURL: modelRecord.baseURL,
            modelMode: mode,
            availableModels: [modelName],
            availableModelRecords: [cloneAgentModelRecord(modelRecord)],
            supportedModes: [mode],
        };
        const registryKey = agentName.toLowerCase();
        registry.set(registryKey, agent);
        registerModelAliases(agent, agent.availableModelRecords);

        customAgentSummaries?.push({
            name: agentName,
            model: modelName,
            providerKey,
            apiKeyEnv,
            baseURL: modelRecord.baseURL,
        });
    }
}

function registerModelAliases(agentRecord, modelRecords) {
    if (!modelAliasRegistry) {
        modelAliasRegistry = new Map();
    }

    const canonicalName = agentRecord.canonicalName || agentRecord.name;
    const recordsSource = Array.isArray(modelRecords) && modelRecords.length
        ? modelRecords
        : (agentRecord.availableModelRecords || []).map(cloneAgentModelRecord);

    for (const modelRecord of recordsSource) {
        if (!modelRecord || !modelRecord.name) {
            continue;
        }

        const aliasCandidates = new Set([modelRecord.name, modelRecord.alias].filter(Boolean));

        for (const alias of aliasCandidates) {
            const aliasKey = alias.toLowerCase();
            if (modelAliasRegistry.has(aliasKey)) {
                continue;
            }

            modelAliasRegistry.set(aliasKey, {
                name: alias,
                canonicalName,
                providerKey: agentRecord.providerKey,
                apiKeyEnv: modelRecord.apiKeyEnv || agentRecord.apiKeyEnv,
                baseURL: modelRecord.baseURL || agentRecord.baseURL,
                model: modelRecord.name,
                mode: modelRecord.mode || agentRecord.modelMode,
                modelMode: modelRecord.mode || agentRecord.modelMode,
                supportedModes: Array.isArray(agentRecord.supportedModes) ? agentRecord.supportedModes.slice() : [agentRecord.modelMode || 'fast'],
                availableModels: agentRecord.availableModels ? agentRecord.availableModels.slice() : [modelRecord.name],
                availableModelRecords: agentRecord.availableModelRecords ? agentRecord.availableModelRecords.map(cloneAgentModelRecord) : [cloneAgentModelRecord(modelRecord)],
            });
        }
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

    const agentModes = Array.isArray(agent?.supportedModes) ? agent.supportedModes.slice() : [];
    if (!agentModes.length && agent?.modelMode) {
        agentModes.push(agent.modelMode);
    }

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
    const apiKey = agent.apiKeyEnv ? process.env[agent.apiKeyEnv] : null;
    if (!apiKey && agent.providerKey !== 'huggingface') {
        throw new Error(`Missing API key for agent "${agent.name}" (${agent.apiKeyEnv}).`);
    }

    const baseURL = agent.baseURL || getProviderConfig(agent.providerKey)?.baseURL;
    if (!baseURL) {
        throw new Error(`Missing base URL for agent "${agent.name}" (${agent.providerKey}).`);
    }

    return callLLMWithModel(agent.model, [...history], null, {
        apiKey,
        baseURL,
        providerKey: agent.providerKey,
    });
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

function cloneProviderSummary(summary) {
    return {
        providerKey: summary.providerKey,
        baseURL: summary.baseURL || null,
        status: summary.status,
        reason: summary.reason,
        defaultModel: summary.defaultModel,
        availableModels: Array.isArray(summary.availableModels)
            ? summary.availableModels.map(model => ({
                name: model.name,
                apiKeyEnv: model.apiKeyEnv,
                mode: model.mode || 'fast',
                isDefault: Boolean(model.isDefault),
            }))
            : [],
    };
}

function listAgents() {
    ensureAgentRegistry();

    const providers = providerRegistrySummary || { active: [], inactive: [] };
    const customAgents = customAgentSummaries || [];

    return {
        defaultAgent: defaultAgentName,
        providers: {
            active: providers.active.map(cloneProviderSummary),
            inactive: providers.inactive.map(cloneProviderSummary),
        },
        customAgents: customAgents.map(entry => ({
            name: entry.name,
            model: entry.model,
            providerKey: entry.providerKey,
            apiKeyEnv: entry.apiKeyEnv,
            baseURL: entry.baseURL || null,
        })),
    };
}

function resetForTests() {
    agentRegistry = null;
    modelAliasRegistry = null;
    defaultAgentName = null;
    providerRegistrySummary = null;
    customAgentSummaries = null;
    configurationDiagnosticsEmitted = false;
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
    listAgents,
    __resetForTests: resetForTests,
};
