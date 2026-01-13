# cli/services/utils.js - Utility Functions

## Overview

Provides core utility functions for the Ploinky CLI including agent discovery, debug logging, ANSI color helpers, and parameter string parsing.

## Source File

`cli/services/utils.js`

## Dependencies

```javascript
import fs from 'fs';
import path from 'path';
import { REPOS_DIR, isDebugMode } from './config.js';
```

## Constants & Configuration

```javascript
/**
 * ANSI escape codes for terminal coloring
 */
const ANSI = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m'
};
```

## Data Structures

```javascript
/**
 * Agent search result
 * @typedef {Object} AgentResult
 * @property {string} manifestPath - Full path to manifest.json
 * @property {string} repo - Repository name
 * @property {string} shortAgentName - Agent name without repo prefix
 */

/**
 * Detailed agent listing entry
 * @typedef {Object} AgentDetail
 * @property {string} repo - Repository name
 * @property {string} name - Agent name
 * @property {string} manifestPath - Full path to manifest.json
 */
```

## Public API

### colorize(text, color)

**Purpose**: Applies ANSI color to text (only in TTY mode)

**Parameters**:
- `text` (any): Text to colorize
- `color` (string): Color name from ANSI object

**Returns**: (string) Colorized text or plain text if not TTY

**Implementation**:
```javascript
function colorize(text, color) {
    try {
        if (!process.stdout.isTTY) return String(text);
    } catch (_) {
        return String(text);
    }
    const c = ANSI[color] || '';
    return c ? (c + String(text) + ANSI.reset) : String(text);
}
```

### debugLog(...args)

**Purpose**: Logs messages only when debug mode is enabled

**Parameters**:
- `...args` (any[]): Arguments to log

**Implementation**:
```javascript
function debugLog(...args) {
    if (isDebugMode()) {
        console.log('[DEBUG]', ...args);
    }
}
```

### findAgent(agentName)

**Purpose**: Finds the manifest.json for a given agent name, supporting both prefixed (repo:agent or repo/agent) and short names

**Parameters**:
- `agentName` (string): Agent name (short or prefixed)

**Returns**: `AgentResult` - Agent details

**Throws**: `Error` if agent not found or name is ambiguous

**Implementation**:
```javascript
function findAgent(agentName) {
    debugLog(`Searching for agent '${agentName}'...`);

    // Handle prefixed names (repo:agent or repo/agent)
    if (agentName.includes(':') || agentName.includes('/')) {
        const [repoName, shortAgentName] = agentName.split(/[:/]/);
        const manifestPath = path.join(REPOS_DIR, repoName, shortAgentName, 'manifest.json');
        if (fs.existsSync(manifestPath)) {
            debugLog(`Found agent directly with prefixed name: ${manifestPath}`);
            return { manifestPath, repo: repoName, shortAgentName };
        } else {
            throw new Error(`Agent '${agentName}' not found.`);
        }
    }

    // Search across all repos for short name
    const foundAgents = [];
    if (!fs.existsSync(REPOS_DIR)) {
        throw new Error("Ploinky environment not initialized. No repos found.");
    }

    const repos = fs.readdirSync(REPOS_DIR);
    debugLog(`Searching in repos: ${repos.join(', ')}`);

    for (const repo of repos) {
        const repoPath = path.join(REPOS_DIR, repo);
        if (fs.statSync(repoPath).isDirectory()) {
            const agentPath = path.join(repoPath, agentName);
            const manifestPath = path.join(agentPath, 'manifest.json');
            if (fs.existsSync(manifestPath)) {
                debugLog(`Found potential match in repo '${repo}': ${manifestPath}`);
                foundAgents.push({ manifestPath, repo: repo, shortAgentName: agentName });
            }
        }
    }

    if (foundAgents.length === 0) {
        throw new Error(`Agent '${agentName}' not found.`);
    }

    if (foundAgents.length > 1) {
        const ambiguousAgents = foundAgents.map(a => `${a.repo}:${a.shortAgentName}`);
        throw new Error(`Agent name '${agentName}' is ambiguous. Please use one of the following:\n${ambiguousAgents.join('\n')}`);
    }

    debugLog(`Resolved agent '${agentName}' to: ${foundAgents[0].manifestPath}`);
    return foundAgents[0];
}
```

