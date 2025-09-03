#!/usr/bin/env node

const { initEnvironment, setDebugMode } = require('./lib/config');
const { showHelp, handleCommand } = require('./lib/commands');
const { debugLog } = require('./lib/utils');
const readline = require('readline');

function startInteractiveMode() {
    console.log('Welcome to Ploinky interactive mode.');
    console.log("Type 'help' for a list of commands, or 'exit' to quit.");

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: 'ploinky> '
    });

    rl.prompt();

    rl.on('line', (line) => {
        const trimmedLine = line.trim();
        if (trimmedLine) {
            if (trimmedLine === 'exit' || trimmedLine === 'quit') {
                rl.close();
                return;
            }
            const args = trimmedLine.split(/\s+/);
            handleCommand(args);
        }
        rl.prompt();
    }).on('close', () => {
        console.log('Exiting Ploinky interactive mode.');
        process.exit(0);
    });
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
