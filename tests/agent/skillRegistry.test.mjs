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

assert.strictEqual(parseSkillName, parseJsonSpec.name, 'registerSkill should return the canonical skill name.');
assert.ok(typeof registry.getSkillAction(parseSkillName) === 'function', 'Stored actions should be retrievable.');
assert.deepStrictEqual(registry.getSkill(parseSkillName).roles, ['analyst'], 'Roles should be normalized and stored.');
assert.deepStrictEqual(registry.getSkill(emailSkillName).roles, ['admin', 'communication'], 'Explicit roles should be stored with the skill.');

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
const agentParseSkillName = agent.registerSkill({ specs: parseJsonSpec, roles: ['analyst'], action: parseJsonAction });
await assert.rejects(() => agent.rankSkill('Please parse this json configuration string', { role: 'admin' }), /No skills matched/, 'Agent should deny access for roles without permission.');
const agentMatch = await agent.rankSkill('Please parse this json configuration string', { role: 'analyst' });
assert.strictEqual(agentMatch, agentParseSkillName, 'Agent-based ranking should surface registered skills.');

const executor = agent.getSkillAction(agentParseSkillName);
const parsed = executor('{"value":42}');
assert.deepStrictEqual(parsed, { value: 42 }, 'Retrieved skill action should execute correctly.');

const useSkillResult = await agent.useSkill(agentParseSkillName, { json: '{"value":99}' });
assert.deepStrictEqual(useSkillResult, { value: 99 }, 'useSkill should execute the registered action when required arguments are provided.');

agent.clearSkills();
await assert.rejects(() => agent.rankSkill('parse some json again', { role: 'analyst' }), /No skills matched/, 'Clearing skills should surface a missing skill error.');

console.log('skillRegistry test passed');
