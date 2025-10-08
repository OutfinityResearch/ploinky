import assert from 'node:assert';

process.env.PLOINKY_SKIP_BUILTIN_PROVIDERS = '1';

const { default: SkillRegistry } = await import('ploinky-agent-lib/skills/SkillRegistry.mjs');
const { Agent, __resetForTests } = await import('ploinky-agent-lib');
const {
    __setCallLLMWithModelForTests,
    __resetCallLLMWithModelForTests,
} = await import('ploinky-agent-lib/LLMClient.mjs');

const registry = new SkillRegistry();

__setCallLLMWithModelForTests(async (modelName, history) => {
    const last = history.at(-1)?.message || '';
    if (typeof last === 'string' && last.includes('Return a JSON object containing values for the missing argument names')) {
        return JSON.stringify({ role: 'ProjectManager', givenName: 'Jhon', familyName: 'Smith' });
    }
    if (typeof last === 'string' && last.includes('Respond ONLY with JSON like')) {
        return JSON.stringify({ action: 'confirm' });
    }
    return '{}';
});

const parseJsonSpec = {
    why: 'Frequently need to turn JSON strings into rich objects for downstream tasks.',
    what: 'Parse JSON content',
    description: 'Parses a JSON string and returns the resulting JavaScript object.',
    name: 'parse-json',
    arguments: {
        json: { type: 'string', description: 'The JSON blob to parse.' },
    },
    requiredArguments: ['json'],
};

const sendEmailSpec = {
    why: 'Communicate updates to stakeholders via email.',
    what: 'Send notification email',
    description: 'Composes and sends an email using the configured SMTP transport.',
    name: 'send-email',
    arguments: {
        to: { type: 'string', description: 'Destination address.' },
        subject: { type: 'string', description: 'Email subject line.' },
        body: { type: 'string', description: 'Message body.' },
    },
    requiredArguments: ['to', 'subject', 'body'],
};

const parseJsonAction = (jsonText) => JSON.parse(jsonText);
const sendEmailAction = () => 'email sent';

const parseSkillName = registry.registerSkill({ specs: parseJsonSpec, roles: ['Analyst'], action: parseJsonAction });
const emailSkillName = registry.registerSkill({ specs: sendEmailSpec, roles: ['admin', 'communication'], action: sendEmailAction });

const provideExecutionModes = () => ([
    { label: 'Fast Path', value: 'fast' },
    { label: 'Deep Path', value: 'deep' },
]);

const optionsSpec = {
    why: 'Validate option wiring.',
    what: 'Return provided options',
    description: 'Simple spec used to confirm per-argument option providers.',
    name: 'with-options',
    arguments: {
        mode: { type: '%provideExecutionModes', description: 'Execution mode.' },
    },
    requiredArguments: ['mode'],
};

const optionsSkillName = registry.registerSkill({
    specs: optionsSpec,
    roles: ['analyst'],
    action: () => 'noop',
    provideExecutionModes,
});

assert.strictEqual(parseSkillName, parseJsonSpec.name, 'registerSkill should return the canonical skill name.');
assert.ok(typeof registry.getSkillAction(parseSkillName) === 'function', 'Stored actions should be retrievable.');
assert.deepStrictEqual(registry.getSkill(parseSkillName).roles, ['analyst'], 'Roles should be normalized and stored.');
assert.deepStrictEqual(registry.getSkill(emailSkillName).roles, ['admin', 'communication'], 'Explicit roles should be stored with the skill.');

const optionsSkillRecord = registry.getSkill(optionsSkillName);
assert.ok(optionsSkillRecord?.argumentMetadata?.mode, 'Argument metadata should be populated.');
assert.ok(typeof optionsSkillRecord.argumentMetadata.mode.enumerator === 'function', 'Mode argument should expose its enumerator.');
assert.deepStrictEqual(await optionsSkillRecord.argumentMetadata.mode.enumerator(), provideExecutionModes(), 'Enumerator should return the expected options payload.');

const parseMatches = registry.rankSkill('Need to parse a JSON payload for further analysis.', { role: 'analyst' });
assert.ok(parseMatches.length >= 1, 'Expected at least one skill match for JSON parsing.');
assert.strictEqual(parseMatches[0], parseSkillName, 'Parse skill should be the most relevant suggestion.');

