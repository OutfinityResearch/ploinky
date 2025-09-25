import assert from 'node:assert';

import SkillRegistry from '../../Agent/AgentLib/skills/SkillRegistry.mjs';
import { Agent, __resetForTests } from '../../Agent/AgentLib/AgentLib.mjs';

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

const parseSkillId = registry.registerSkill(parseJsonSpec, parseJsonAction);
const emailSkillId = registry.registerSkill(sendEmailSpec, sendEmailAction);

assert.ok(typeof parseSkillId === 'string' && parseSkillId.length > 0, 'Skill IDs should be non-empty strings.');
assert.ok(typeof registry.getSkillAction(parseSkillId) === 'function', 'Stored actions should be retrievable.');

const parseMatches = registry.rankSkill('Need to parse a JSON payload for further analysis.');
assert.ok(parseMatches.length >= 1, 'Expected at least one skill match for JSON parsing.');
assert.strictEqual(parseMatches[0], parseSkillId, 'Parse skill should be the most relevant suggestion.');

const emailMatches = registry.rankSkill('notify the user by sending an email report');
assert.ok(emailMatches.includes(emailSkillId), 'Email skill should match email related queries.');

const noMatches = registry.rankSkill('');
assert.deepStrictEqual(noMatches, [], 'Empty search text should return no matches.');

__resetForTests();
const agent = new Agent();
const agentParseSkillId = agent.registerSkill(parseJsonSpec, parseJsonAction);
const agentMatches = agent.rankSkill('Please parse this json configuration string');
assert.strictEqual(agentMatches[0], agentParseSkillId, 'Agent-based ranking should surface registered skills.');

const executor = agent.getSkillAction(agentParseSkillId);
const parsed = executor('{"value":42}');
assert.deepStrictEqual(parsed, { value: 42 }, 'Retrieved skill action should execute correctly.');

const useSkillResult = await agent.useSkill(agentParseSkillId, { json: '{"value":99}' });
assert.deepStrictEqual(useSkillResult, { value: 99 }, 'useSkill should execute the registered action when required arguments are provided.');

agent.clearSkills();
assert.deepStrictEqual(agent.rankSkill('parse some json again'), [], 'Clearing skills should remove results.');

console.log('skillRegistry test passed');
