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
    const words = line.split(/\s+/).filter(Boolean);
    const lineFragment = line.endsWith(' ') ? '' : (words[words.length - 1] || '');
    
    let completions = [];
    let context = 'commands';

    if (words.length > 0 && COMMANDS.hasOwnProperty(words[0])) {
        const command = words[0];
        const subcommands = COMMANDS[command];

        // Determine the context for completion
        if (line.endsWith(' ')) {
            if (words.length === 1 && subcommands.length > 0) context = 'subcommands';
            else if (words.length === 2) context = 'args';
        } else {
            if (words.length === 1) context = 'commands';
            else if (words.length === 2 && subcommands.length > 0) context = 'subcommands';
            else context = 'args';
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
            }
        } else {
             completions = Object.keys(COMMANDS);
        }
    } else {
        completions = Object.keys(COMMANDS);
    }

    const hits = completions.filter((c) => c.startsWith(lineFragment));

    // If there's a single, exact match, add a space to suggest the next argument
    if (hits.length === 1 && hits[0] === lineFragment) {
        // This tells readline to show the next level of completions on the next tab press
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
    const historyPath = path.join(PLOINKY_DIR, '.history');
    let history = [];
    try {
        if (fs.existsSync(historyPath)) {
            history = fs.readFileSync(historyPath, 'utf-8').split('\n').filter(Boolean).reverse();
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
            // Only add to history if it's not a duplicate of the last command
            if (history[0] !== trimmedLine) {
                try {
                    fs.appendFileSync(historyPath, trimmedLine + '\n');
                } catch (e) {
                    debugLog('Could not write to history file:', e.message);
                }
            }
            const args = trimmedLine.split(/\s+/);
            handleCommand(args);
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