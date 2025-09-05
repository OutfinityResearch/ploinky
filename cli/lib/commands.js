const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { REPOS_DIR, SECRETS_FILE } = require('./config');
const { findAgent, debugLog } = require('./utils');
const { runCommandInContainer } = require('./docker');

const DEFAULT_CONTAINER_IMAGE = 'mcr.microsoft.com/devcontainers/base:debian';

// Predefined PlonkyRepos repositories
const PREDEFINED_REPOS = {
    'cloud': {
        url: 'https://github.com/PlonkyRepos/cloud.git',
        description: 'Cloud and infrastructure agents'
    },
    'vibe': {
        url: 'https://github.com/PlonkyRepos/vibe.git',
        description: 'Development and productivity agents'
    },
    'security': {
        url: 'https://github.com/PlonkyRepos/security.git',
        description: 'Security and scanning tools'
    },
    'extra': {
        url: 'https://github.com/PlonkyRepos/extra.git',
        description: 'Additional utility agents'
    }
};

function showHelp() {
    console.log(`
Ploinky Agent Manager

Usage: ploinky <command> [options]

Commands:
  add repo <RepoName> [GitHubURL]              Clones a repository containing agent configurations.
                                                Predefined repos: cloud, vibe, security, extra
  new agent <RepoName> <AgentName> [Container]   Creates a new agent configuration in a repository.
                                                 (Default container: ${DEFAULT_CONTAINER_IMAGE})
  set install <AgentName> "[command]"          Sets the installation command for an agent.
  set update <AgentName> "[command]"           Sets the update command for an agent.
  set run <AgentName> "[command]"              Sets the run command for an agent.
  add env <VarName> <VarValue>                 Adds a secret environment variable.
  enable env <AgentName> <VarName>             Enables a secret for an agent.
  run agent <AgentName> [...args]              Runs an agent's start command.
  run bash <AgentName>                         Starts a bash session in an agent's container.
  run update <AgentName>                       Runs an agent's update command.
  list agents                                  Lists all available agents.
  list repos                                   Lists all available repositories.
  help                                         Displays this help message.

Common bash commands are also available: ls, cd, pwd, cat, grep, find, ps, df, mkdir, rm, cp, mv, and more.

Options:
  --debug, -d                                  Enables debug mode for detailed logging.

Run 'help' to see this list again.
    `);
}

function getRepoNames() {
    if (!fs.existsSync(REPOS_DIR)) return [];
    return fs.readdirSync(REPOS_DIR)
        .filter(file => fs.statSync(path.join(REPOS_DIR, file)).isDirectory());
}

function getAgentNames() {
    if (!fs.existsSync(REPOS_DIR)) return [];
    const agentNames = [];
    const repos = getRepoNames();
    for (const repo of repos) {
        const repoPath = path.join(REPOS_DIR, repo);
        const agents = fs.readdirSync(repoPath).filter(file => {
            const agentPath = path.join(repoPath, file);
            return fs.statSync(agentPath).isDirectory() && fs.existsSync(path.join(agentPath, 'manifest.json'));
        });
        agents.forEach(agent => agentNames.push(agent));
    }
    return [...new Set(agentNames)]; // Return unique agent names
}


function addRepo(repoName, repoUrl) {
    if (!repoName) {
        showHelp();
        throw new Error('Missing repository name.');
    }

    // Check if it's a predefined repo name
    let actualUrl = repoUrl;
    if (!repoUrl && PREDEFINED_REPOS[repoName.toLowerCase()]) {
        const predefined = PREDEFINED_REPOS[repoName.toLowerCase()];
        actualUrl = predefined.url;
        console.log(`Using predefined repository: ${repoName} (${predefined.description})`);
    } else if (!repoUrl) {
        showHelp();
        throw new Error('Missing repository URL. Use one of the predefined names (cloud, vibe, security, extra) or provide a URL.');
    }

    const repoPath = path.join(REPOS_DIR, repoName);
    debugLog(`Target repository path: ${repoPath}`);
    if (fs.existsSync(repoPath)) {
        throw new Error(`Repository '${repoName}' already exists.`);
    }

    console.log(`Cloning repository '${repoName}' from ${actualUrl}...`);
    const command = `git clone ${actualUrl} ${repoPath}`;
    debugLog(`Executing command: ${command}`);
    try {
        execSync(command, { stdio: 'inherit' });
        console.log('Repository cloned successfully.');
    } catch (error) {
        throw new Error(`Failed to clone repository: ${error.message}`);
    }
}

