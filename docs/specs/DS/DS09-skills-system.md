# DS09 - Skills System (AchillesLib)

## Summary

Ploinky integrates with AchillesAgentLib to provide LLM-powered skills. Skills are reusable, composable units of functionality that extend agent capabilities. This specification documents skill types, discovery, execution, and integration patterns.

## Background / Problem Statement

Agents need extensible capabilities that:
- Can be defined declaratively (markdown-based)
- Support multiple LLM providers
- Enable composition and orchestration
- Integrate with MCP tools and resources

## Goals

1. **Skill Types**: Support various skill types (Claude, CodeGen, Interactive, MCP, Orchestrator, DBTable)
2. **Discovery**: Automatic skill discovery in `.AchillesSkills/` directories
3. **Execution**: Reliable skill execution with LLM integration
4. **Composition**: Enable skill orchestration and chaining

## Non-Goals

- Custom skill runtime implementation
- Direct LLM API management (delegated to AchillesLib)
- Skill marketplace or sharing platform

## Architecture Overview

### Skills Integration

```
┌─────────────────────────────────────────────────────────────────┐
│                        AGENT CONTAINER                           │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                    AgentServer.mjs                          │ │
│  │  ┌───────────────┐  ┌───────────────┐  ┌────────────────┐  │ │
│  │  │  MCP Server   │  │ Skill Loader  │  │  LLM Client    │  │ │
│  │  └───────┬───────┘  └───────┬───────┘  └────────┬───────┘  │ │
│  │          │                  │                    │          │ │
│  │          ▼                  ▼                    ▼          │ │
│  │  ┌───────────────────────────────────────────────────────┐ │ │
│  │  │                 AchillesAgentLib                       │ │ │
│  │  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  │ │ │
│  │  │  │ skill   │  │ cgskill │  │ iskill  │  │ mskill  │  │ │ │
│  │  │  │ .md     │  │ .md     │  │ .md     │  │ .md     │  │ │ │
│  │  │  └─────────┘  └─────────┘  └─────────┘  └─────────┘  │ │ │
│  │  └───────────────────────────────────────────────────────┘ │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │              /.AchillesSkills/ (mounted from host)          │ │
│  │  ├── myskill.skill.md                                       │ │
│  │  ├── codegen.cgskill.md                                     │ │
│  │  ├── interactive.iskill.md                                  │ │
│  │  ├── mcptool.mskill.md                                      │ │
│  │  └── orchestrator.oskill.md                                 │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## Data Models

### Skill Types

| Extension | Type | Description |
|-----------|------|-------------|
| `.skill.md` | Claude | Simple Claude skill with system prompt |
| `.cgskill.md` | CodeGeneration | Execute generated JavaScript code |
| `.iskill.md` | Interactive | Multi-turn conversations |
| `.mskill.md` | MCP | Orchestrate MCP tools |
| `.oskill.md` | Orchestrator | Compose multiple skills |
| `.tskill.md` | DBTable | Database operations |

### Skill Definition Structure

```javascript
/**
 * Base skill definition (parsed from markdown)
 * @typedef {Object} SkillDefinition
 * @property {string} name - Skill name (from filename)
 * @property {string} type - Skill type (skill, cgskill, etc.)
 * @property {string} description - Skill description (first paragraph)
 * @property {string} systemPrompt - System prompt for LLM
 * @property {Object} parameters - Input parameters schema
 * @property {Object} [config] - Additional configuration
 */

/**
 * CodeGeneration skill specific fields
 * @typedef {Object} CGSkillDefinition
 * @extends SkillDefinition
 * @property {string} codeTemplate - JavaScript code template
 * @property {string[]} imports - Required imports
 * @property {Object} context - Execution context
 */

/**
 * MCP skill specific fields
 * @typedef {Object} MSkillDefinition
 * @extends SkillDefinition
 * @property {string[]} tools - MCP tools to use
 * @property {string} orchestration - Orchestration logic
 */
```

### Skill Markdown Format

```markdown
# Skill Name

Brief description of what this skill does.

## System Prompt

The system prompt that defines the skill's behavior.
This section is sent to the LLM as the system message.

## Parameters

- `param1` (string, required): Description of parameter 1
- `param2` (number, optional): Description of parameter 2

## Config

```json
{
  "model": "claude-3-opus",
  "temperature": 0.7,
  "maxTokens": 4096
}
```

## Examples

### Example 1: Basic usage
Input: ...
Output: ...
```

## API Contracts

### Skill Loader

```javascript
// Part of AchillesAgentLib