const scoredMatches = registry.rankSkill('Need to parse a JSON payload for further analysis.', { role: 'analyst', includeScores: true });
assert.ok(Array.isArray(scoredMatches) && scoredMatches.length > 0, 'Scored FlexSearch results should return an array.');
assert.strictEqual(scoredMatches[0]?.name, parseSkillName, 'Top scored skill should match the leading string result.');
assert.strictEqual(typeof scoredMatches[0]?.score, 'number', 'Scored results should provide a numeric confidence score.');

const emailMatches = registry.rankSkill('notify the user by sending an email report', { role: 'admin' });
assert.ok(emailMatches.includes(emailSkillName), 'Email skill should match email related queries.');

const forbiddenMatches = registry.rankSkill('Need to parse a JSON payload for further analysis.', { role: 'admin' });
assert.ok(!forbiddenMatches.includes(parseSkillName), 'Roles without access should not see restricted skills.');

const noMatches = registry.rankSkill('', { role: 'analyst' });
assert.deepStrictEqual(noMatches, [], 'Empty search text should return no matches.');

__resetForTests();
const agent = new Agent();
const promptQueue = [];
agent.readUserPrompt = async () => (promptQueue.length > 0 ? promptQueue.shift() : '');
const agentParseSkillName = agent.registerSkill({ specs: parseJsonSpec, roles: ['analyst'], action: parseJsonAction });
await assert.rejects(() => agent.rankSkill('Please parse this json configuration string', { role: 'admin' }), /No skills matched/, 'Agent should deny access for roles without permission.');
const agentMatch = await agent.rankSkill('Please parse this json configuration string', { role: 'analyst' });
assert.strictEqual(agentMatch, agentParseSkillName, 'Agent-based ranking should surface registered skills.');

const executor = agent.getSkillAction(agentParseSkillName);
const parsed = executor('{"value":42}');
assert.deepStrictEqual(parsed, { value: 42 }, 'Retrieved skill action should execute correctly.');

promptQueue.push('y');
const useSkillResult = await agent.useSkill(agentParseSkillName, { json: '{"value":99}' });
assert.deepStrictEqual(useSkillResult, { value: 99 }, 'useSkill should execute the registered action when required arguments are provided.');

const listOutputFormats = () => ([
    { value: 'compact', label: 'compact', description: 'No whitespace in the output.' },
    { value: 'pretty', label: 'pretty', description: 'Nicely formatted output.' },
    'raw',
]);

const parseJsonWithFormatSpec = {
    ...parseJsonSpec,
    name: 'parse-json-with-format',
    arguments: {
        json: { ...parseJsonSpec.arguments.json },
        format: {
            type: '%listOutputFormats',
            description: 'Optional output format.',
            llmHint: 'suggest json output formats helper skill',
        },
    },
    requiredArguments: ['json'],
};

const parseJsonWithFormatAction = (jsonText, format) => ({ parsed: JSON.parse(jsonText), format });
const parseJsonWithFormatSkill = agent.registerSkill({
    specs: parseJsonWithFormatSpec,
    roles: ['analyst'],
    action: parseJsonWithFormatAction,
    listOutputFormats,
});

const formatSuggestionSpec = {
    why: 'Help the agent present ready-to-use format options.',
    what: 'Suggest JSON output formats',
    description: 'Suggest JSON output formats helper skill that returns a list of recommended identifiers.',
    name: 'json-format-suggestions',
    arguments: {},
    requiredArguments: [],
};

const formatSuggestionAction = () => ([
    { value: 'compact', label: 'compact', description: 'No whitespace in the output.' },
    { value: 'pretty', label: 'pretty', description: 'Nicely formatted output.' },
    'raw',
]);

agent.registerSkill({ specs: formatSuggestionSpec, roles: ['analyst'], action: formatSuggestionAction });

const optionalArgsResult = await agent.useSkill(parseJsonWithFormatSkill, { json: '{"value":55}' });
assert.deepStrictEqual(optionalArgsResult, { parsed: { value: 55 }, format: undefined }, 'Optional arguments should remain undefined when skipped.');

