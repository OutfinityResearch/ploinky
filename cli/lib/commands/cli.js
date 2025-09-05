const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const { PLOINKY_DIR } = require('../config');
const { debugLog } = require('../utils');
const { showHelp } = require('../help');
const CloudCommands = require('../cloudCommands');
const ClientCommands = require('./client');

const REPOS_DIR = path.join(PLOINKY_DIR, 'repos');

const PREDEFINED_REPOS = {
    'cloud': {
        url: 'https://github.com/PlonkyRepos/cloud.git',
        description: 'Cloud infrastructure agents (AWS, Azure, GCP, etc.)'
    },
    'vibe': {
        url: 'https://github.com/PlonkyRepos/vibe.git',
        description: 'Social media and communication agents'
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

    if (fs.existsSync(repoPath)) {
        console.log(`✓ Repository '${repoName}' already exists.`);
        return;
    }

    console.log(`Cloning repository from ${actualUrl}...`);
    execSync(`git clone ${actualUrl} ${repoPath}`, { stdio: 'inherit' });
    console.log(`✓ Repository '${repoName}' added successfully.`);
}

function newAgent(repoName, agentName, containerImage) {
    if (!repoName || !agentName) {
        showHelp();
        throw new Error('Missing required parameters.');
    }

    const repoPath = path.join(REPOS_DIR, repoName);
    if (!fs.existsSync(repoPath)) {
        throw new Error(`Repository '${repoName}' not found. Add it first with: add repo ${repoName}`);
    }

    const agentPath = path.join(repoPath, agentName);
    if (fs.existsSync(agentPath)) {
        throw new Error(`Agent '${agentName}' already exists in repository '${repoName}'.`);
    }

    fs.mkdirSync(agentPath, { recursive: true });

    const manifest = {
        name: agentName,
        image: containerImage || 'node:18-alpine',
        commands: {
            install: "",
            update: "",
            run: ""
        },
        env: []
    };

    fs.writeFileSync(path.join(agentPath, 'manifest.json'), JSON.stringify(manifest, null, 2));
    console.log(`✓ Agent '${agentName}' created in repository '${repoName}'.`);
    console.log(`  Container image: ${manifest.image}`);
    console.log(`  Location: ${agentPath}`);
}

function setCommand(commandType, agentName, command) {
    if (!commandType || !agentName || !command) {
        showHelp();
        throw new Error('Missing required parameters.');
    }

    const validCommandTypes = ['install', 'update', 'run'];
    if (!validCommandTypes.includes(commandType)) {
        throw new Error(`Invalid command type. Must be one of: ${validCommandTypes.join(', ')}`);
    }

    const manifestPath = findAgentManifest(agentName);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    manifest.commands[commandType] = command;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`✓ Set ${commandType} command for '${agentName}': ${command}`);
}

function addEnv(varName, varValue) {
    if (!varName || !varValue) {
        showHelp();
        throw new Error('Missing required parameters.');
    }

    const envFilePath = path.join(PLOINKY_DIR, 'secrets.env');
    const envLine = `${varName}=${varValue}`;
    
    if (fs.existsSync(envFilePath)) {
        const content = fs.readFileSync(envFilePath, 'utf8');
        if (content.includes(`${varName}=`)) {
            throw new Error(`Environment variable '${varName}' already exists.`);
        }
        fs.appendFileSync(envFilePath, `\n${envLine}`);
    } else {
        fs.writeFileSync(envFilePath, envLine);
    }
    console.log(`✓ Added secret environment variable '${varName}'.`);
}

function enableEnv(agentName, varName) {
    if (!agentName || !varName) {
        showHelp();
        throw new Error('Missing required parameters.');
    }

    const envFilePath = path.join(PLOINKY_DIR, 'secrets.env');
    if (!fs.existsSync(envFilePath)) {
        throw new Error(`No environment variables defined. Add one first with: add env ${varName} <value>`);
    }

    const content = fs.readFileSync(envFilePath, 'utf8');
    if (!content.includes(`${varName}=`)) {
        throw new Error(`Environment variable '${varName}' not found. Add it first with: add env ${varName} <value>`);
    }

    const manifestPath = findAgentManifest(agentName);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    if (!manifest.env) {
        manifest.env = [];
    }

    if (!manifest.env.includes(varName)) {
        manifest.env.push(varName);
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
        console.log(`✓ Enabled environment variable '${varName}' for agent '${agentName}'.`);
    } else {
        console.log(`✓ Environment variable '${varName}' already enabled for agent '${agentName}'.`);
    }
}

