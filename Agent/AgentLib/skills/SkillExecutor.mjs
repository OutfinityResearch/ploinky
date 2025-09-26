import { invokeAgent } from '../invocation/modelInvoker.mjs';
import { getAgent } from '../agents/agentRegistry.mjs';
import { safeJsonParse } from '../utils/json.mjs';

async function executeSkill({
    skillName,
    providedArgs = {},
    getSkill,
    getSkillAction,
    getSkillOptions,
    readUserPrompt,
    taskDescription = '',
    skipConfirmation = false,
}) {
    if (typeof getSkill !== 'function') {
        throw new Error('executeSkill requires a getSkill function.');
    }
    if (typeof getSkillAction !== 'function') {
        throw new Error('executeSkill requires a getSkillAction function.');
    }
    if (typeof readUserPrompt !== 'function') {
        throw new Error('executeSkill requires a readUserPrompt function.');
    }

    const skill = getSkill(skillName);
    if (!skill) {
        throw new Error(`Skill "${skillName}" is not registered.`);
    }

    const action = getSkillAction(skillName);
    if (typeof action !== 'function') {
        throw new Error(`No executable action found for skill "${skillName}".`);
    }

    const normalizedArgs = providedArgs && typeof providedArgs === 'object' ? { ...providedArgs } : {};
    const requiredArgs = Array.isArray(skill.requiredArgs) ? skill.requiredArgs.filter(name => typeof name === 'string' && name) : [];
    const argumentDefinitions = Array.isArray(skill.args) ? skill.args.filter(entry => entry && typeof entry.name === 'string' && entry.name) : [];
    const definitionNames = argumentDefinitions.map(def => def.name);
    const allArgumentNames = definitionNames.length
        ? definitionNames
        : Array.from(new Set(requiredArgs));
    const requiredArgSet = new Set(requiredArgs);
    const optionalArgumentNames = allArgumentNames.filter(name => !requiredArgSet.has(name));

    const hasArgumentValue = (name) => Object.prototype.hasOwnProperty.call(normalizedArgs, name)
        && normalizedArgs[name] !== undefined
        && normalizedArgs[name] !== null;

    const missingArgsFromList = (names) => names.filter((name) => !hasArgumentValue(name));

    const optionMap = new Map();
    const toComparableToken = (input) => {
        if (input === undefined) {
            return '';
        }
        if (input === null) {
            return 'null';
        }
        if (typeof input === 'string') {
            return input.trim().toLowerCase();
        }
        if (typeof input === 'number' || typeof input === 'boolean') {
            return String(input).toLowerCase();
        }
        try {
            return JSON.stringify(input).toLowerCase();
        } catch (error) {
            return String(input).toLowerCase();
        }
    };

    const stringifyOptionValue = (value) => {
        if (value === null) {
            return 'null';
        }
        if (value === undefined) {
            return 'undefined';
        }
        if (typeof value === 'string') {
            return value;
        }
        if (typeof value === 'number' || typeof value === 'boolean') {
            return String(value);
        }
        try {
            return JSON.stringify(value);
        } catch (error) {
            return String(value);
        }
    };

    const createOptionEntries = (values) => {
        const entries = [];
        for (const entry of values) {
            if (entry === null || entry === undefined) {
                continue;
            }
            if (typeof entry === 'object' && Object.prototype.hasOwnProperty.call(entry, 'label') && Object.prototype.hasOwnProperty.call(entry, 'value')) {
                const rawLabel = entry.label === null || entry.label === undefined ? '' : String(entry.label).trim();
                if (!rawLabel) {
                    continue;
                }
                const option = {
                    label: rawLabel,
                    value: entry.value,
                };
                option.labelToken = toComparableToken(option.label);
                option.valueToken = toComparableToken(option.value);
                const valueForDisplay = stringifyOptionValue(option.value);
                option.display = option.label === valueForDisplay
                    ? option.label
                    : `${option.label} (${valueForDisplay})`;
                entries.push(option);
                continue;
            }

            if (typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean') {
                const label = String(entry);
                const option = {
                    label,
                    value: entry,
                };
                option.labelToken = toComparableToken(option.label);
                option.valueToken = toComparableToken(option.value);
                option.display = option.label;
                entries.push(option);
            }
        }
        return entries;
    };

    const skillOptionProvider = typeof getSkillOptions === 'function' ? getSkillOptions(skillName) : null;

    if (typeof skillOptionProvider === 'function') {
        try {
            const potentialOptions = await Promise.resolve(skillOptionProvider());
            if (potentialOptions && typeof potentialOptions === 'object') {
                for (const [name, values] of Object.entries(potentialOptions)) {
                    if (typeof name !== 'string' || !Array.isArray(values)) {
                        continue;
                    }
                    const entries = createOptionEntries(values);
                    if (entries.length) {
                        optionMap.set(name, entries);
                    }
                }
            }
        } catch (error) {
            console.warn(`Failed to load options for skill "${skill.name}": ${error.message}`);
        }
    }

    const normalizeOptionValue = (name, value) => {
        const options = optionMap.get(name);
        if (!options || !options.length) {
            return { valid: true, value };
        }
        const candidateToken = toComparableToken(value);
        if (!candidateToken) {
            return { valid: false, value: null };
        }
        for (const option of options) {
            if (candidateToken === option.labelToken || candidateToken === option.valueToken) {
                return { valid: true, value: option.value };
            }
        }
        return { valid: false, value: null };
    };

    const coerceScalarValue = (raw) => {
        const value = typeof raw === 'string' ? raw.trim() : raw;
        if (typeof value !== 'string') {
            return value;
        }
        if (!value.length) {
            return value;
        }
        const lower = value.toLowerCase();
        if (lower === 'true') {
            return true;
        }
        if (lower === 'false') {
            return false;
        }
        if (lower === 'null') {
            return null;
        }
        if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(value)) {
            const numeric = Number(value);
            if (!Number.isNaN(numeric)) {
                return numeric;
            }
        }
        if ((value.startsWith('{') && value.endsWith('}')) || (value.startsWith('[') && value.endsWith(']'))) {
            const parsed = safeJsonParse(value);
            if (parsed !== null) {
                return parsed;
            }
        }
        return value;
    };

    const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const parseNamedArguments = (input, candidateNames) => {
        const resolved = new Map();
        const invalid = new Set();

        if (!input || !candidateNames.length) {
            return { resolved, invalid };
        }

        const lookup = new Map(candidateNames.map(name => [name.toLowerCase(), name]));
        const nameAlternatives = candidateNames.map(escapeRegex).join('|');
        const pattern = new RegExp(String.raw`\b(${nameAlternatives})\b\s*(?::|=)?\s*("[^"]*"|'[^']*'|[^\s"']+)`, 'gi');

        let match;
        while ((match = pattern.exec(input)) !== null) {
            const rawName = match[1];
            const canonical = lookup.get(rawName.toLowerCase());
            if (!canonical) {
                continue;
            }

            if (resolved.has(canonical)) {
                invalid.add(canonical);
                continue;
            }

            let rawValue = match[2] || '';
            rawValue = rawValue.trim();

            if (!rawValue.length) {
                invalid.add(canonical);
                continue;
            }

            if ((rawValue.startsWith('"') && rawValue.endsWith('"')) || (rawValue.startsWith("'") && rawValue.endsWith("'"))) {
                rawValue = rawValue.slice(1, -1);
            }

            rawValue = rawValue.trim();
            if (!rawValue.length) {
                invalid.add(canonical);
                continue;
            }

            const optionCheck = normalizeOptionValue(canonical, rawValue);
            if (!optionCheck.valid) {
                invalid.add(canonical);
                continue;
            }

            if (optionMap.has(canonical)) {
                resolved.set(canonical, optionCheck.value);
                continue;
            }

            resolved.set(canonical, coerceScalarValue(rawValue));
        }

        return { resolved, invalid };
    };

    const resolveFieldName = (name) => {
        if (typeof name !== 'string') {
            return null;
        }
        const trimmed = name.trim();
        if (!trimmed) {
            return null;
        }
        if (allArgumentNames.includes(trimmed)) {
            return trimmed;
        }
        const lower = trimmed.toLowerCase();
        const direct = allArgumentNames.find(candidate => candidate.toLowerCase() === lower);
        if (direct) {
            return direct;
        }

        const nameKeywords = ['job', 'project', 'title'];
        const customerKeywords = ['client', 'customer'];
        const descriptionKeywords = ['description', 'details', 'notes'];
        const statusKeywords = ['status', 'state'];

        if (nameKeywords.some(token => lower.includes(token)) && allArgumentNames.includes('name')) {
            return 'name';
        }
        if (customerKeywords.some(token => lower.includes(token)) && allArgumentNames.includes('customer')) {
            return 'customer';
        }
        if (descriptionKeywords.some(token => lower.includes(token)) && allArgumentNames.includes('description')) {
            return 'description';
        }
        if (statusKeywords.some(token => lower.includes(token)) && allArgumentNames.includes('status')) {
            return 'status';
        }

        const fuzzy = allArgumentNames.find(candidate => {
            const canonical = candidate.toLowerCase();
            const distance = Math.abs(canonical.length - lower.length);
            return distance <= 2 && (canonical.startsWith(lower) || lower.startsWith(canonical));
        });
        return fuzzy || null;
    };

    const applyUpdatesMap = (updates) => {
        if (!updates || typeof updates !== 'object') {
            return 'unchanged';
        }

        let applied = false;
        for (const [rawName, rawValue] of Object.entries(updates)) {
            const field = resolveFieldName(rawName);
            if (!field) {
                continue;
            }
            const currentValue = normalizedArgs[field];
            const hasValue = hasArgumentValue(field);
            const optionCheck = normalizeOptionValue(field, rawValue);
            if (!optionCheck.valid) {
                continue;
            }

            const nextValue = optionMap.has(field)
                ? optionCheck.value
                : coerceScalarValue(rawValue);

            const valuesMatch = () => {
                if (!hasValue) {
                    return false;
                }
                const current = currentValue;
                if (typeof current === 'string' && typeof nextValue === 'string') {
                    return current.trim() === nextValue.trim();
                }
                return current === nextValue;
            };

            if (valuesMatch()) {
                continue;
            }

            normalizedArgs[field] = nextValue;
            applied = true;
        }

        if (!applied) {
            return 'unchanged';
        }

        return missingRequiredArgs().length > 0 ? 'needsMissing' : 'updated';
    };

    const applyDescriptionDefaults = () => {
        for (const definition of argumentDefinitions) {
            if (!definition || typeof definition.name !== 'string') {
                continue;
            }
            if (hasArgumentValue(definition.name)) {
                continue;
            }
            const desc = typeof definition.description === 'string' ? definition.description : '';
            const defaultMatch = desc.match(/defaults? to\s+([^.]+)/i);
            if (defaultMatch && defaultMatch[1]) {
                const rawDefault = defaultMatch[1]
                    .replace(/["']/g, '')
                    .replace(/[)\.]+$/, '')
                    .trim();
                if (!rawDefault) {
                    continue;
                }
                const optionCheck = normalizeOptionValue(definition.name, rawDefault);
                if (!optionCheck.valid) {
                    continue;
                }
                if (optionMap.has(definition.name)) {
                    normalizedArgs[definition.name] = optionCheck.value;
                } else {
                    normalizedArgs[definition.name] = coerceScalarValue(rawDefault);
                }
            }
        }
    };

    const autofillWithLanguageModel = async () => {
        if (!missingRequiredArgs().length) {
            return false;
        }

        let agent;
        try {
            agent = getAgent();
        } catch (error) {
            return false;
        }

        const allowedKeys = JSON.stringify(allArgumentNames);
        const systemPrompt = 'You complete tool arguments based on a user request. Respond ONLY with JSON using keys from ' + allowedKeys + '. Use exact casing. Include a key only when the value is clearly implied. Avoid guessing. Use numbers for numeric fields and booleans for true/false.';

        const sections = [
            `Skill name: ${skill.name}`,
            `Skill description: ${skill.description}`,
            `Existing arguments: ${JSON.stringify(normalizedArgs, null, 2)}`,
            `Missing arguments: ${JSON.stringify(missingRequiredArgs())}`,
            `Optional arguments: ${JSON.stringify(missingOptionalArgs())}`,
        ];

        if (argumentDefinitions.length) {
            sections.push(`Argument definitions: ${JSON.stringify(argumentDefinitions, null, 2)}`);
        }

        if (taskDescription && typeof taskDescription === 'string') {
            sections.push(`Original user request: ${taskDescription}`);
        }

        sections.push('Map serial numbers to serialNumber. Use phrases like "stored in Bay C-02" to populate storageLocation. Manufacturer should be the brand; model should be the product name. Use status for availability (e.g., available). Only set allocationBlocked when explicitly stated. If uncertain, omit the key. Return JSON only.');

        let raw;
        try {
            raw = await invokeAgent(agent, [
                { role: 'system', message: systemPrompt },
                { role: 'human', message: sections.join('\n\n') },
            ], { mode: 'fast' });
        } catch (error) {
            return false;
        }

        const parsed = safeJsonParse(typeof raw === 'string' ? raw.trim() : raw);
        if (!parsed || typeof parsed !== 'object') {
            return false;
        }

        const status = applyUpdatesMap(parsed);
        return status !== 'unchanged';
    };




    const prefillFromTaskDescription = (rawDescription) => {
        if (typeof rawDescription !== 'string') {
            return;
        }
        const trimmed = rawDescription.trim();
        if (!trimmed) {
            return;
        }

        const candidateNames = allArgumentNames.length
            ? allArgumentNames
            : (requiredArgs.length ? requiredArgs : missingRequiredArgs());

        if (candidateNames.length) {
            const { resolved: parsed } = parseNamedArguments(trimmed, candidateNames);
            for (const [name, value] of parsed.entries()) {
                if (!hasArgumentValue(name)) {
                    normalizedArgs[name] = value;
                }
            }
        }
    };

    const missingRequiredArgs = () => missingArgsFromList(requiredArgs);
    const missingOptionalArgs = () => missingArgsFromList(optionalArgumentNames);

    const describeArgument = (name) => {
        const definition = argumentDefinitions.find((arg) => arg.name === name);
        const options = optionMap.get(name);
        const descriptionPart = definition?.description ? `: ${definition.description}` : '';
        const baseLine = `${name}${descriptionPart}`;
        if (options && options.length) {
            const lines = options.map(option => `  * ${option.display}`);
            return [baseLine, 'Options:', ...lines].join('\n');
        }
        return baseLine;
    };

    const parseableArgumentNames = allArgumentNames.length
        ? allArgumentNames
        : (requiredArgs.length ? requiredArgs : []);

    const interpretConfirmationResponse = async (rawInput, summaryText) => {
        let agent;
        try {
            agent = getAgent();
        } catch (error) {
            return null;
        }

        const systemPrompt = 'You interpret confirmation responses for tool execution. Respond ONLY with JSON like {"action":"confirm|cancel|edit","updates":{"field":"value"}}. Use lowercase action strings.';
        const humanSections = [
            'The user was shown a summary of the pending action and replied as follows.',
            `User reply: ${rawInput}`,
            `Current arguments: ${JSON.stringify(normalizedArgs, null, 2)}`,
        ];

        if (summaryText) {
            humanSections.push(`Summary shown to user:\n${summaryText}`);
        }

        if (argumentDefinitions.length) {
            humanSections.push(`Argument definitions: ${JSON.stringify(argumentDefinitions, null, 2)}`);
        }

        humanSections.push('Return JSON only. Use "confirm" to proceed, "cancel" to stop, or "edit" with updates to adjust specific arguments.');

        let raw;
        try {
            raw = await invokeAgent(agent, [
                { role: 'system', message: systemPrompt },
                { role: 'human', message: humanSections.join('\n\n') },
            ], { mode: 'fast' });
        } catch (error) {
            return null;
        }

        const parsed = safeJsonParse(typeof raw === 'string' ? raw.trim() : raw);
        if (!parsed || typeof parsed !== 'object') {
            return null;
        }

        const action = typeof parsed.action === 'string' ? parsed.action.trim().toLowerCase() : '';
        const updates = parsed.updates && typeof parsed.updates === 'object' ? parsed.updates : null;

        if (!action) {
            return null;
        }

        return { action, updates };
    };

    const formatArgumentList = (descriptors) => descriptors
        .map((descriptor) => {
            if (descriptor === null || descriptor === undefined) {
                return '';
            }
            const lines = String(descriptor).split('\n');
            if (!lines.length) {
                return '';
            }
            const [first, ...rest] = lines;
            const formatted = [`    - ${first}`];
            for (const line of rest) {
                formatted.push(line ? `      ${line}` : '      ');
            }
            return formatted.join('\n');
        })
        .filter(Boolean)
        .join('\n');

    let optionalPromptShown = false;

    const collectMissingArguments = async () => {
        optionalPromptShown = false;

        while (missingRequiredArgs().length > 0) {
            const missingRequired = missingRequiredArgs();
            const missingOptional = optionalPromptShown ? [] : missingOptionalArgs();

            const requiredDescriptors = missingRequired.map(describeArgument);
            const promptSections = ['Missing required arguments:'];
            const formattedRequired = formatArgumentList(requiredDescriptors);
            if (formattedRequired) {
                promptSections.push(formattedRequired);
            }

            if (missingOptional.length) {
                const optionalDescriptors = missingOptional.map(describeArgument);
                const formattedOptional = formatArgumentList(optionalDescriptors);
                if (formattedOptional) {
                    promptSections.push('Optional arguments you may also set now:', formattedOptional);
                } else {
                    promptSections.push('Optional arguments you may also set now:');
                }
                optionalPromptShown = true;
            }

            promptSections.push("Provide values (or type 'cancel' to abort):\n");

            const userInput = await readUserPrompt(`${promptSections.join('\n')}`);
            const trimmedInput = typeof userInput === 'string' ? userInput.trim() : '';

            if (!trimmedInput) {
                if (!optionalPromptShown && optionalArgumentNames.length) {
                    optionalPromptShown = true;
                }
                continue;
            }

            if (trimmedInput.toLowerCase() === 'cancel') {
                throw new Error('Skill execution cancelled by user.');
            }

        const parseTargets = parseableArgumentNames.length ? parseableArgumentNames : missingRequired;
        const { resolved: directlyParsed, invalid: ambiguous } = parseNamedArguments(trimmedInput, parseTargets);
        for (const [name, value] of directlyParsed.entries()) {
            normalizedArgs[name] = value;
        }

        const assignUnlabeledTokens = () => {
            const rawTokens = trimmedInput.match(/"[^"]*"|'[^']*'|\S+/g);
            if (!rawTokens || !rawTokens.length) {
                return;
            }

            const normalizedTokens = rawTokens
                .map((token) => {
                    const trimmedToken = token.trim();
                    if (!trimmedToken.length) {
                        return '';
                    }
                    if ((trimmedToken.startsWith('"') && trimmedToken.endsWith('"')) || (trimmedToken.startsWith("'") && trimmedToken.endsWith("'"))) {
                        return trimmedToken.slice(1, -1).trim();
                    }
                    return trimmedToken;
                })
                .filter(Boolean);

            if (!normalizedTokens.length) {
                return;
            }

            const candidateNameSet = new Set(parseTargets.map((name) => name.toLowerCase()));
            const consumedValueSet = new Set(Array.from(directlyParsed.values())
                .map((value) => (typeof value === 'string' ? value.trim().toLowerCase() : null))
                .filter(Boolean));

            const tokensForAssignment = normalizedTokens
                .filter((token) => !candidateNameSet.has(token.toLowerCase()))
                .filter((token) => !consumedValueSet.has(token.toLowerCase()));

            if (!tokensForAssignment.length) {
                return;
            }

            const takeField = (queue, predicate = () => true) => {
                const index = queue.findIndex(predicate);
                if (index === -1) {
                    return null;
                }
                const [field] = queue.splice(index, 1);
                return field;
            };

            const requiredQueue = missingRequiredArgs();
            const optionalQueue = missingOptionalArgs();
            const definitionMap = new Map(argumentDefinitions.map((def) => [def.name, def]));

            const tryAssignToken = (fieldName, tokenValue) => {
                if (!fieldName || hasArgumentValue(fieldName)) {
                    return;
                }

                let value = tokenValue;
                const definition = definitionMap.get(fieldName);
                const fieldType = typeof definition?.type === 'string' ? definition.type.toLowerCase() : '';

                if (optionMap.has(fieldName)) {
                    const optionCheck = normalizeOptionValue(fieldName, value);
                    if (!optionCheck.valid) {
                        return;
                    }
                    normalizedArgs[fieldName] = optionCheck.value;
                    return;
                }

                if (fieldType === 'boolean') {
                    const lower = value.toLowerCase();
                    if (['true', 'yes', 'y', '1', 'enable', 'enabled', 'allow', 'allowed'].includes(lower)) {
                        normalizedArgs[fieldName] = true;
                        return;
                    }
                    if (['false', 'no', 'n', '0', 'disable', 'disabled', 'deny', 'denied'].includes(lower)) {
                        normalizedArgs[fieldName] = false;
                        return;
                    }
                }

                if (fieldType === 'integer' || fieldType === 'number') {
                    const numeric = Number(value);
                    if (Number.isFinite(numeric)) {
                        normalizedArgs[fieldName] = fieldType === 'integer' ? Math.trunc(numeric) : numeric;
                        return;
                    }
                }

                if (fieldType && fieldType !== 'string') {
                    normalizedArgs[fieldName] = coerceScalarValue(value);
                    return;
                }

                normalizedArgs[fieldName] = value;
            };

            for (const token of tokensForAssignment) {
                const emailField = token.includes('@')
                    ? takeField(requiredQueue, (name) => {
                        const definition = definitionMap.get(name);
                        const description = definition?.description || '';
                        return /email/i.test(name) || /email/i.test(description);
                    }) || takeField(optionalQueue, (name) => {
                        const definition = definitionMap.get(name);
                        const description = definition?.description || '';
                        return /email/i.test(name) || /email/i.test(description);
                    })
                    : null;

                if (emailField) {
                    tryAssignToken(emailField, token);
                    continue;
                }

                const nextRequired = takeField(requiredQueue);
                if (nextRequired) {
                    tryAssignToken(nextRequired, token);
                    continue;
                }

                const nextOptional = takeField(optionalQueue);
                if (nextOptional) {
                    tryAssignToken(nextOptional, token);
                }
            }
        };

        if (skill.disableAutoTokenAssignment !== true) {
            assignUnlabeledTokens();
        }

        if (ambiguous.size) {
            console.warn(`The following arguments were not understood: ${Array.from(ambiguous).join(', ')}.`);
        }

            const pendingAfterManual = missingRequiredArgs();

            if (!pendingAfterManual.length) {
                break;
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

            humanPromptSections.push(`Missing argument names: ${JSON.stringify(pendingAfterManual)}`);
            const availableOptions = pendingAfterManual
                .map((name) => {
                    const options = optionMap.get(name);
                    if (!options || !options.length) {
                        return null;
                    }
                    const formatted = options.map(option => option.display).join(', ');
                    return `${name}: ${formatted}`;
                })
                .filter(Boolean);
            if (availableOptions.length) {
                humanPromptSections.push(`Available options:\n${availableOptions.join('\n')}`);
            }
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

            const pendingSet = new Set(pendingAfterManual);
            const invalidFromModel = new Set();
            let appliedFromModel = false;

            for (const [name, value] of Object.entries(parsedExtraction)) {
                if (!pendingSet.has(name)) {
                    continue;
                }
                if (value === undefined || value === null) {
                    continue;
                }
                const optionCheck = normalizeOptionValue(name, value);
                if (!optionCheck.valid) {
                    invalidFromModel.add(name);
                    continue;
                }
                if (optionMap.has(name)) {
                    normalizedArgs[name] = optionCheck.value;
                    appliedFromModel = true;
                    continue;
                }
                normalizedArgs[name] = value;
                appliedFromModel = true;
            }

            if (invalidFromModel.size) {
                console.warn(`The model returned unsupported options for arguments: ${Array.from(invalidFromModel).join(', ')}.`);
            }

            if (!appliedFromModel) {
                console.warn('Unable to determine values for the remaining arguments. Please provide them again.');
            }
        }
    };

    const isSensitiveName = (name) => typeof name === 'string' && /(password|secret|token|key)/i.test(name);

    const formatSummaryValue = (name, value) => {
        if (value === undefined) {
            return '(not provided)';
        }
        if (value === null) {
            return 'null';
        }
        if (typeof value === 'string') {
            if (!value.length) {
                return '(empty string)';
            }
            if (isSensitiveName(name)) {
                return '********';
            }
            return value;
        }
        if (typeof value === 'number' || typeof value === 'boolean') {
            return String(value);
        }
        try {
            return JSON.stringify(value);
        } catch (error) {
            return String(value);
        }
    };

    const buildConfirmationSummary = () => {
        const descriptor = skill.humanDescription || skill.description || skill.what || skill.name;
        const heading = descriptor && descriptor !== skill.name
            ? `About to execute '${skill.name}': ${descriptor}`
            : `About to execute '${skill.name}'.`;
        const lines = [heading];

        const summaryNames = argumentDefinitions.length
            ? argumentDefinitions.map((def) => def?.name).filter(Boolean)
            : Array.from(new Set([
                ...Object.keys(normalizedArgs),
                ...allArgumentNames,
                ...requiredArgs,
                ...optionalArgumentNames,
            ])).filter(Boolean);

        if (!summaryNames.length) {
            lines.push('Arguments: (none)');
            return lines.join('\n');
        }

        lines.push('Arguments:');
        for (const name of summaryNames) {
            const value = Object.prototype.hasOwnProperty.call(normalizedArgs, name)
                ? normalizedArgs[name]
                : undefined;
            lines.push(`  - ${name}: ${formatSummaryValue(name, value)}`);
        }

        return lines.join('\n');
    };

    const requestArgumentEdits = async () => {
        const editTargets = parseableArgumentNames.length
            ? parseableArgumentNames
            : Array.from(new Set([
                ...argumentDefinitions.map((def) => def?.name).filter(Boolean),
                ...Object.keys(normalizedArgs),
                ...requiredArgs,
                ...optionalArgumentNames,
            ])).filter(Boolean);

        if (!editTargets.length) {
            return 'unchanged';
        }

        const editInput = await readUserPrompt('Enter updates (e.g., "password newPass role Admin") or press Enter to keep current values:\n');
        const trimmedEdit = typeof editInput === 'string' ? editInput.trim() : '';

        if (!trimmedEdit) {
            return 'unchanged';
        }

        const { resolved: updates, invalid: invalidUpdates } = parseNamedArguments(trimmedEdit, editTargets);
        const updatesObject = Object.fromEntries(updates);
        const applyResult = applyUpdatesMap(updatesObject);

        if (invalidUpdates.size) {
            console.warn(`The following arguments were not understood: ${Array.from(invalidUpdates).join(', ')}.`);
        }

        return applyResult;
    };

    if (taskDescription && typeof taskDescription === 'string' && taskDescription.trim()) {
        prefillFromTaskDescription(taskDescription);
    }

    await autofillWithLanguageModel();
    applyDescriptionDefaults();

    let needsArgumentCollection = true;

    while (true) {
        if (needsArgumentCollection) {
            await collectMissingArguments();
            needsArgumentCollection = false;
        }

        if (skipConfirmation || !skill.needConfirmation) {
            break;
        }

        const summary = buildConfirmationSummary();
        const confirmationInput = await readUserPrompt(`${summary}\nGo ahead, edit, or cancel?\n`);
        const normalizedResponse = typeof confirmationInput === 'string' ? confirmationInput.trim().toLowerCase() : '';

        const affirmatives = new Set(['y', 'yes', 'ok', 'sure', 'do it', 'go ahead', 'proceed']);
        const negatives = new Set(['c', 'cancel', 'n', 'no', 'stop', 'abort', 'never mind']);
        const edits = new Set(['e', 'edit', 'change', 'update', 'adjust']);

        if (!normalizedResponse || affirmatives.has(normalizedResponse)) {
            break;
        }

        if (negatives.has(normalizedResponse)) {
            throw new Error('Skill execution cancelled by user.');
        }

        if (edits.has(normalizedResponse)) {
            const editResult = await requestArgumentEdits();
            if (editResult === 'needsMissing') {
                needsArgumentCollection = true;
            }
            continue;
        }

        const interpreted = await interpretConfirmationResponse(confirmationInput, summary);
        if (interpreted && interpreted.action) {
            const action = interpreted.action;
            if (action === 'confirm' || action === 'yes' || action === 'proceed') {
                break;
            }
            if (action === 'cancel' || action === 'stop' || action === 'abort') {
                throw new Error('Skill execution cancelled by user.');
            }
            if (action === 'edit') {
                if (interpreted.updates && Object.keys(interpreted.updates).length) {
                    const editResult = applyUpdatesMap(interpreted.updates);
                    if (editResult === 'needsMissing') {
                        needsArgumentCollection = true;
                    } else if (editResult === 'unchanged') {
                        console.log('I could not apply those changes. Let’s try again together.');
                        const manualResult = await requestArgumentEdits();
                        if (manualResult === 'needsMissing') {
                            needsArgumentCollection = true;
                        }
                    }
                    continue;
                }
                const manualResult = await requestArgumentEdits();
                if (manualResult === 'needsMissing') {
                    needsArgumentCollection = true;
                }
                continue;
            }
        }

        console.log("Please answer in your own words—for example 'yes', 'edit', or 'cancel'.");
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

export {
    executeSkill,
};