function newAgent(repoName, agentName, containerImage) {
    if (!repoName || !agentName) {
        showHelp();
        throw new Error('Missing arguments for new agent. Usage: new agent <RepoName> <AgentName> [Container]');
    }

    const container = containerImage || DEFAULT_CONTAINER_IMAGE;
    debugLog(`Using container image: ${container}`);

    const repoPath = path.join(REPOS_DIR, repoName);
    debugLog(`Target repository path: ${repoPath}`);
    if (!fs.existsSync(repoPath)) {
        throw new Error(`Repository '${repoName}' does not exist.`);
    }

    const agentPath = path.join(repoPath, agentName);
    debugLog(`Target agent path: ${agentPath}`);
    if (fs.existsSync(agentPath)) {
        throw new Error(`Agent '${agentName}' already exists in repository '${repoName}'.`);
    }

    console.log(`Creating new agent '${agentName}' in repository '${repoName}'...`);
    fs.mkdirSync(agentPath, { recursive: true });
    fs.mkdirSync(path.join(agentPath, 'src'), { recursive: true });
    debugLog(`Created agent directories at: ${agentPath}`);

    const manifest = {
        container: container,
        install: "",
        update: "",
        run: ""
    };

    const manifestPath = path.join(agentPath, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    debugLog(`Created manifest file at: ${manifestPath}`);
    console.log(`Agent '${agentName}' created successfully.`);
}

function setCommand(commandType, agentName, command) {
    if (!commandType || !agentName || command === undefined) {
        showHelp();
        throw new Error('Missing arguments for set command. Usage: set <install|update|run> <AgentName> "[command]"');
    }

    const validCommands = ['install', 'update', 'run'];
    if (!validCommands.includes(commandType)) {
        throw new Error(`Invalid command type '${commandType}'. Must be one of: ${validCommands.join(', ')}`);
    }

    const { manifestPath } = findAgent(agentName);
    debugLog(`Found manifest to update at: ${manifestPath}`);
    const manifest = JSON.parse(fs.readFileSync(manifestPath));

    manifest[commandType] = command;

    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`Successfully set '${commandType}' command for agent '${agentName}'.`);
    debugLog(`Updated manifest with new command: ${commandType} = "${command}"`);
}

function addEnv(varName, varValue) {
    if (!varName || !varValue) {
        showHelp();
        throw new Error('Missing arguments for add env. Usage: add env <VarName> <VarValue>');
    }

    const secret = '\n' + varName + '="' + varValue + '"';
    try {
        fs.appendFileSync(SECRETS_FILE, secret);
        console.log(`Secret '${varName}' added successfully.`);
        debugLog(`Appended secret to ${SECRETS_FILE}`);
    } catch (error) {
        throw new Error(`Failed to add secret: ${error.message}`);
    }
}

function enableEnv(agentName, varName) {
    if (!agentName || !varName) {
        showHelp();
        throw new Error('Missing arguments for enable env. Usage: enable env <AgentName> <VarName>');
    }

    const secrets = fs.readFileSync(SECRETS_FILE, 'utf-8');
    const secretExists = secrets.split('\n').some(line => line.startsWith(`${varName}=`));

    if (!secretExists) {
        throw new Error(`Secret '${varName}' not found. Please add it first with 'add env'.`);
    }
    debugLog(`Verified secret '${varName}' exists in ${SECRETS_FILE}`);

    const { manifestPath } = findAgent(agentName);
    debugLog(`Found manifest to update at: ${manifestPath}`);
    const manifest = JSON.parse(fs.readFileSync(manifestPath));

    if (!manifest.env) {
        manifest.env = [];
    }

    if (manifest.env.includes(varName)) {
        console.log(`Secret '${varName}' is already enabled for agent '${agentName}'.`);
        return;
    }

    manifest.env.push(varName);

    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`Successfully enabled secret '${varName}' for agent '${agentName}'.`);
    debugLog(`Updated manifest with new env var: ${varName}`);
}