/**
 * Discover and load skills from directory
 * @param {string} skillsDir - Path to .AchillesSkills directory
 * @returns {Promise<Map<string, Skill>>} Map of skill name to skill instance
 */
export async function loadSkills(skillsDir) {
  const skills = new Map();
  const files = await fs.promises.readdir(skillsDir);

  for (const file of files) {
    const match = file.match(/^(.+)\.(skill|cgskill|iskill|mskill|oskill|tskill)\.md$/);
    if (match) {
      const [, name, type] = match;
      const content = await fs.promises.readFile(path.join(skillsDir, file), 'utf-8');
      const skill = parseSkill(name, type, content);
      skills.set(name, skill);
    }
  }

  return skills;
}

/**
 * Parse skill from markdown content
 * @param {string} name - Skill name
 * @param {string} type - Skill type
 * @param {string} content - Markdown content
 * @returns {Skill} Parsed skill object
 */
function parseSkill(name, type, content) {
  const sections = parseMarkdownSections(content);

  return {
    name,
    type,
    description: sections.description,
    systemPrompt: sections['system prompt'] || sections.description,
    parameters: parseParameters(sections.parameters),
    config: sections.config ? JSON.parse(sections.config) : {},
    examples: sections.examples
  };
}
```

### Skill Execution

```javascript
/**
 * Execute a skill
 * @param {string} skillName - Skill name
 * @param {Object} input - Input parameters
 * @param {Object} context - Execution context
 * @returns {Promise<SkillResult>}
 */
export async function executeSkill(skillName, input, context = {}) {
  const skill = skills.get(skillName);
  if (!skill) {
    throw new Error(`Skill '${skillName}' not found`);
  }

  // Validate input parameters
  validateParameters(input, skill.parameters);

  // Execute based on skill type
  switch (skill.type) {
    case 'skill':
      return executeClaudeSkill(skill, input, context);
    case 'cgskill':
      return executeCodeGenSkill(skill, input, context);
    case 'iskill':
      return executeInteractiveSkill(skill, input, context);
    case 'mskill':
      return executeMCPSkill(skill, input, context);
    case 'oskill':
      return executeOrchestratorSkill(skill, input, context);
    case 'tskill':
      return executeDBTableSkill(skill, input, context);
    default:
      throw new Error(`Unknown skill type: ${skill.type}`);
  }
}

/**
 * Execute Claude skill
 */
async function executeClaudeSkill(skill, input, context) {
  const llm = getLLMClient(skill.config.model);

  const response = await llm.complete({
    systemPrompt: skill.systemPrompt,
    messages: [
      { role: 'user', content: formatInput(input) }
    ],
    ...skill.config
  });

  return {
    success: true,
    output: response.content,
    usage: response.usage
  };
}

/**
 * Execute CodeGeneration skill
 */
async function executeCodeGenSkill(skill, input, context) {
  // Generate code from LLM
  const llm = getLLMClient(skill.config.model);

  const codeResponse = await llm.complete({
    systemPrompt: skill.systemPrompt,
    messages: [
      { role: 'user', content: `Generate JavaScript code for: ${JSON.stringify(input)}` }
    ]
  });

  // Extract code from response
  const code = extractCode(codeResponse.content);

  // Execute generated code
  const result = await executeCode(code, {
    ...context,
    input
  });

  return {
    success: true,
    code,
    output: result
  };
}

/**
 * Execute MCP skill (orchestrates MCP tools)
 */
async function executeMCPSkill(skill, input, context) {
  const mcpClient = context.mcpClient;

  // Parse orchestration logic
  const steps = parseOrchestration(skill.orchestration, input);

  const results = [];
  for (const step of steps) {
    const result = await mcpClient.callTool(step.tool, step.params);
    results.push(result);

    // Update context for next step
    context[`step_${results.length}`] = result;
  }

  return {
    success: true,
    steps: results,
    output: results[results.length - 1]
  };
}
```

### Skill Registration as MCP Tools

```javascript
/**
 * Register skills as MCP tools
 * @param {Server} mcpServer - MCP server instance
 * @param {Map<string, Skill>} skills - Loaded skills
 */
export function registerSkillsAsMCPTools(mcpServer, skills) {
  for (const [name, skill] of skills) {
    mcpServer.registerTool({
      name: `skill_${name}`,
      description: skill.description,
      inputSchema: buildInputSchema(skill.parameters),
      handler: async (params) => {
        const result = await executeSkill(name, params);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      }
    });
  }
}
```

## Behavioral Specification

### Skill Discovery Flow

```
1. Agent container starts