### listAgentsDetailed()

**Purpose**: Lists all agents across all repositories

**Returns**: `AgentDetail[]` - Array of agent details

**Implementation**:
```javascript
function listAgentsDetailed() {
    const out = [];
    if (!fs.existsSync(REPOS_DIR)) return out;

    for (const repo of fs.readdirSync(REPOS_DIR)) {
        const repoPath = path.join(REPOS_DIR, repo);
        try {
            if (!fs.statSync(repoPath).isDirectory()) continue;
            for (const name of fs.readdirSync(repoPath)) {
                const mp = path.join(repoPath, name, 'manifest.json');
                try {
                    if (fs.existsSync(mp)) {
                        out.push({ repo, name, manifestPath: mp });
                    }
                } catch(_) {}
            }
        } catch(_) {}
    }
    return out;
}
```

### getAgentNameSuggestions()

**Purpose**: Returns agent name suggestions for tab completion, including unique short names and all repo/name combinations

**Returns**: `string[]` - Sorted array of suggestions

**Implementation**:
```javascript
function getAgentNameSuggestions() {
    const list = listAgentsDetailed();

    // Count occurrences of each short name
    const counts = {};
    list.forEach(a => {
        counts[a.name] = (counts[a.name] || 0) + 1;
    });

    const suggestions = new Set();
    for (const a of list) {
        // Always add repo/name format
        suggestions.add(`${a.repo}/${a.name}`);
        // Add short name only if unique
        if (counts[a.name] === 1) {
            suggestions.add(a.name);
        }
    }
    return Array.from(suggestions).sort();
}
```

### parseParametersString(paramString)

**Purpose**: Parses a parameter string into a JSON object. Supports nested paths, arrays, and quoted values.

**Parameters**:
- `paramString` (string): Parameter string in format `-key value -nested.key value -arr[] [item1 item2]`

**Returns**: (object) Parsed parameters object

**Format**:
- `-key value`: Simple key-value
- `-nested.key value`: Nested object path
- `-arr[] [item1 item2]`: Array value
- `-key "quoted value"`: Quoted string
- Values `true`/`false` are converted to boolean
- Numeric strings are converted to numbers

