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
        const pattern = new RegExp(`\\b(${candidateNames.map(escapeRegex).join('|')})\\b\\s*(?::|=)?\\s*("[^"]*"|'[^']*'|[^\s"']+)`, 'gi');

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

    const missingRequiredArgs = () => missingArgsFromList(requiredArgs);
    const missingOptionalArgs = () => missingArgsFromList(optionalArgumentNames);

    const describeArgument = (name) => {
        const definition = argumentDefinitions.find(arg => arg.name === name);
        const description = definition?.description ? `${name} (${definition.description})` : name;
        const options = optionMap.get(name);
        if (options && options.length) {
            const formatted = options.map(option => option.display).join(', ');
            return `${description} [options: ${formatted}]`;
        }
        return description;
    };

    const parseableArgumentNames = allArgumentNames.length
        ? allArgumentNames
        : (requiredArgs.length ? requiredArgs : []);

    let optionalPromptShown = false;

    while (missingRequiredArgs().length > 0) {
        const missingRequired = missingRequiredArgs();
        const missingOptional = optionalPromptShown ? [] : missingOptionalArgs();

        const requiredDescriptors = missingRequired.map(describeArgument);
        let promptText = `Missing required arguments: ${requiredDescriptors.join(', ')}`;

        if (missingOptional.length) {
            const optionalDescriptors = missingOptional.map(describeArgument);
            promptText += `. Optional arguments you may also set now: ${optionalDescriptors.join(', ')}`;
            optionalPromptShown = true;
        }

        const userInput = await readUserPrompt(`${promptText}. Provide values (or type 'cancel' to abort): `);
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