function runAgent(agentName, args) {
    const manifestPath = findAgentManifest(agentName);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    if (!manifest.commands.run) {
        throw new Error(`No run command configured for '${agentName}'. Set it first with: set run ${agentName} "<command>"`);
    }

    const agentPath = path.dirname(manifestPath);
    runContainer(manifest, agentPath, manifest.commands.run, args.join(' '));
}

function runBash(agentName) {
    const manifestPath = findAgentManifest(agentName);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const agentPath = path.dirname(manifestPath);
    
    console.log(`Opening bash shell in '${agentName}' container...`);
    runContainer(manifest, agentPath, '/bin/bash', '', true);
}

function runUpdate(agentName) {
    const manifestPath = findAgentManifest(agentName);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    if (!manifest.commands.update) {
        console.log(`No update command configured for '${agentName}'.`);
        return;
    }

    const agentPath = path.dirname(manifestPath);
    console.log(`Running update command for '${agentName}'...`);
    runContainer(manifest, agentPath, manifest.commands.update);
    console.log(`✓ Update completed for '${agentName}'.`);
}

function listAgents() {
    if (!fs.existsSync(REPOS_DIR)) {
        console.log('No repositories found. Add one first with: add repo <name> [url]');
        return;
    }

    const repos = fs.readdirSync(REPOS_DIR).filter(file => 
        fs.statSync(path.join(REPOS_DIR, file)).isDirectory()
    );

    if (repos.length === 0) {
        console.log('No repositories found. Add one first with: add repo <name> [url]');
        return;
    }

    let hasAgents = false;
    repos.forEach(repo => {
        const repoPath = path.join(REPOS_DIR, repo);
        const agents = fs.readdirSync(repoPath).filter(file => {
            const agentPath = path.join(repoPath, file);
            return fs.statSync(agentPath).isDirectory() && fs.existsSync(path.join(agentPath, 'manifest.json'));
        });

        if (agents.length > 0) {
            hasAgents = true;
            console.log(`\n📁 ${repo}/`);
            agents.forEach(agent => {
                const manifestPath = path.join(repoPath, agent, 'manifest.json');
                try {
                    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                    const hasRun = manifest.commands?.run ? '✓' : '✗';
                    const hasUpdate = manifest.commands?.update ? '✓' : '✗';
                    const hasInstall = manifest.commands?.install ? '✓' : '✗';
                    const envCount = manifest.env?.length || 0;
                    
                    console.log(`   📦 ${agent}`);
                    console.log(`      Image: ${manifest.image || 'not set'}`);
                    console.log(`      Commands: install[${hasInstall}] update[${hasUpdate}] run[${hasRun}]`);
                    if (envCount > 0) {
                        console.log(`      Environment: ${envCount} variable(s) enabled`);
                    }
                } catch (e) {
                    console.log(`   📦 ${agent} (invalid manifest)`);
                }
            });
        }
    });

    if (!hasAgents) {
        console.log('No agents found. Create one with: new agent <repo> <name>');
    }
}

function listRepos() {
    if (!fs.existsSync(REPOS_DIR)) {
        console.log('No repositories found.');
        console.log('\nAdd a predefined repository:');
        Object.entries(PREDEFINED_REPOS).forEach(([name, info]) => {
            console.log(`  add repo ${name.padEnd(10)} # ${info.description}`);
        });
        return;
    }

    const repos = fs.readdirSync(REPOS_DIR).filter(file => 
        fs.statSync(path.join(REPOS_DIR, file)).isDirectory()
    );

    if (repos.length === 0) {
        console.log('No repositories found.');
        console.log('\nAdd a predefined repository:');
        Object.entries(PREDEFINED_REPOS).forEach(([name, info]) => {
            console.log(`  add repo ${name.padEnd(10)} # ${info.description}`);
        });
        return;
    }

    console.log('Available repositories:');
    repos.forEach(repo => {
        const repoPath = path.join(REPOS_DIR, repo);
        const agentCount = fs.readdirSync(repoPath).filter(file => {
            const agentPath = path.join(repoPath, file);
            return fs.statSync(agentPath).isDirectory() && fs.existsSync(path.join(agentPath, 'manifest.json'));
        }).length;
        
        console.log(`  📁 ${repo} (${agentCount} agent${agentCount !== 1 ? 's' : ''})`);
    });
}

