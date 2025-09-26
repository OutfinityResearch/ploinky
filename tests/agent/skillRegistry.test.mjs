import assert from 'node:assert';

process.env.PLOINKY_SKIP_BUILTIN_PROVIDERS = '1';

const { default: SkillRegistry } = await import('../../Agent/AgentLib/skills/SkillRegistry.mjs');
const { Agent, __resetForTests } = await import('../../Agent/AgentLib/AgentLib.mjs');

const registry = new SkillRegistry();

const parseJsonSpec = {
    why: 'Frequently need to turn JSON strings into rich objects for downstream tasks.',
    what: 'Parse JSON content',
    description: 'Parses a JSON string and returns the resulting JavaScript object.',
    name: 'parse-json',
    args: [
        { name: 'json', type: 'string', description: 'The JSON blob to parse.' }
    ],
    requiredArgs: ['json'],
};

const sendEmailSpec = {
    why: 'Communicate updates to stakeholders via email.',
    what: 'Send notification email',
    description: 'Composes and sends an email using the configured SMTP transport.',
    name: 'send-email',
    args: [
        { name: 'to', type: 'string', description: 'Destination address.' },
        { name: 'subject', type: 'string', description: 'Email subject line.' },
        { name: 'body', type: 'string', description: 'Message body.' },
    ],
    requiredArgs: ['to', 'subject', 'body'],
};

const parseJsonAction = (jsonText) => JSON.parse(jsonText);
const sendEmailAction = () => 'email sent';

const parseSkillName = registry.registerSkill({ specs: parseJsonSpec, roles: ['Analyst'], action: parseJsonAction });
const emailSkillName = registry.registerSkill({ specs: sendEmailSpec, roles: ['admin', 'communication'], action: sendEmailAction });

const optionsSpec = {
    why: 'Validate option wiring.',
    what: 'Return provided options',
    description: 'Simple spec used to confirm getOptions registration.',
    name: 'with-options',
    args: [{ name: 'mode', type: 'string' }],
    requiredArgs: ['mode'],
};

const optionsProvider = () => ({ mode: [{ label: 'Fast Path', value: 'fast' }, { label: 'Deep Path', value: 'deep' }] });

const optionsSkillName = registry.registerSkill({ specs: optionsSpec, roles: ['analyst'], action: () => 'noop', getOptions: optionsProvider });

assert.strictEqual(parseSkillName, parseJsonSpec.name, 'registerSkill should return the canonical skill name.');
assert.ok(typeof registry.getSkillAction(parseSkillName) === 'function', 'Stored actions should be retrievable.');
assert.deepStrictEqual(registry.getSkill(parseSkillName).roles, ['analyst'], 'Roles should be normalized and stored.');
assert.deepStrictEqual(registry.getSkill(emailSkillName).roles, ['admin', 'communication'], 'Explicit roles should be stored with the skill.');
assert.ok(typeof registry.getSkillOptions(optionsSkillName) === 'function', 'getSkillOptions should return the registered provider.');
assert.deepStrictEqual(
    registry.getSkillOptions(optionsSkillName)(),
    optionsProvider(),
    'Option provider should return the expected options payload.',
);

const parseMatches = registry.rankSkill('Need to parse a JSON payload for further analysis.', { role: 'analyst' });
assert.ok(parseMatches.length >= 1, 'Expected at least one skill match for JSON parsing.');
assert.strictEqual(parseMatches[0], parseSkillName, 'Parse skill should be the most relevant suggestion.');

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

const parseJsonWithFormatSpec = {
    ...parseJsonSpec,
    name: 'parse-json-with-format',
    args: [
        { name: 'json', type: 'string', description: 'The JSON blob to parse.' },
        {
            name: 'format',
            type: 'string',
            description: 'Optional output format.',
            llmHint: 'suggest json output formats helper skill',
        },
    ],
    requiredArgs: ['json'],
};

const parseJsonWithFormatAction = (jsonText, format) => ({ parsed: JSON.parse(jsonText), format });
const parseJsonWithFormatSkill = agent.registerSkill({ specs: parseJsonWithFormatSpec, roles: ['analyst'], action: parseJsonWithFormatAction });

const formatSuggestionSpec = {
    why: 'Help the agent present ready-to-use format options.',
    what: 'Suggest JSON output formats',
    description: 'Suggest JSON output formats helper skill that returns a list of recommended identifiers.',
    name: 'json-format-suggestions',
    args: [],
    requiredArgs: [],
};

const formatSuggestionAction = () => ([
    { value: 'compact', label: 'compact', description: 'No whitespace in the output.' },
    { value: 'pretty', label: 'pretty', description: 'Nicely formatted output.' },
    'raw',
]);

agent.registerSkill({ specs: formatSuggestionSpec, roles: ['analyst'], action: formatSuggestionAction });

promptQueue.push('', 'y');
const optionalArgsResult = await agent.useSkill(parseJsonWithFormatSkill, { json: '{"value":55}' });
assert.deepStrictEqual(optionalArgsResult, { parsed: { value: 55 }, format: undefined }, 'Optional arguments should remain undefined when skipped.');

promptQueue.push('{"value":123}', '', 'y');
const promptedArgsResult = await agent.useSkill(parseJsonWithFormatSkill, {});
assert.deepStrictEqual(promptedArgsResult, { parsed: { value: 123 }, format: undefined }, 'Missing required arguments should be collected interactively.');

promptQueue.push('{"value":987}', '2', 'y');
const suggestionSelectionResult = await agent.useSkill(parseJsonWithFormatSkill, {});
assert.deepStrictEqual(suggestionSelectionResult, { parsed: { value: 987 }, format: 'pretty' }, 'Selecting a suggestion should populate the argument with the helper-provided value.');

const addUserSpec = {
    name: 'add-user',
    description: 'Add a new user.',
    needConfirmation: true,
    args: [
        { name: 'username', description: 'Username for the new user.' },
        { name: 'password', description: 'Password for the new user.' },
        { name: 'role', description: 'Role assigned to the user.' },
        { name: 'givenName', description: 'Given name of the new user.' },
        { name: 'familyName', description: 'Family name of the new user.' },
    ],
    requiredArgs: ['username', 'password', 'role', 'givenName'],
};

const addUserRoles = () => ({
    role: [
        { label: 'SystemAdmin - Manages the entire platform.', value: 'SystemAdmin' },
        { label: 'ProjectManager - Oversees project inventory.', value: 'ProjectManager' },
    ],
});

const addUserAction = ({ username, password, role, givenName, familyName } = {}) => ({
    username,
    password,
    role,
    givenName,
    familyName,
});

agent.registerSkill({ specs: addUserSpec, roles: ['systemadmin'], action: addUserAction, getOptions: addUserRoles });

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

console.log('skillRegistry test passed');