2. AgentServer initializes

3. Skill loader scans /.AchillesSkills/

4. For each .skill.md, .cgskill.md, etc.:
   a. Parse markdown content
   b. Extract sections
   c. Create skill instance
   d. Register as MCP tool

5. Skills available via MCP tools/list and tools/call
```

### Skill Execution Flow

```
1. MCP request: tools/call { name: "skill_myskill", arguments: {...} }

2. Find skill by name

3. Validate input parameters

4. Determine skill type

5. Execute type-specific handler:
   - Claude: Send to LLM API
   - CodeGen: Generate and execute code
   - Interactive: Multi-turn session
   - MCP: Orchestrate tools
   - Orchestrator: Chain skills
   - DBTable: Database operations

6. Return result via MCP response
```

## Configuration

### Skill Directory Location

```
$CWD/skills/<agent>/.AchillesSkills/
  └── (symlink to .ploinky/repos/<repo>/<agent>/.AchillesSkills/)
```

### LLM Configuration

```javascript
// models.json (in agent's skill directory)
{
  "claude-3-opus": {
    "provider": "anthropic",
    "model": "claude-3-opus-20240229",
    "apiKeyEnv": "ANTHROPIC_API_KEY"
  },
  "gpt-4": {
    "provider": "openai",
    "model": "gpt-4-turbo-preview",
    "apiKeyEnv": "OPENAI_API_KEY"
  },
  "gemini-pro": {
    "provider": "google",
    "model": "gemini-pro",
    "apiKeyEnv": "GOOGLE_API_KEY"
  }
}
```

## Skill Examples

### Simple Claude Skill (`.skill.md`)

```markdown
# summarize

Summarizes text content into a concise format.

## System Prompt

You are a helpful assistant that summarizes text. Create clear, concise summaries that capture the key points. Keep summaries under 200 words unless the input is very long.

## Parameters

- `text` (string, required): The text to summarize
- `maxLength` (number, optional): Maximum summary length in words

## Config

```json
{
  "model": "claude-3-opus",
  "temperature": 0.3,
  "maxTokens": 500
}
```
```

### CodeGeneration Skill (`.cgskill.md`)

```markdown
# data_processor

Generates and executes JavaScript code to process data.

## System Prompt

You are a JavaScript code generator. Generate clean, safe JavaScript code to process the user's data request. Always return the result using `return`.

## Parameters

- `data` (object, required): Input data to process
- `operation` (string, required): Description of operation to perform

## Config

```json
{
  "model": "claude-3-opus",
  "temperature": 0.2
}
```
```

### MCP Orchestrator Skill (`.mskill.md`)

```markdown
# code_review

Reviews code using multiple MCP tools.

## System Prompt

Orchestrate code review using available tools.

## Tools

- read_file
- analyze_code
- suggest_improvements

## Orchestration

```yaml
steps:
  - tool: read_file
    params:
      path: "{{input.file}}"
    output: code_content

  - tool: analyze_code
    params:
      code: "{{steps.code_content}}"
    output: analysis

  - tool: suggest_improvements
    params:
      code: "{{steps.code_content}}"
      analysis: "{{steps.analysis}}"
```
```

## Error Handling

| Error | Cause | Recovery |
|-------|-------|----------|
| Skill not found | Invalid skill name | Check skill file exists |
| Invalid parameters | Missing required params | Validate input |
| LLM API error | API failure | Retry with backoff |
| Code execution error | Generated code failed | Return error details |
| Orchestration error | Tool chain failed | Return partial results |

## Security Considerations

- **Code Execution**: Sandbox generated code execution
- **API Keys**: Store LLM API keys securely in environment
- **Input Validation**: Validate all skill inputs
- **Output Sanitization**: Sanitize LLM outputs

## Success Criteria

1. Skills discovered automatically from directory
2. All skill types execute correctly
3. Skills available as MCP tools
4. LLM integration works with multiple providers
5. Error handling provides clear feedback

## References

- [DS03 - Agent Model](./DS03-agent-model.md)
- [DS07 - MCP Protocol](./DS07-mcp-protocol.md)
- [AchillesAgentLib Documentation](https://github.com/OutfinityResearch/achillesAgentLib)

---

**Important Note from CLAUDE.md**: Do not update `.generated.mjs` files directly. When skill code needs an update, modify the `.md` file and a new `.mjs` file will be regenerated.
