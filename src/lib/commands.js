const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { REPOS_DIR, SECRETS_FILE } = require('./config');
const { findAgent, debugLog } = require('./utils');
const { runCommandInContainer } = require('./docker');

const DEFAULT_CONTAINER_IMAGE = 'mcr.microsoft.com/devcontainers/base:debian';

function showHelp() {
    console.log(`
Ploinky Agent Manager

Usage: ploinky <command> [options]

Commands:
  add repo <RepoName> <GitHubURL>              Clones a repository containing agent configurations.
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
  test <test_name>                             Runs a specific integration test.
  help                                         Displays this help message.

Options:
  --debug, -d                                  Enables debug mode for detailed logging.

Run 'help' to see this list again.
    `);
}

function addRepo(repoName, repoUrl) {
    if (!repoName || !repoUrl) {
        showHelp();
        throw new Error('Missing repository name or URL.');
    }

    const repoPath = path.join(REPOS_DIR, repoName);
    debugLog(`Target repository path: ${repoPath}`);
    if (fs.existsSync(repoPath)) {
        throw new Error(`Repository '${repoName}' already exists.`);
    }

    console.log(`Cloning repository '${repoName}' from ${repoUrl}...`);
    const command = `git clone ${repoUrl} ${repoPath}`;
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


function runTests(testName) {
    // The project root is two levels above the current file (src/lib/commands.js)
    const projectRoot = path.resolve(__dirname, '..', '..');
    const testsDir = path.join(projectRoot, 'tests');
    debugLog(`Resolved tests directory to: ${testsDir}`);

    if (!fs.existsSync(testsDir)) {
        console.error('Error: "tests" directory not found.');
        return;
    }

    const availableTests = fs.readdirSync(testsDir).filter(f => fs.statSync(path.join(testsDir, f)).isDirectory());

    if (!testName) {
        console.log('Available tests:');
        availableTests.forEach(t => console.log(`  ${t}`));
        console.log("\nRun 'ploinky test <test_name>' to execute a specific test.");
        return;
    }

    if (!availableTests.includes(testName)) {
        console.error(`Error: Test '${testName}' not found in ${testsDir}.`);
        return;
    }

    const testPath = path.join(testsDir, testName);
    const runScriptPath = path.join(testPath, 'run.sh');
    if (!fs.existsSync(runScriptPath)) {
        console.log(`SKIPPING: No run.sh found for test '${testName}'.`);
        return;
    }

    const ploinkyExecutable = `node ${path.join(projectRoot, 'src', 'index.js')}`;
    const cmd = `bash ${runScriptPath}`;
    
    debugLog(`Executing test script: ${cmd}`);
    try {
        execSync(cmd, { 
            stdio: 'inherit',
            env: { ...process.env, PLOINKY_CMD: ploinkyExecutable }
        });
        console.log(`✅ PASS: ${testName}`);
    } catch (error) {
        console.error(`❌ FAIL: ${testName} exited with an error.`);
        // Re-throw the error to ensure the process exits with a non-zero code,
        // which is important for the external test runner script.
        throw error;
    }
}

function listAgents() {
    console.log('Available agents:');
    const repos = fs.readdirSync(REPOS_DIR);
    for (const repo of repos) {
        const repoPath = path.join(REPOS_DIR, repo);
        if (fs.statSync(repoPath).isDirectory()) {
            console.log(`
Repository: ${repo}`);
            const agents = fs.readdirSync(repoPath).filter(file => {
                const agentPath = path.join(repoPath, file);
                return fs.statSync(agentPath).isDirectory() && fs.existsSync(path.join(agentPath, 'manifest.json'));
            });
            if (agents.length > 0) {
                agents.forEach(agent => console.log(`  - ${agent}`));
            } else {
                console.log('  (No agents found)');
            }
        }
    }
}

function listRepos() {
    console.log('Available repositories:');
    const repos = fs.readdirSync(REPOS_DIR)
        .filter(file => fs.statSync(path.join(REPOS_DIR, file)).isDirectory());
    
    if (repos.length > 0) {
        repos.forEach(repo => console.log(`  - ${repo}`));
    } else {
        console.log('  (No repositories found)');
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
        case 'test':
            try {
                runTests(options[0]);
            } catch (e) {
                // The error is already logged by runTests, but we need to exit
                // with a failure code for the external test runner script.
                process.exit(1);
            }
            break;
        default:
            console.log(`Unknown command: ${command}`);
            showHelp();
    }
}

module.exports = {
    showHelp,
    handleCommand,
};