#!/usr/bin/env node

const { initEnvironment, setDebugMode, PLOINKY_DIR } = require('./lib/config');
const { showHelp, handleCommand, getAgentNames, getRepoNames } = require('./lib/commands');
const { debugLog } = require('./lib/utils');
const readline = require('readline');
const fs = require('fs');
const os = require('os');
const path = require('path');

const COMMANDS = {
    'add': ['repo', 'env'],
    'new': ['agent'],
    'set': ['install', 'update', 'run'],
    'enable': ['env'],
    'run': ['agent', 'bash', 'update'],
    'list': ['agents', 'repos'],
    'test': [],
    'help': [],
    'exit': [],
    'quit': []
};

function completer(line) {
    const fs = require('fs');
    const path = require('path');
    const words = line.split(/\s+/).filter(Boolean);
    const lineFragment = line.endsWith(' ') ? '' : (words[words.length - 1] || '');
    
    let completions = [];
    let context = 'commands';

    // Check if it's a known Ploinky command
    if (words.length > 0 && COMMANDS.hasOwnProperty(words[0])) {
        const command = words[0];
        const subcommands = COMMANDS[command];

        // Determine the context for completion
        if (line.endsWith(' ')) {
            if (words.length === 1 && subcommands.length > 0) context = 'subcommands';
            else if (words.length === 2) context = 'args';
            else context = 'files'; // Default to file completion for additional args
        } else {
            if (words.length === 1) context = 'commands';
            else if (words.length === 2 && subcommands.length > 0) context = 'subcommands';
            else context = 'files'; // Default to file completion
        }

        // Get potential completions based on context
        if (context === 'subcommands') {
            completions = subcommands;
        } else if (context === 'args') {
            const subcommand = words[1];
            if ((command === 'run' && ['agent', 'bash', 'update'].includes(subcommand)) ||
                (command === 'set') ||
                (command === 'enable' && subcommand === 'env')) {
                completions = getAgentNames();
            } else if (command === 'new' && subcommand === 'agent') {
                completions = getRepoNames();
            } else {
                context = 'files'; // Fall back to file completion
            }
        }
        
        if (context === 'commands') {
            completions = Object.keys(COMMANDS);
        }
    } else {
        // Not a known Ploinky command, could be a system command or need file completion
        if (words.length === 0 || (words.length === 1 && !line.endsWith(' '))) {
            // First word - could be a command
            completions = Object.keys(COMMANDS);
        } else {
            // Treat as file path for unknown commands
            context = 'files';
        }
    }

    // File path completion
    if (context === 'files' || completions.length === 0) {
        try {
            // Parse the path to complete
            let pathToComplete = lineFragment;
            let dirPath = '.';
            let filePrefix = '';
            
            if (pathToComplete.includes('/')) {
                const lastSlash = pathToComplete.lastIndexOf('/');
                dirPath = pathToComplete.substring(0, lastSlash) || '.';
                filePrefix = pathToComplete.substring(lastSlash + 1);
            } else {
                filePrefix = pathToComplete;
            }
            
            // Resolve ~ to home directory
            if (dirPath.startsWith('~')) {
                dirPath = dirPath.replace('~', process.env.HOME || process.env.USERPROFILE);
            }
            
            // Read directory contents
            if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
                const files = fs.readdirSync(dirPath);
                const matchingFiles = files
                    .filter(f => f.startsWith(filePrefix))
                    .map(f => {
                        const fullPath = path.join(dirPath, f);
                        const isDir = fs.statSync(fullPath).isDirectory();
                        // Reconstruct the path as it should appear in completion
                        if (pathToComplete.includes('/')) {
                            const prefix = pathToComplete.substring(0, pathToComplete.lastIndexOf('/') + 1);
                            return prefix + f + (isDir ? '/' : '');
                        }
                        return f + (isDir ? '/' : '');
                    });
                completions = matchingFiles;
            }
        } catch (err) {
            // If file reading fails, fall back to no completions
            debugLog('File completion error:', err.message);
        }
    }

    const hits = completions.filter((c) => c.startsWith(lineFragment));

    // If there's a single, exact match, add a space only if it's not a directory
    if (hits.length === 1 && hits[0] === lineFragment && !lineFragment.endsWith('/')) {
        return [[hits[0] + ' '], lineFragment];
    }

    return [hits, lineFragment];
}


function getRelativePath() {
    const home = process.env.HOME || process.env.USERPROFILE;
    const cwd = process.cwd();
    
    if (cwd === home) {
        return '~';
    } else if (cwd.startsWith(home)) {
        return '~' + cwd.slice(home.length);
    } else {
        return cwd;
    }
}

function getColoredPrompt() {
    // ANSI color codes
    const reset = '\x1b[0m';
    const bold = '\x1b[1m';
    const cyan = '\x1b[36m';
    const blue = '\x1b[34m';
    const green = '\x1b[32m';
    const magenta = '\x1b[35m';
    
    // Bold magenta for "ploinky", cyan for path, green for ">"
    return `${bold}${magenta}ploinky${reset} ${cyan}${getRelativePath()}${reset}${green}>${reset} `;
}

function startInteractiveMode() {
    // Use .ploinky_history in the current directory
    const historyPath = path.join(process.cwd(), '.ploinky_history');
    let history = [];
    try {
        if (fs.existsSync(historyPath)) {
            // Read history and keep it in original order for readline
            // readline expects newest commands first in the array
            const lines = fs.readFileSync(historyPath, 'utf-8').split('\n').filter(Boolean);
            history = lines.slice(-1000).reverse(); // Keep last 1000 commands, newest first
        }
    } catch (e) {
        debugLog('Could not read history file:', e.message);
    }

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: getColoredPrompt(),
        history: history,
        historySize: 1000,
        completer: process.stdin.isTTY ? completer : undefined // Only use completer in TTY mode
    });

    rl.on('line', (line) => {
        const trimmedLine = line.trim();
        if (trimmedLine) {
            if (trimmedLine === 'exit' || trimmedLine === 'quit') {
                rl.close();
                return;
            }
            // Append to history file immediately
            try {
                fs.appendFileSync(historyPath, trimmedLine + '\n');
            } catch (e) {
                debugLog('Could not write to history file:', e.message);
            }
            const args = trimmedLine.split(/\s+/);
            try {
                handleCommand(args);
            } catch (error) {
                console.error(`Error: ${error.message}`);
                debugLog(`Command error details: ${error.stack}`);
            }
            // Update prompt with new path after cd command
            rl.setPrompt(getColoredPrompt());
        }
        if (process.stdin.isTTY) {
            rl.prompt();
        }
    }).on('close', () => {
        if (process.stdin.isTTY) {
            console.log('Exiting Ploinky interactive mode.');
        }
        process.exit(0);
    });

    // If input is not a TTY, we are in script mode. Don't show initial prompt.
    if (process.stdin.isTTY) {
        console.log('Welcome to Ploinky interactive mode.');
        console.log("Type 'help' for a list of commands, or 'exit' to quit.");
        rl.prompt();
    }
}

function main() {
    try {
        let args = process.argv.slice(2);

        const debugIndex = args.findIndex(arg => arg === '--debug' || arg === '-d');
        if (debugIndex > -1) {
            setDebugMode(true);
            args.splice(debugIndex, 1);
            console.log('[INFO] Debug mode enabled.');
        }

        debugLog('Raw arguments:', args);
        initEnvironment();

        if (args.length === 0) {
            startInteractiveMode();
        } else {
            if (args[0] === 'help') {
                showHelp();
                return;
            }
            handleCommand(args);
        }
    } catch (error) {
        console.error(`❌ Error: ${error.message}`);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}