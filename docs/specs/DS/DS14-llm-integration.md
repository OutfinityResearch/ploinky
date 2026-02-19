# DS14 - LLM Integration

## Summary

Ploinky integrates with large language models (LLMs) through the AchillesAgentLib library for command suggestions, interactive shell mode, and configurable model selection. The Ploinky Shell (`ploinky -l`) provides an LLM-powered REPL that recommends system and Ploinky commands. The interactive CLI uses LLM suggestions as a fallback for unrecognized commands.

## Background / Problem Statement

Users interacting with the CLI may:
- Not remember exact Ploinky command syntax
- Need guidance on which system command to run
- Want an interactive assistant for command recommendations
- Need to configure multiple LLM providers and switch between models

## Goals

1. **LLM-Powered Shell**: Dedicated shell mode for command recommendations
2. **Command Fallback**: Suggest commands when users type unrecognized input in the CLI
3. **Multi-Provider Support**: Configure API keys for Anthropic, OpenAI, Google, and others
4. **Interactive Settings**: Menu for selecting models and configuring LLM behavior

## Non-Goals

- Running full AI agents within the shell (use dedicated agents for that)
- Custom LLM provider integration (managed by AchillesAgentLib)
- Embedding models or vector search

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                     USER INPUT                                │
│  ploinky -l (shell)  │  ploinky CLI (unknown command)        │
└──────────┬───────────┴───────────────────┬───────────────────┘
           │                               │
           ▼                               ▼
┌──────────────────────┐    ┌──────────────────────────────────┐
│    cli/shell.js       │    │ cli/commands/llmSystemCommands.js │
│  - Interactive REPL   │    │ - handleInvalidCommand()          │
│  - handleUserInput()  │    │ - suggestCommandWithLLM()         │
│  - Settings menu      │    │ - extractSingleCommandFromSuggestion() │
└──────────┬───────────┘    └──────────────┬───────────────────┘
           │                               │
           ▼                               ▼
┌──────────────────────────────────────────────────────────────┐
│              achillesAgentLib/utils/LLMClient.mjs             │
│  - defaultLLMInvokerStrategy()                                │
│  - getPrioritizedModels()                                     │
│  - LLMConfig.json (model registry)                            │
└──────────────────────────────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────────┐
│                   LLM API Providers                           │
│  Anthropic  │  OpenAI  │  Google  │  Others                  │
└──────────────────────────────────────────────────────────────┘
```

## Data Models

### LLMConfig.json Structure

Located at `node_modules/achillesAgentLib/LLMConfig.json`:

```json
{
  "providers": {
    "anthropic": { "apiKeyEnv": "ANTHROPIC_API_KEY" },
    "openai": { "apiKeyEnv": "OPENAI_API_KEY" },
    "google": { "apiKeyEnv": "GOOGLE_API_KEY" }
  },
  "models": [
    {
      "name": "claude-3-opus",
      "mode": "deep",
      "provider": "anthropic",
      "inputPrice": 15.0,
      "outputPrice": 75.0,
      "context": 200000
    },
    {
      "name": "gpt-4o",
      "mode": "fast",
      "provider": "openai",
      "inputPrice": 2.5,
      "outputPrice": 10.0,
      "context": 128000
    }
  ]
}
```

### Settings Menu Variables

| Variable | Label | Type | Options |
|----------|-------|------|---------|
| `ACHILLES_ENABLED_DEEP_MODELS` | Enabled deep model | model | Models with mode=deep |
| `ACHILLES_ENABLED_FAST_MODELS` | Enabled fast model | model | Models with mode=fast |
| `ACHILLES_DEFAULT_MODEL_TYPE` | Default model type | enum | `fast`, `deep` |
| `ACHILLES_DEBUG` | Debug logging | enum | `true`, `false` |

Values are stored as process environment variables for the duration of the session. Model values are serialized as JSON arrays: `["model-name"]`.

### LLM Suggestion Result

```javascript
// suggestCommandWithLLM() return values
{ status: 'ok',    suggestion: string }  // LLM responded with suggestion
{ status: 'empty' }                       // No suggestion (empty input or response)
{ status: 'error', error: { code: number, message: string } }
```

## API Contracts

### Shell Entry Points (cli/shell.js)

| Function | Description |
|----------|-------------|
| `main()` | Entry point; handles `-h`, `settings`, inline input, or starts interactive mode |
| `startInteractiveMode()` | Launches REPL with readline, tab completion, and LLM integration |
| `handleUserInput(rawInput)` | Process user input: help, settings, system commands, or LLM suggestion |
| `handleSetEnv()` | Open settings menu, refresh caches after changes |

### LLM System Commands (cli/commands/llmSystemCommands.js)

| Function | Description |
|----------|-------------|
| `suggestCommandWithLLM(command, options)` | Send user input to LLM, get command recommendation |
| `handleSystemCommand(command, options)` | Try running input as system command (`cd`, `ls`, `git`, etc.) |
| `handleInvalidCommand(command, options, executeSuggestion)` | Fallback for unknown CLI commands; suggests via LLM |
| `extractSingleCommandFromSuggestion(suggestion)` | Extract single command from markdown code block |
| `promptToExecuteSuggestedCommand(commandText)` | Ask user y/n to execute suggested command |
| `resetLlmInvokerCache()` | Clear cached LLM invoker (after config changes) |

### LLM Provider Utilities (cli/services/llmProviderUtils.js)

| Function | Description |
|----------|-------------|
| `loadValidLlmApiKeys()` | Parse LLMConfig.json, return list of API key env var names |
| `collectAvailableLlmKeys(envPath)` | Check which API keys are actually set (in .env or process.env) |
| `populateProcessEnvFromEnvFile(envPath)` | Load .env file variables into process.env |
| `resolveEnvFilePath(envPathOrDir)` | Resolve .env file location (walks up directories) |
| `findEnvFileUpwards(startDir, filename)` | Walk up from startDir to find .env file |

### Settings Menu (cli/services/settingsMenu.js)

| Function | Description |
|----------|-------------|
| `runSettingsMenu({onEnvChange})` | Interactive TUI menu for LLM model/debug configuration |

## Behavioral Specification

### Shell Mode Flow (`ploinky -l`)

```
1. Startup:
   ├─ Resolve .env file (walk up from CWD)
   ├─ Populate process.env from .env
   ├─ Log .env location and detected API keys (masked)
   ├─ List available models by provider
   └─ Show current LLM model choice

