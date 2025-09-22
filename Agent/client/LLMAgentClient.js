const readline = require('readline');

// The low-level LLM client used for all model invocations.
const { callLLMWithModel, cancelRequests: cancelLLMRequests } = require('./LLMClient');
const { loadModelsConfiguration } = require('./modelsConfigLoader');

const operatorRegistry = new Map();
let agentRegistry = null;
let defaultAgentName = null;
let agentRegistrySummary = null;

const modelsConfiguration = loadModelsConfiguration();

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

function combineAgentDescriptionWithContext(agent, context) {
    const description = buildAgentDescription(agent);
    const trimmedContext = context ? String(context).trim() : '';
    return trimmedContext ? `${description}\n\n${trimmedContext}` : description;
}

const VALID_CONTEXT_ROLES = new Set(['system', 'human', 'assistant']);

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

function normalizeTaskContext(agent, context) {
    if (Array.isArray(context)) {
        const normalizedMessages = context
            .map((entry) => {
                if (!entry || typeof entry !== 'object') {
                    return null;
                }

                const rawRole = typeof entry.role === 'string' ? entry.role.trim().toLowerCase() : '';
                const role = rawRole === 'user' ? 'human' : rawRole;
                if (!VALID_CONTEXT_ROLES.has(role)) {
                    return null;
                }

                let message = entry.message;
                if (typeof message === 'undefined' || message === null) {
                    message = entry.content;
                }
                if (typeof message === 'undefined' || message === null) {
                    return null;
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
            text: combineAgentDescriptionWithContext(agent, ''),
        };
    }

    const trimmed = context ? String(context).trim() : '';
    const combined = combineAgentDescriptionWithContext(agent, trimmed);
    return {
        type: 'text',
        text: combined,
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

function hasAvailableKey(record) {
    if (!record) {
        return false;
    }
    if (!record.apiKeyEnv) {
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

    const fastRecords = orderedRecords.filter(record => fastSet.has(record.name) || (fastSet.size === 0 && record.mode === 'fast'));
    const deepRecords = orderedRecords.filter(record => deepSet.has(record.name) || (deepSet.size === 0 && record.mode === 'deep'));

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

    agentRegistry.set(name.toLowerCase(), agentRecord);

    summaryState.active.push({
        name,
        kind: normalizedKind,
        role,
        job,
        expertise,
        instructions,
        origin,
        providerKey: agentRecord.providerKey,
        defaultModel: agentRecord.model,
        availableModels: agentRecord.availableModels.slice(),
        fastModels: agentRecord.fastModels.slice(),
        deepModels: agentRecord.deepModels.slice(),
    });

    return { status: 'active', agent: agentRecord };
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

function registerDefaultLLMAgent(options = {}) {
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

    const contextInfo = normalizeTaskContext(agent, JSON.stringify({ operators: operatorList }, null, 2));
    const history = buildSystemHistory(agent, {
        instruction: normalizedMode === 'deep'
            ? 'Review the operator catalog and select the functions that can help with the task.'
            : 'Quickly select operators that can solve the task.',
        context: contextInfo,
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
    const contextInfo = normalizeTaskContext(agent, context);
    const history = buildSystemHistory(agent, {
        instruction: 'Complete the task in a single response.',
        context: contextInfo,
        description,
        outputSchema,
    });
    const raw = await invokeAgent(agent, history);
    return buildTaskResult(raw, outputSchema);
}

async function executeDeepTask(agent, context, description, outputSchema) {
    const plan = await generatePlan(agent, context, description);
    const contextInfo = normalizeTaskContext(agent, context);
    const executionHistory = buildSystemHistory(agent, {
        instruction: 'Follow the plan and produce a final answer. Iterate internally as needed.',
        context: contextInfo,
        extraContextParts: [`Plan:\n${JSON.stringify(plan)}`],
        description,
        outputSchema,
    });
    const raw = await invokeAgent(agent, executionHistory);
    return buildTaskResult(raw, outputSchema);
}

async function executeIteration(agent, context, description, outputSchema, iteration, feedback, plan) {
    const contextInfo = normalizeTaskContext(agent, context);
    const extraParts = [`Task:\n${description}`, `Iteration: ${iteration}`];
    if (plan) {
        extraParts.push(`Plan:\n${JSON.stringify(plan)}`);
    }
    if (feedback) {
        extraParts.push(`Prior feedback:\n${feedback}`);
    }

    const history = buildSystemHistory(agent, {
        instruction: 'Work step-by-step, applying the plan and feedback to improve the solution.',
        context: contextInfo,
        extraContextParts: extraParts,
        description: 'Return only the updated solution, no commentary unless necessary.',
        outputSchema,
    });
    const raw = await invokeAgent(agent, history);
    const parsed = buildTaskResult(raw, outputSchema);
    return { raw, parsed };
}

async function reviewCandidate(agent, context, description, candidate, outputSchema, iteration) {
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
    });

    const reviewRaw = await invokeAgent(agent, reviewHistory);
    const review = safeJsonParse(reviewRaw);

    if (typeof review?.approved !== 'boolean') {
        return { approved: false, feedback: 'Review response invalid; improve the solution with more rigor.' };
    }

    return { approved: review.approved, feedback: review.feedback };
}

async function generatePlan(agent, context, description) {
    const contextInfo = normalizeTaskContext(agent, context);
    const history = buildSystemHistory(agent, {
        instruction: 'Create a concise step-by-step plan for the task before solving it.',
        context: contextInfo,
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

function buildSystemHistory(agent, { instruction, context, description, outputSchema, extraContextParts = [] }) {
    const history = [];
    const agentLabel = agent.canonicalName || agent.name;
    const modelDescriptor = agent.model ? ` using model "${agent.model}"` : '';
    const agentDescription = buildAgentDescription(agent);
    history.push({
        role: 'system',
        message: `You are the ${agentLabel} agent${modelDescriptor}. ${agentDescription} ${instruction}`.trim(),
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
}

module.exports = {
    registerLLMAgent,
    registerDefaultLLMAgent,
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