function runAgent(agentName, args) {
    if (!agentName) {
        showHelp();
        throw new Error('Missing agent name. Usage: run agent <AgentName> [...args]');
    }

    const { manifestPath, repo, shortAgentName } = findAgent(agentName);
    const manifest = JSON.parse(fs.readFileSync(manifestPath));
    const command = `${manifest.run} ${args.join(' ')}`;
    debugLog(`Preparing to run agent '${agentName}' with final command: ${command}`);
    runCommandInContainer(shortAgentName, repo, manifest, command, true);
}

function runBash(agentName) {
    if (!agentName) {
        showHelp();
        throw new Error('Missing agent name. Usage: run bash <AgentName>');
    }

    const { manifestPath, repo, shortAgentName } = findAgent(agentName);
    const manifest = JSON.parse(fs.readFileSync(manifestPath));
    debugLog(`Preparing to start bash session for agent '${agentName}'`);
    runCommandInContainer(shortAgentName, repo, manifest, '/bin/bash', true);
}

function runUpdate(agentName) {
    if (!agentName) {
        showHelp();
        throw new Error('Missing agent name. Usage: run update <AgentName>');
    }

    const { manifestPath, repo, shortAgentName } = findAgent(agentName);
    const manifest = JSON.parse(fs.readFileSync(manifestPath));
    if (!manifest.update) {
        throw new Error(`No update command specified for agent '${agentName}'.`);
    }
    debugLog(`Preparing to run update for agent '${agentName}' with command: ${manifest.update}`);
    runCommandInContainer(shortAgentName, repo, manifest, manifest.update);
}



function listAgents() {
    console.log('Available agents:');
    
    // Load the agents file to see which ones have been run
    let runningAgents = {};
    try {
        if (fs.existsSync(AGENTS_FILE)) {
            runningAgents = JSON.parse(fs.readFileSync(AGENTS_FILE, 'utf-8'));
        }
    } catch (e) {
        debugLog('Could not read agents file:', e.message);
    }
    
    const repos = getRepoNames();
    for (const repo of repos) {
        const repoPath = path.join(REPOS_DIR, repo);
        console.log(`\nRepository: ${repo}`);
        const agents = fs.readdirSync(repoPath).filter(file => {
            const agentPath = path.join(repoPath, file);
            return fs.statSync(agentPath).isDirectory() && fs.existsSync(path.join(agentPath, 'manifest.json'));
        });
        
        if (agents.length > 0) {
            agents.forEach(agent => {
                // Read the manifest to get the 'about' field
                const manifestPath = path.join(repoPath, agent, 'manifest.json');
                let manifest = {};
                try {
                    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
                } catch (e) {
                    debugLog(`Could not read manifest for ${agent}:`, e.message);
                }
                
                // Check if this agent has been run (has a container)
                const containerName = `ploinky_${repo.replace(/[^a-zA-Z0-9_.-]/g, '_')}_${agent.replace(/[^a-zA-Z0-9_.-]/g, '_')}`;
                const hasBeenRun = Object.keys(runningAgents).some(key => key.startsWith(containerName));
                
                // Format the output
                let output = `  - ${agent}`;
                if (hasBeenRun) {
                    output += ' [*]';  // Mark agents that have been run
                }
                if (manifest.about) {
                    output += ` - ${manifest.about}`;
                }
                if (manifest.container) {
                    output += ` (${manifest.container})`;
                }
                console.log(output);
            });
        } else {
            console.log('  (No agents found)');
        }
    }
    
    // Show legend if there are any running agents
    if (Object.keys(runningAgents).length > 0) {
        console.log('\n[*] = Agent has been run (container exists)');
    }
    
    // Show suggestion for more agents
    console.log('\n💡 Want more agents?');
    console.log('   Additional agent collections are available in predefined repositories.');
    console.log('   Run "list repos" to see available repositories.');
    console.log('   Use "add repo <name>" to install new repositories (e.g., "add repo cloud")');
}

