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

    const tokensFrom = (input) => {
        if (input === null || input === undefined) {
            return [];
        }
        const stringValue = typeof input === 'string' ? input : stringifyOptionValue(input);
        const spaced = stringValue
            .replace(/[_-]+/g, ' ')
            .replace(/([a-z])([A-Z])/g, '$1 $2');
        return spaced
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .split(' ')
            .map(token => token.trim())
            .filter(Boolean);
    };

    const findTokenSequence = (tokens, sequence, options = {}) => {
        if (!Array.isArray(tokens) || !Array.isArray(sequence) || sequence.length === 0) {
            return -1;
        }
        const maxStart = tokens.length - sequence.length;
        if (maxStart < 0) {
            return -1;
        }
        const skipUsed = options?.skipUsed === true;
        const usedIndices = skipUsed && options?.usedTokenIndexes instanceof Set
            ? options.usedTokenIndexes
            : null;
        for (let start = 0; start <= maxStart; start += 1) {
            if (usedIndices) {
                let conflicts = false;
                for (let offset = 0; offset < sequence.length; offset += 1) {
                    if (usedIndices.has(start + offset)) {
                        conflicts = true;
                        break;
                    }
                }
                if (conflicts) {
                    continue;
                }
            }
            let matches = true;
            for (let offset = 0; offset < sequence.length; offset += 1) {
                if (tokens[start + offset] !== sequence[offset]) {
                    matches = false;
                    break;
                }
            }
            if (matches) {
                return start;
            }
        }
        return -1;
    };

    const capitalizeWord = (token) => {
        if (typeof token !== 'string' || token.length === 0) {
            return token;
        }
        const lower = token.toLowerCase();
        return lower.charAt(0).toUpperCase() + lower.slice(1);
    };

    const prefillFromTaskDescription = (rawDescription) => {
        if (typeof rawDescription !== 'string') {
            return;
        }
        const trimmed = rawDescription.trim();
        if (!trimmed) {
            return;
        }

        const preferredTargets = allArgumentNames.length
            ? allArgumentNames
            : (requiredArgs.length ? requiredArgs : []);
        const candidateNames = preferredTargets.length ? preferredTargets : missingRequiredArgs();
        if (candidateNames.length) {
            const { resolved: fromDescription } = parseNamedArguments(trimmed, candidateNames);
            for (const [name, value] of fromDescription.entries()) {
                if (!hasArgumentValue(name)) {
                    normalizedArgs[name] = value;
                }
            }
        }

        const rawTokens = trimmed.match(/[A-Za-z0-9']+/g);
        if (!rawTokens || !rawTokens.length) {
            return;
        }

        const lowerTokens = rawTokens.map(token => token.toLowerCase());
        const usedTokenIndexes = new Set();
        const anchorPoints = [];

        const addAnchor = (index) => {
            if (typeof index === 'number' && Number.isFinite(index)) {
                const clamped = Math.max(0, Math.min(index, lowerTokens.length));
                anchorPoints.push(clamped);
            }
        };

        const markIndexes = (indexes) => {
            if (!Array.isArray(indexes)) {
                return;
            }
            for (const index of indexes) {
                usedTokenIndexes.add(index);
            }
        };

        const STOP_WORDS = new Set(['with', 'using', 'by', 'for', 'to', 'from', 'of', 'on', 'at', 'the', 'a', 'an', 'then', 'please', 'via', 'into', 'in', 'as', 'named', 'called', 'set', 'value', 'values', 'be', 'should', 'need', 'needs', 'type', 'kind', 'make', 'create', 'add', 'new']);
        const TRUE_TOKENS = new Set(['true', 'yes', 'y', '1', 'enable', 'enabled', 'allow', 'allowed']);
        const FALSE_TOKENS = new Set(['false', 'no', 'n', '0', 'disable', 'disabled', 'deny', 'denied']);

        const getDefinition = (name) => argumentDefinitions.find((arg) => arg.name === name) || { name };

        const isNameLike = (definition) => {
            const tokens = new Set([
                ...tokensFrom(definition?.name),
                ...tokensFrom(definition?.description),
            ]);
            return tokens.has('name')
                || tokens.has('firstname')
                || tokens.has('lastname')
                || tokens.has('given')
                || tokens.has('family')
                || tokens.has('surname')
                || tokens.has('fullname')
                || tokens.has('title');
        };

        const determineMaxWords = (definition) => {
            const type = typeof definition?.type === 'string' ? definition.type.toLowerCase() : '';
            if (type === 'boolean' || type === 'number' || type === 'integer') {
                return 1;
            }
            if (type === 'date' || type === 'datetime') {
                return 3;
            }
            if (!type || type === 'string') {
                return isNameLike(definition) ? 1 : 5;
            }
            return null;
        };

        const normalizeStringTokens = (tokens, definition) => {
            if (!tokens.length) {
                return tokens;
            }
            if (isNameLike(definition)) {
                return tokens.map(capitalizeWord);
            }
            return tokens;
        };

        const convertTokensToValue = (name, tokens, definition) => {
            if (!tokens.length) {
                return { applied: false };
            }

            const type = typeof definition?.type === 'string' ? definition.type.toLowerCase() : '';

            if (optionMap.has(name)) {
                const raw = tokens.join(' ');
                const normalized = normalizeOptionValue(name, raw);
                if (!normalized.valid) {
                    return { applied: false };
                }
                return { applied: true, value: normalized.value };
            }

            if (type === 'boolean') {
                const firstToken = tokens[0].toLowerCase();
                if (TRUE_TOKENS.has(firstToken)) {
                    return { applied: true, value: true };
                }
                if (FALSE_TOKENS.has(firstToken)) {
                    return { applied: true, value: false };
                }
                return { applied: false };
            }

            if (type === 'number' || type === 'integer') {
                const numeric = Number(tokens[0]);
                if (!Number.isFinite(numeric)) {
                    return { applied: false };
                }
                const value = type === 'integer' ? Math.trunc(numeric) : numeric;
                return { applied: true, value };
            }

            if (type === 'array') {
                const joined = tokens.join(' ');
                return { applied: true, value: [coerceScalarValue(joined)] };
            }

            const processedTokens = normalizeStringTokens(tokens, definition);
            const raw = processedTokens.join(' ');
            return { applied: true, value: coerceScalarValue(raw) };
        };

        const collectPhrase = (startIndex, definition, maxWordsOverride = null) => {
            const tokens = [];
            const indexes = [];
            let idx = Math.max(0, startIndex);
            const maxWords = typeof maxWordsOverride === 'number' && maxWordsOverride > 0
                ? maxWordsOverride
                : determineMaxWords(definition);
            while (idx < rawTokens.length) {
                if (usedTokenIndexes.has(idx)) {
                    idx += 1;
                    continue;
                }
                const lower = lowerTokens[idx];
                if (!tokens.length && STOP_WORDS.has(lower)) {
                    idx += 1;
                    continue;
                }
                if (tokens.length && STOP_WORDS.has(lower)) {
                    break;
                }
                tokens.push(rawTokens[idx]);
                indexes.push(idx);
                idx += 1;
                if (maxWords && tokens.length >= maxWords) {
                    break;
                }
            }
            return { tokens, indexes };
        };

        const collectPhraseBefore = (startIndex, definition) => {
            const tokens = [];
            const indexes = [];
            let idx = startIndex - 1;
            const maxWords = determineMaxWords(definition);
            while (idx >= 0) {
                if (usedTokenIndexes.has(idx)) {
                    idx -= 1;
                    continue;
                }
                const lower = lowerTokens[idx];
                if (!tokens.length && STOP_WORDS.has(lower)) {
                    idx -= 1;
                    continue;
                }
                if (tokens.length && STOP_WORDS.has(lower)) {
                    break;
                }
                tokens.unshift(rawTokens[idx]);
                indexes.unshift(idx);
                idx -= 1;
                if (maxWords && tokens.length >= maxWords) {
                    break;
                }
            }
            return { tokens, indexes };
        };

        const applyPhrase = (name, phrase, definition) => {
            if (!phrase.tokens.length) {
                return false;
            }
            const result = convertTokensToValue(name, phrase.tokens, definition);
            if (!result.applied) {
                return false;
            }
            normalizedArgs[name] = result.value;
            markIndexes(phrase.indexes);
            return true;
        };

        const sequencesForDefinition = (definition) => {
            const sequences = [];
            const addSequence = (tokens) => {
                const filtered = tokens.filter(Boolean);
                if (filtered.length) {
                    sequences.push(filtered);
                }
            };
            addSequence(tokensFrom(definition?.name));
            if (typeof definition?.description === 'string') {
                addSequence(tokensFrom(definition.description));
            }
            if (Array.isArray(definition?.aliases)) {
                for (const alias of definition.aliases) {
                    addSequence(tokensFrom(alias));
                }
            }
            if (Array.isArray(definition?.keywords)) {
                for (const keyword of definition.keywords) {
                    addSequence(tokensFrom(keyword));
                }
            }
            if (typeof definition?.short === 'string') {
                addSequence(tokensFrom(definition.short));
            }
            sequences.sort((a, b) => b.length - a.length);
            return sequences;
        };

        const markSequence = (start, length) => {
            for (let offset = 0; offset < length; offset += 1) {
                usedTokenIndexes.add(start + offset);
            }
        };

        for (const [argName, options] of optionMap.entries()) {
            if (hasArgumentValue(argName) || !options || !options.length) {
                continue;
            }
            for (const option of options) {
                const sequences = [
                    tokensFrom(option.value),
                    tokensFrom(option.label),
                    tokensFrom(option.display),
                ].filter(sequence => sequence.length);

                for (const sequence of sequences) {
                    const matchIndex = findTokenSequence(lowerTokens, sequence, {
                        skipUsed: true,
                        usedTokenIndexes,
                    });
                    if (matchIndex === -1) {
                        continue;
                    }
                    const normalized = normalizeOptionValue(argName, option.value);
                    if (normalized.valid && !hasArgumentValue(argName)) {
                        normalizedArgs[argName] = normalized.value;
                        markSequence(matchIndex, sequence.length);
                        addAnchor(matchIndex + sequence.length);
                    }
                    break;
                }

                if (hasArgumentValue(argName)) {
                    break;
                }
            }
        }

        const candidateArgNames = (allArgumentNames.length ? allArgumentNames : requiredArgs).filter(Boolean);
        const definitionsByName = new Map(candidateArgNames.map(name => [name, getDefinition(name)]));

        const tryDescriptorMatch = (name) => {
            if (hasArgumentValue(name)) {
                return;
            }
            const definition = definitionsByName.get(name);
            const sequences = sequencesForDefinition(definition);
            for (const sequence of sequences) {
                const matchIndex = findTokenSequence(lowerTokens, sequence, {
                    skipUsed: true,
                    usedTokenIndexes,
                });
                if (matchIndex === -1) {
                    continue;
                }
                const afterPhrase = collectPhrase(matchIndex + sequence.length, definition);
                if (applyPhrase(name, afterPhrase, definition)) {
                    markSequence(matchIndex, sequence.length);
                    addAnchor(matchIndex + sequence.length);
                    return;
                }
                const beforePhrase = collectPhraseBefore(matchIndex, definition);
                if (applyPhrase(name, beforePhrase, definition)) {
                    markSequence(matchIndex, sequence.length);
                    return;
                }
            }
        };

        for (const name of candidateArgNames) {
            tryDescriptorMatch(name);
        }

        const collectFromAnchor = (definition) => {
            if (!isNameLike(definition)) {
                return { tokens: [], indexes: [] };
            }
            for (const anchor of anchorPoints) {
                const phrase = collectPhrase(anchor, definition);
                if (phrase.tokens.length) {
                    return phrase;
                }
            }
            return { tokens: [], indexes: [] };
        };

        const collectFromAnywhere = (definition) => {
            if (!isNameLike(definition)) {
                return { tokens: [], indexes: [] };
            }
            for (let idx = 0; idx < rawTokens.length; idx += 1) {
                if (usedTokenIndexes.has(idx)) {
                    continue;
                }
                const phrase = collectPhrase(idx, definition);
                if (phrase.tokens.length) {
                    return phrase;
                }
            }
            return { tokens: [], indexes: [] };
        };

        for (const name of candidateArgNames) {
            if (hasArgumentValue(name)) {
                continue;
            }
            const definition = definitionsByName.get(name);
            if (!isNameLike(definition)) {
                continue;
            }
            let phrase = collectFromAnchor(definition);
            if (!phrase.tokens.length) {
                phrase = collectFromAnywhere(definition);
            }
            if (phrase.tokens.length) {
                applyPhrase(name, phrase, definition);
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

            promptSections.push("Provide values (or type 'cancel' to abort): ");

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

        const editInput = await readUserPrompt('Enter updates (e.g., "password newPass role Admin") or press Enter to keep current values: ');
        const trimmedEdit = typeof editInput === 'string' ? editInput.trim() : '';

        if (!trimmedEdit) {
            return 'unchanged';
        }

        const { resolved: updates, invalid: invalidUpdates } = parseNamedArguments(trimmedEdit, editTargets);

        for (const [name, value] of updates.entries()) {
            normalizedArgs[name] = value;
        }

        if (invalidUpdates.size) {
            console.warn(`The following arguments were not understood: ${Array.from(invalidUpdates).join(', ')}.`);
        }

        return missingRequiredArgs().length > 0 ? 'needsMissing' : 'updated';
    };

    if (taskDescription && typeof taskDescription === 'string' && taskDescription.trim()) {
        prefillFromTaskDescription(taskDescription);
    }

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
        const confirmationInput = await readUserPrompt(`${summary}\nProceed? [y]es / [e]dit / [c]ancel: `);
        const normalizedResponse = typeof confirmationInput === 'string' ? confirmationInput.trim().toLowerCase() : '';

        if (!normalizedResponse || normalizedResponse === 'y' || normalizedResponse === 'yes') {
            break;
        }

        if (normalizedResponse === 'c' || normalizedResponse === 'cancel' || normalizedResponse === 'n' || normalizedResponse === 'no') {
            throw new Error('Skill execution cancelled by user.');
        }

        if (normalizedResponse === 'e' || normalizedResponse === 'edit' || normalizedResponse === 'change' || normalizedResponse === 'update') {
            const editResult = await requestArgumentEdits();
            if (editResult === 'needsMissing') {
                needsArgumentCollection = true;
            }
            continue;
        }

        console.log("Please respond with 'y', type 'edit' to adjust, or 'cancel' to abort.");
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