promptQueue.length = 0;
promptQueue.push('{"value":123}', '', 'y');
const promptedArgsResult = await agent.useSkill(parseJsonWithFormatSkill, {});
assert.deepStrictEqual(promptedArgsResult, { parsed: { value: 123 }, format: undefined }, 'Missing required arguments should be collected interactively.');

promptQueue.length = 0;
promptQueue.push('{"value":987} pretty');
const suggestionSelectionResult = await agent.useSkill(parseJsonWithFormatSkill, {});
assert.deepStrictEqual(suggestionSelectionResult, { parsed: { value: 987 }, format: 'pretty' }, 'Selecting a suggestion should populate the argument with the helper-provided value.');

const validateUsername = (value) => {
    if (typeof value !== 'string') {
        return false;
    }
    const trimmed = value.trim();
    if (!trimmed.length) {
        return false;
    }
    return { valid: true, value: trimmed };
};

const validatePassword = (value) => typeof value === 'string' && value.trim().length >= 6;

const validateGivenName = (value) => {
    if (typeof value !== 'string') {
        return false;
    }
    const trimmed = value.trim();
    if (!trimmed.length) {
        return false;
    }
    return { valid: true, value: trimmed };
};

const listUserRoles = () => ([
    { label: 'SystemAdmin', description: 'Manages the entire platform.', value: 'SystemAdmin' },
    { label: 'ProjectManager', description: 'Oversees project inventory.', value: 'ProjectManager' },
]);

const addUserSpec = {
    name: 'add-user',
    description: 'Add a new user.',
    needConfirmation: true,
    arguments: {
        username: { type: '@validateUsername', description: 'Username for the new user.' },
        password: { type: '@validatePassword', description: 'Password for the new user.' },
        role: { type: '%listUserRoles', description: 'Role assigned to the user.' },
        givenName: { type: '@validateGivenName', description: 'Given name of the new user.' },
        familyName: { type: 'string', description: 'Family name of the new user.' },
    },
    requiredArguments: ['username', 'password', 'role', 'givenName'],
};

const addUserAction = ({ username, password, role, givenName, familyName } = {}) => ({
    username,
    password,
    role,
    givenName,
    familyName,
});

promptQueue.length = 0;

agent.registerSkill({
    specs: addUserSpec,
    roles: ['systemadmin'],
    action: addUserAction,
    listUserRoles,
    validateUsername,
    validatePassword,
    validateGivenName,
});

promptQueue.length = 0;
promptQueue.push('username jsmith password s3cret', 'y');
const autoprefillResult = await agent.useSkill('add-user', {}, { taskDescription: 'add new project manager jhon smith' });
assert.deepStrictEqual(
    autoprefillResult,
    {
        username: 'jsmith',
        password: 's3cret',
        role: 'ProjectManager',
        givenName: 'Jhon',
        familyName: 'Smith',
    },
    'Task description should prefill role and names before prompting for the remaining arguments.',
);

promptQueue.length = 0;
promptQueue.push('username asmith password firstpass', 'e', 'password betterpass', 'y');
const editedResult = await agent.useSkill('add-user', {}, { taskDescription: 'add new system admin alice smith' });
assert.deepStrictEqual(
    editedResult,
    {
        username: 'asmith',
        password: 'betterpass',
        role: 'SystemAdmin',
        givenName: 'Alice',
        familyName: 'Smith',
    },
    'Editing after the confirmation prompt should update arguments before execution.',
);

promptQueue.length = 0;
promptQueue.push('username skipuser password skipsecret role SystemAdmin givenName Skip familyName Confirmed');
const skipConfirmationResult = await agent.useSkill('add-user', {}, { taskDescription: 'add skip confirmation user', skipConfirmation: true });
assert.deepStrictEqual(
    skipConfirmationResult,
    {
        username: 'skipuser',
        password: 'skipsecret',
        role: 'SystemAdmin',
        givenName: 'Skip',
        familyName: 'Confirmed',
    },
    'skipConfirmation should bypass the confirmation prompt and retain provided arguments.',
);

agent.clearSkills();
await assert.rejects(() => agent.rankSkill('parse some json again', { role: 'analyst' }), /No skills matched/, 'Clearing skills should surface a missing skill error.');

__resetCallLLMWithModelForTests();

console.log('skillRegistry test passed');