2. Interactive REPL:
   ├─ Prompt: "ploinky-shell ~/path>"
   ├─ Tab completion: shell commands + file paths
   │
   └─ On input:
       ├─ "exit" / "quit" → close
       ├─ "/help" / "help" → show shell help
       ├─ "/settings" / "settings" → open settings menu
       ├─ System command (ls, git, etc.) → execute directly
       └─ Other input:
           ├─ Check API key availability
           ├─ Build LLM prompt with system context
           ├─ Call LLM (mode: fast, temperature: 0.1)
           ├─ Extract suggestion
           └─ If single command found:
               ├─ Prompt "Execute? (y/n)"
               └─ If yes → spawn command
```

### LLM Prompt Construction

```
System context for Ploinky CLI and runtime:
<contents of docs/ploinky-overview.md>

You are a helpful general-purpose assistant...
Given the user input, you have 2 choices of responding:
describe the best command or just answer normally.
Suggested commands MUST respect the following format:
```
command
```

User input: "<user's text>"
```

### Unknown Command Fallback (in main CLI)

```
1. User types unrecognized command in interactive CLI

2. handleInvalidCommand() called:
   ├─ Check for API keys
   │   └─ If none: show "not recognized" + suggest configuring .env
   │
   ├─ Call suggestCommandWithLLM(command, options)
   │   └─ LLM returns suggestion
   │
   ├─ Extract single command from code block
   │   ├─ If found: promptToExecuteSuggestedCommand()
   │   │   └─ If user confirms: execute via spawn
   │   └─ If not: print full LLM suggestion
   │
   └─ On error: show error + "Run `help` for available commands"
```

### Settings Menu Navigation

```
=== Ploinky Env Config ===
(Prices shown per 1M tokens: input/output)
Arrow Up/Down to navigate, Enter to edit, Esc/Backspace to exit.

> Enabled deep model: claude-3-opus
  Enabled fast model: gpt-4o
  Default model type: fast
  Debug logging: false

   > unset
     claude-3-opus [anthropic] ($15/$75, ctx 200000)
     gpt-4 [openai] ($30/$60, ctx 128000)
```

## Configuration

### API Key Resolution Order

1. Process environment variable (e.g., `ANTHROPIC_API_KEY`)
2. `.env` file in current directory
3. `.env` file walking up parent directories

### .env File Format

```bash
# .env
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=AIza...

# Debug overrides
ACHILLES_DEBUG=true
ACHILLES_DEFAULT_MODEL_TYPE=fast
```

### LLMConfig.json Resolution

Searched in order:
1. `$CWD/node_modules/achillesAgentLib/LLMConfig.json`
2. `<ploinky-root>/node_modules/achillesAgentLib/LLMConfig.json`
3. `<ploinky-root>/../node_modules/achillesAgentLib/LLMConfig.json`

### System Context File

The LLM system prompt includes contents of `docs/ploinky-overview.md` from the Ploinky project root, giving the LLM awareness of Ploinky commands and concepts.

## Error Handling

| Scenario | Behavior |
|----------|----------|
| No API keys configured | Display message listing valid key names; skip LLM call |
| API key invalid (401) | Display "API key invalid" |
| LLM call fails | Display error message, suggest running `help` |
| No suggestion from LLM | Display "No suggestion received. Try rephrasing." |
| LLMConfig.json not found | Return empty key list; shell/settings show no models |
| .env file not found | Walk up directories; if none found, skip env population |
| Non-TTY mode | Print suggestion without y/n prompt |

## Security Considerations

- **API Key Masking**: Keys displayed as `sk-a...xyz1` (first 4 + last 4 chars)
- **Key Storage**: Keys read from `.env` files; never written by Ploinky
- **Command Execution**: User must explicitly confirm (y/n) before running suggested commands
- **System Context**: Only `ploinky-overview.md` is sent to the LLM; no user secrets
- **Shell Meta Characters**: Commands with pipes, redirects, etc. are run via `bash -lc` (user's login shell)

## Success Criteria

1. Shell mode provides command recommendations for natural language input
2. Unknown CLI commands trigger LLM suggestion when API keys are available
3. Settings menu allows switching between available models interactively
4. API keys from `.env` files are auto-detected and loaded
5. Suggested commands require explicit user confirmation before execution

## References

- [DS05 - CLI Commands](./DS05-cli-commands.md) - CLI command dispatch and shell/cli modes
- [DS09 - Skills System](./DS09-skills-system.md) - AchillesAgentLib integration
- AchillesAgentLib documentation - LLMClient and model configuration
