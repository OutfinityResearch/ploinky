const fs = require('fs');
const path = require('path');
const { REPOS_DIR, isDebugMode } = require('./config');

// Simple ANSI color helpers
const ANSI = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m'
};
function colorize(text, color) {
  try { if (!process.stdout.isTTY) return String(text); } catch (_) { return String(text); }
  const c = ANSI[color] || '';
  return c ? (c + String(text) + ANSI.reset) : String(text);
}

function debugLog(...args) {
    if (isDebugMode()) {
        console.log('[DEBUG]', ...args);
    }
}

/**
 * Finds the manifest.json for a given agent name.
 * @param {string} agentName - The short name or prefixed name (repo:agent) of the agent.
 * @returns {{manifestPath: string, repo: string, shortAgentName: string}} Details of the found agent.
 * @throws {Error} If the agent is not found or the name is ambiguous.
 */
function findAgent(agentName) {
    debugLog(`Searching for agent '${agentName}'...`);
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

/**
 * Lists all agents across repos.
 * @returns {Array<{repo:string,name:string,manifestPath:string}>}
 */
function listAgentsDetailed() {
  const out = [];
  if (!fs.existsSync(REPOS_DIR)) return out;
  for (const repo of fs.readdirSync(REPOS_DIR)) {
    const repoPath = path.join(REPOS_DIR, repo);
    try {
      if (!fs.statSync(repoPath).isDirectory()) continue;
      for (const name of fs.readdirSync(repoPath)) {
        const mp = path.join(repoPath, name, 'manifest.json');
        try { if (fs.existsSync(mp)) out.push({ repo, name, manifestPath: mp }); } catch(_){}
      }
    } catch(_){}
  }
  return out;
}

/**
 * Returns agent name suggestions for completion.
 * Includes unique short names and repo/name for all.
 */
function getAgentNameSuggestions() {
  const list = listAgentsDetailed();
  const counts = {};
  list.forEach(a => { counts[a.name] = (counts[a.name]||0)+1; });
  const suggestions = new Set();
  for (const a of list) {
    suggestions.add(`${a.repo}/${a.name}`);
    if (counts[a.name] === 1) suggestions.add(a.name);
  }
  return Array.from(suggestions).sort();
}


/**
 * Parses a parameter string into a JSON object.
 * The format is: name=John,life.age=18,life.height="188 cm",hobbies[]=coding,reading,hiking
 * @param {string} paramString
 * @returns {object}
 */
function parseParametersString(paramString) {
    const result = {};
    if (!paramString) {
        return result;
    }

    const pairs = [];
    let inQuote = false;
    let start = 0;
    for (let i = 0; i < paramString.length; i++) {
        if (paramString[i] === '"') {
            inQuote = !inQuote;
        }
        if (paramString[i] === ',' && !inQuote) {
            pairs.push(paramString.substring(start, i));
            start = i + 1;
        }
    }
    pairs.push(paramString.substring(start));

    let lastArrayKeyPath = null;

    for (const pair of pairs) {
        if (pair.includes('=')) {
            const parts = pair.split('=');
            const fullKey = parts[0];
            const value = parts.slice(1).join('=');
            
            setValue(result, fullKey, value);

            if (fullKey.endsWith('[]')) {
                lastArrayKeyPath = fullKey;
            } else {
                lastArrayKeyPath = null;
            }
        } else if (pair.endsWith('[]')) {
            setValue(result, pair, '');
            lastArrayKeyPath = pair;
        } else if (lastArrayKeyPath) {
            const parsedValue = parseValue(pair);
            
            const keys = lastArrayKeyPath.slice(0, -2).split('.');
            let current = result;
            for (let i = 0; i < keys.length; i++) {
                current = current[keys[i]];
            }
            current.push(parsedValue);
        }
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
    const parsedValue = parseValue(value);

    if (lastKey.endsWith('[]')) {
        lastKey = lastKey.slice(0, -2);
        if (!current[lastKey]) {
            current[lastKey] = [];
        }
        if (typeof parsedValue === 'string' && parsedValue) {
            current[lastKey].push(...parsedValue.split(','));
        } else if (typeof parsedValue === 'string' && !parsedValue) {
            // do nothing, this is an empty array
        } else if (parsedValue) {
            current[lastKey].push(parsedValue);
        }
    } else {
        current[lastKey] = parsedValue;
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


module.exports = { findAgent, debugLog, ANSI, colorize, listAgentsDetailed, getAgentNameSuggestions, parseParametersString };