**Implementation**:
```javascript
function parseParametersString(paramString) {
    const result = {};
    if (!paramString || !String(paramString).trim()) return result;

    const s = String(paramString);
    let i = 0;

    function skipWs() {
        while (i < s.length && /\s/.test(s[i])) i++;
    }

    function readKey() {
        // Keys start with '-'
        if (s[i] !== '-') return null;
        i++; // skip '-'
        const start = i;
        while (i < s.length && !/\s/.test(s[i])) i++;
        return s.slice(start, i);
    }

    function readQuoted() {
        // Assumes s[i] === '"'
        i++; // skip opening quote
        let out = '';
        let escaped = false;
        while (i < s.length) {
            const ch = s[i];
            if (!escaped && ch === '"') { i++; break; }
            if (!escaped && ch === '\\') { escaped = true; i++; continue; }
            out += ch;
            escaped = false;
            i++;
        }
        return out;
    }

    function readToken() {
        skipWs();
        if (i >= s.length) return '';
        if (s[i] === '"') return readQuoted();
        const start = i;
        while (i < s.length && !/\s/.test(s[i]) && s[i] !== '[' && s[i] !== ']') i++;
        return s.slice(start, i);
    }

    function readArray() {
        // Expects current char at '['
        if (s[i] !== '[') return [];
        i++; // skip '['
        const arr = [];
        while (i < s.length) {
            skipWs();
            if (i >= s.length) break;
            if (s[i] === ']') { i++; break; }
            let val;
            if (s[i] === '"') {
                val = readQuoted();
            } else {
                const start = i;
                while (i < s.length && !/\s|\]/.test(s[i])) i++;
                val = s.slice(start, i);
            }
            if (val !== undefined && val !== '') {
                arr.push(parseValue(String(val)));
            }
        }
        return arr;
    }

    while (i < s.length) {
        skipWs();
        if (i >= s.length) break;
        if (s[i] !== '-') {
            // Ignore free text - consume until next whitespace
            while (i < s.length && !/\s/.test(s[i])) i++;
            continue;
        }
        const keyPath = readKey();
        if (!keyPath) break;
        skipWs();

        let value;
        if (s[i] === '[') {
            value = readArray();
        } else if (s[i] === '"') {
            value = readQuoted();
            value = parseValue('"' + value + '"');
        } else {
            const tok = readToken();
            value = parseValue(tok);
        }
        // If no value provided, set empty string
        if (value === undefined) value = '';
        setValue(result, keyPath, value);
    }

    return result;
}

function setValue(obj, path, value) {
    const keys = path.split('.');
    let current = obj;

    for (let i = 0; i < keys.length - 1; i++) {
        const key = keys[i];
        if (!current[key] || typeof current[key] !== 'object') {
            current[key] = {};
        }
        current = current[key];
    }

    let lastKey = keys[keys.length - 1];

    if (lastKey.endsWith('[]')) {
        lastKey = lastKey.slice(0, -2);
        if (!current[lastKey]) {
            current[lastKey] = [];
        }
        if (typeof value === 'string' && value) {
            current[lastKey].push(...value.split(','));
        } else if (typeof value === 'string' && !value) {
            // Empty array - do nothing
        } else if (value) {
            current[lastKey].push(value);
        }
    } else {
        current[lastKey] = value;
    }
}

function parseValue(value) {
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (!value.startsWith('"') && !value.endsWith('"')) {
        const num = Number(value);
        if (!isNaN(num) && String(num) === value) {
            return num;
        }
    }
    if (value.startsWith('"') && value.endsWith('"')) {
        return value.slice(1, -1);
    }
    return value;
}
```

## Exports

```javascript
export {
    findAgent,
    debugLog,
    ANSI,
    colorize,
    listAgentsDetailed,
    getAgentNameSuggestions,
    parseParametersString
};
```

## Usage Examples

```javascript
import {
    findAgent,
    debugLog,
    colorize,
    listAgentsDetailed,
    getAgentNameSuggestions,
    parseParametersString
} from './services/utils.js';

// Find agent (short name)
const agent = findAgent('node-dev');
console.log(agent.manifestPath); // /path/to/.ploinky/repos/basic/node-dev/manifest.json

// Find agent (prefixed)
const agent2 = findAgent('basic/node-dev');

// Debug logging
debugLog('Processing agent:', agent.shortAgentName);

// Colorize output
console.log(colorize('Success!', 'green'));
console.log(colorize('Warning', 'yellow'));

// List all agents
const agents = listAgentsDetailed();
agents.forEach(a => console.log(`${a.repo}/${a.name}`));

// Get suggestions for completion
const suggestions = getAgentNameSuggestions();
// ['basic/node-dev', 'basic/postgres', 'node-dev', ...]

// Parse parameters
const params = parseParametersString('-name John -age 30 -tags[] [dev test]');
// { name: 'John', age: 30, tags: ['dev', 'test'] }
```

## Error Handling

- `findAgent()` throws descriptive errors:
  - Agent not found
  - Ambiguous name (lists alternatives)
  - Environment not initialized
- Other functions silently handle errors and return safe defaults

## Integration Points

- Used throughout CLI for agent discovery
- Used by completion system for suggestions
- Used by debug logging throughout codebase

## Related Modules

- [service-config.md](../config/service-config.md) - Configuration paths
- [commands-cli.md](../../commands/commands-cli.md) - Command handling
- [cli-main.md](../../cli-main.md) - Tab completion