function listRepos() {
    console.log('\n=== Installed Repositories ===');
    const installedRepos = getRepoNames();
    if (installedRepos.length > 0) {
        installedRepos.forEach(repo => {
            // Check if it's the default repo
            if (repo === 'PloinkyAgents') {
                console.log(`  - ${repo} (default Basic repository)`);
            } else {
                console.log(`  - ${repo}`);
            }
        });
    } else {
        console.log('  (No repositories installed)');
    }

    console.log('\n=== Predefined PlonkyRepos ===');
    Object.entries(PREDEFINED_REPOS).forEach(([name, info]) => {
        const isInstalled = installedRepos.includes(name);
        const status = isInstalled ? '✓ installed' : '○ not installed';
        console.log(`  - ${name} [${status}]`);
        console.log(`    ${info.description}`);
        console.log(`    ${info.url}`);
    });

    console.log('\nTo add a predefined repository, use: add repo <name>');
    console.log('Example: add repo cloud');
}


function executeBashCommand(command, args) {
    const { execSync } = require('child_process');
    
    // Special handling for cd command
    if (command === 'cd') {
        const targetDir = args[0] || process.env.HOME;
        try {
            process.chdir(targetDir);
            debugLog(`Changed directory to: ${process.cwd()}`);
        } catch (error) {
            console.error(`cd: ${error.message}`);
        }
        return;
    }
    
    // Special handling for clear command
    if (command === 'clear') {
        console.clear();
        return;
    }
    
    // Execute other commands
    const fullCommand = args.length > 0 ? `${command} ${args.join(' ')}` : command;
    debugLog(`Executing bash command: ${fullCommand}`);
    
    try {
        const output = execSync(fullCommand, { 
            stdio: 'inherit',
            cwd: process.cwd()
        });
    } catch (error) {
        // Error is already displayed by stdio: 'inherit'
        debugLog(`Command failed: ${error.message}`);
    }
}

function handleCommand(args) {
    const [command, ...options] = args;
    debugLog(`Handling command: '${command}' with options: [${options.join(', ')}]`);

    switch (command) {
        case 'add':
            if (options[0] === 'repo') {
                addRepo(options[1], options[2]);
            } else if (options[0] === 'env') {
                addEnv(options[1], options.slice(2).join(' '));
            } else {
                showHelp();
            }
            break;
        case 'new':
            if (options[0] === 'agent') {
                newAgent(options[1], options[2], options[3]);
            } else {
                showHelp();
            }
            break;
        case 'set':
            setCommand(options[0], options[1], options.slice(2).join(' '));
            break;
        case 'enable':
            if (options[0] === 'env') {
                enableEnv(options[1], options[2]);
            } else {
                showHelp();
            }
            break;
        case 'run':
            if (options[0] === 'agent') {
                runAgent(options[1], options.slice(2));
            } else if (options[0] === 'bash') {
                runBash(options[1]);
            } else if (options[0] === 'update') {
                runUpdate(options[1]);
            } else {
                showHelp();
            }
            break;
        case 'list':
            if (options[0] === 'agents') {
                listAgents();
            } else if (options[0] === 'repos') {
                listRepos();
            } else {
                showHelp();
            }
            break;
        default:
            // Check if it's a common bash command
            const bashCommands = [
                'ls', 'cd', 'pwd', 'cat', 'grep', 'find', 'ps', 'df', 'du',
                'mkdir', 'rm', 'cp', 'mv', 'touch', 'chmod', 'tail', 'head',
                'clear', 'which', 'echo', 'tree', 'less', 'more', 'wc', 'sort',
                'uniq', 'cut', 'sed', 'awk', 'tar', 'zip', 'unzip', 'curl', 'wget'
            ];
            
            if (bashCommands.includes(command)) {
                // Execute bash command locally
                executeBashCommand(command, options);
            } else {
                console.log(`Unknown command: ${command}`);
                showHelp();
            }
    }
}

module.exports = {
    showHelp,
    handleCommand,
    getAgentNames,
    getRepoNames,
};
