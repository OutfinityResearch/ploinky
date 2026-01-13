# cli/commands/envVarCommands.js - Environment Variable Commands

## Overview

Handles CLI commands for managing workspace environment variables and secrets. Provides commands for setting, echoing, listing, and exposing variables to agents.

## Source File

`cli/commands/envVarCommands.js`

## Dependencies

```javascript
import path from 'path';
import crypto from 'crypto';
import { showHelp } from '../services/help.js';
import * as envSvc from '../services/secretVars.js';
import { findAgent } from '../services/utils.js';
```

## Constants & Configuration

```javascript
// Regex for valid variable names
const INLINE_ASSIGNMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
```

## Internal Functions

### parseInlineAssignmentToken(token)

**Purpose**: Parses a token for inline assignment syntax (VAR=value or VAR:value)

**Parameters**:
- `token` (string): Token to parse

**Returns**: `{name: string, value: string}` or null

**Implementation**:
```javascript
function parseInlineAssignmentToken(token) {
    if (typeof token !== 'string') return null;
    if (!token || token.includes('/') || token.includes('\\') || token.startsWith('$')) return null;
    const separators = ['=', ':'];
    let separatorIndex = -1;
    for (const sep of separators) {
        const idx = token.indexOf(sep);
        if (idx > 0 && (separatorIndex === -1 || idx < separatorIndex)) {
            separatorIndex = idx;
        }
    }
    if (separatorIndex <= 0) return null;
    const name = token.slice(0, separatorIndex);
    if (!INLINE_ASSIGNMENT_NAME.test(name)) return null;
    const value = token.slice(separatorIndex + 1);
    return { name, value };
}
```

### expandInlineAssignment(tokens)

**Purpose**: Expands inline assignment into separate name/value tokens

**Parameters**:
- `tokens` (string[]): Command tokens

**Returns**: (string[]) Expanded tokens

**Implementation**:
```javascript
function expandInlineAssignment(tokens) {
    if (!Array.isArray(tokens) || tokens.length === 0) return tokens;
    const assignment = parseInlineAssignmentToken(tokens[0]);
    if (!assignment) return tokens;
    return [assignment.name, assignment.value, ...tokens.slice(1)];
}
```

### setVarValue(varName, valueOrAlias)

**Purpose**: Sets a variable value using the secret vars service

**Parameters**:
- `varName` (string): Variable name
- `valueOrAlias` (string): Value or reference to another variable ($OTHER)

**Implementation**:
```javascript
function setVarValue(varName, valueOrAlias) {
    if (!varName || typeof valueOrAlias !== 'string' || valueOrAlias.length === 0) {
        showHelp();
        throw new Error('Usage: var <VAR> <value|$OTHER>');
    }
    envSvc.setEnvVar(varName, valueOrAlias);
    console.log(`✓ Set variable '${varName}'.`);
}
```

## Public API

### handleVarsCommand()

**Purpose**: Lists all workspace variables, auto-generating tokens if missing

**Output**: Lists all variables in format `KEY=value`

**Implementation**:
```javascript
export function handleVarsCommand() {
    try {
        const env = envSvc;
        let secrets = env.parseSecrets();

        // Auto-set APP_NAME if missing
        if (!secrets.APP_NAME || !String(secrets.APP_NAME).trim()) {
            try { env.setEnvVar('APP_NAME', path.basename(process.cwd())); } catch (_) { }
        }

        // Auto-generate tokens if missing
        const tokens = ['WEBTTY_TOKEN', 'WEBCHAT_TOKEN', 'WEBDASHBOARD_TOKEN'];
        for (const t of tokens) {
            if (!secrets[t] || !String(secrets[t]).trim()) {
                try { env.setEnvVar(t, crypto.randomBytes(32).toString('hex')); } catch (_) { }
            }
        }

        // Print in preferred order
        const merged = env.parseSecrets();
        const printOrder = ['APP_NAME', 'WEBCHAT_TOKEN', 'WEBDASHBOARD_TOKEN', 'WEBTTY_TOKEN'];
        const keys = Array.from(new Set([...printOrder, ...Object.keys(merged).sort()]));
        keys.forEach(k => console.log(`${k}=${merged[k] ?? ''}`));
    } catch (e) {
        console.error('Failed to list variables:', e.message);
    }
}
```

### handleVarCommand(options)

**Purpose**: Sets a single variable value