function executeBashCommand(command, args) {
    const fullCommand = [command, ...args].join(' ');
    
    if (command === 'cd') {
        const targetDir = args[0] || process.env.HOME || process.env.USERPROFILE;
        try {
            process.chdir(targetDir);
            debugLog(`Changed directory to: ${process.cwd()}`);
        } catch (error) {
            console.error(`cd: ${error.message}`);
        }
    } else if (command === 'clear') {
        console.clear();
    } else {
        try {
            execSync(fullCommand, { stdio: 'inherit' });
        } catch (error) {
            // Error is already displayed by execSync with stdio: 'inherit'
        }
    }
}

function findAgentManifest(agentName) {
    if (!fs.existsSync(REPOS_DIR)) {
        throw new Error('No repositories found. Add one first with: add repo <name> [url]');
    }

    const repos = fs.readdirSync(REPOS_DIR).filter(file => 
        fs.statSync(path.join(REPOS_DIR, file)).isDirectory()
    );

    for (const repo of repos) {
        const manifestPath = path.join(REPOS_DIR, repo, agentName, 'manifest.json');
        if (fs.existsSync(manifestPath)) {
            return manifestPath;
        }
    }

    throw new Error(`Agent '${agentName}' not found. Create it first with: new agent <repo> ${agentName}`);
}

function runContainer(manifest, agentPath, command, args = '', interactive = false) {
    const containerName = `ploinky-${manifest.name}-${Date.now()}`;
    const image = manifest.image || 'node:18-alpine';
    
    // Determine container runtime
    let containerRuntime = 'docker';
    try {
        execSync('which podman', { stdio: 'pipe' });
        containerRuntime = 'podman';
    } catch {
        try {
            execSync('which docker', { stdio: 'pipe' });
        } catch {
            throw new Error('No container runtime found. Please install Docker or Podman.');
        }
    }

    // Build environment variables
    const envArgs = [];
    if (manifest.env && manifest.env.length > 0) {
        const envFilePath = path.join(PLOINKY_DIR, 'secrets.env');
        if (fs.existsSync(envFilePath)) {
            const envContent = fs.readFileSync(envFilePath, 'utf8');
            manifest.env.forEach(varName => {
                const match = envContent.match(new RegExp(`^${varName}=(.*)$`, 'm'));
                if (match) {
                    envArgs.push('-e', `${varName}=${match[1]}`);
                }
            });
        }
    }

    const fullCommand = args ? `${command} ${args}` : command;
    const containerArgs = [
        'run',
        '--rm',
        '--name', containerName,
        '-v', `${agentPath}:/workspace`,
        '-w', '/workspace',
        ...envArgs,
        ...(interactive ? ['-it'] : []),
        image,
        ...(interactive ? [command] : ['sh', '-c', fullCommand])
    ];

    debugLog(`Running: ${containerRuntime} ${containerArgs.join(' ')}`);
    
    const result = spawn(containerRuntime, containerArgs, { 
        stdio: 'inherit',
        shell: false
    });

    result.on('error', (error) => {
        console.error(`Failed to start container: ${error.message}`);
    });
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
        case 'help':
            showHelp(options);
            break;
        case 'cloud':
            const cloudCommands = new CloudCommands();
            cloudCommands.handleCloudCommand(options);
            break;
        case 'client':
            const clientCommands = new ClientCommands();
            clientCommands.handleClientCommand(options);
            break;
        default:
            // Avoid trying to run 'ploinky' inside Ploinky's REPL
            if (command === 'ploinky') {
                console.log("Already in Ploinky interactive mode. Type 'help' or 'exit'.");
                return;
            }
            // Try to execute as a system command
            // First check if it's a special built-in that needs custom handling
            const specialCommands = ['cd', 'clear'];
            
            if (specialCommands.includes(command)) {
                // Execute with our special handling
                executeBashCommand(command, options);
            } else {
                // Try to execute any command that exists in the system
                const { execSync } = require('child_process');
                try {
                    // Check if command exists using 'which' (Unix) or 'where' (Windows)
                    const checkCommand = process.platform === 'win32' ? 'where' : 'which';
                    execSync(`${checkCommand} ${command}`, { stdio: 'pipe' });
                    
                    // Command exists, execute it
                    executeBashCommand(command, options);
                } catch (error) {
                    // Command doesn't exist or which/where failed
                    console.log(`Command not found: ${command}`);
                    console.log(`Try 'help' to see available Ploinky commands.`);
                }
            }
    }
}

module.exports = {
    handleCommand,
    getAgentNames,
    getRepoNames
};