**Parameters**:
- `options` (string[]): [VAR_NAME, value] or ["VAR=value"]

**Usage**:
- `var MY_KEY myvalue`
- `var MY_KEY=myvalue`
- `var MY_KEY:myvalue`
- `var MY_REF $OTHER_VAR`

**Implementation**:
```javascript
export function handleVarCommand(options = []) {
    const assignment = parseInlineAssignmentToken(options[0]);
    const normalized = expandInlineAssignment(options).filter(item => item !== undefined);
    const name = normalized[0];
    let valueTokens = normalized.slice(1);
    if (assignment && assignment.value === '' && valueTokens.length > 1 && valueTokens[0] === '') {
        valueTokens = valueTokens.slice(1);
    }
    const value = valueTokens.join(' ');
    if (!name || !value) { showHelp(); throw new Error('Usage: var <VAR> <value>'); }
    setVarValue(name, value);
}
```

### handleEchoCommand(options)

**Purpose**: Echoes the value of a variable

**Parameters**:
- `options` (string[]): [VAR_NAME] or [$VAR_NAME]

**Implementation**:
```javascript
export function handleEchoCommand(options = []) {
    if (!options[0]) { showHelp(); throw new Error('Usage: echo <VAR|$VAR>'); }
    const output = envSvc.echoVar(options[0]);
    console.log(output);
}
```

### handleExposeCommand(options)

**Purpose**: Exposes a variable to an agent's environment

**Parameters**:
- `options` (string[]): [EXPOSED_NAME, value, agentName] or variations

**Usage**:
- `expose DB_URL $DATABASE_URL myagent`
- `expose API_KEY=secret myagent`
- `expose TOKEN $MY_TOKEN` (all agents)

**Implementation**:
```javascript
export function handleExposeCommand(options = []) {
    if (!options[0]) { showHelp(); throw new Error('Usage: expose <EXPOSED_NAME> [<$VAR|value>] [agentName]'); }

    const assignment = parseInlineAssignmentToken(options[0]);
    const normalized = expandInlineAssignment(options).filter(item => item !== undefined);
    const exposedName = normalized[0];
    if (!exposedName) { showHelp(); throw new Error('Usage: expose <EXPOSED_NAME> [<$VAR|value>] [agentName]'); }

    const remainder = normalized.slice(1);
    let valueArg = remainder.length ? remainder.shift() : undefined;
    if (assignment && assignment.value === '' && valueArg === '' && remainder.length) {
        valueArg = remainder.shift();
    }
    let agentArg = remainder.length ? remainder.shift() : undefined;
    if (remainder.length) {
        agentArg = agentArg === undefined ? remainder.join(' ') : [agentArg, ...remainder].join(' ');
    }

    // Determine if second arg is value or agent name
    if (agentArg === undefined) {
        if (!valueArg) {
            valueArg = undefined;
        } else if (typeof valueArg === 'string' && valueArg.startsWith('$')) {
            agentArg = undefined;
        } else {
            let agentLookup = null;
            try { agentLookup = findAgent(valueArg); } catch (_) { agentLookup = null; }
            if (agentLookup) {
                agentArg = valueArg;
                valueArg = undefined;
            }
        }
    }

    try {
        const res = envSvc.exposeEnv(exposedName, valueArg, agentArg);
        console.log(`✓ Exposed '${exposedName}' for agent '${res.agentName}'.`);
    } catch (err) {
        throw new Error(`expose failed: ${err?.message || err}`);
    }
}
```

## Exports

```javascript
export {
    handleVarsCommand,
    handleVarCommand,
    handleEchoCommand,
    handleExposeCommand,
};
```

## Usage Example

```javascript
import { handleVarCommand, handleVarsCommand, handleExposeCommand } from './envVarCommands.js';

// Set a variable
handleVarCommand(['API_KEY', 'sk-12345']);

// Set using inline syntax
handleVarCommand(['DATABASE_URL=postgres://localhost/db']);

// List all variables
handleVarsCommand();

// Expose to agent
handleExposeCommand(['DB_URL', '$DATABASE_URL', 'postgres']);
```

## Related Modules

- [service-secret-vars.md](../services/utils/service-secret-vars.md) - Secret storage
- [service-utils.md](../services/utils/service-utils.md) - Agent lookup
- [commands-cli.md](./commands-cli.md) - Command dispatcher
