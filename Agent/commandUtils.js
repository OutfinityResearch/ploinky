const { theme, COMMANDS } = require('./AgentUtil.js');

const commandDescriptions = {
    [COMMANDS.HELP]: 'Displays this list of available commands.',
    [COMMANDS.CONFIGURE]: 'Allows you to configure the LLM provider and model.',
};

/**
 * Handles the /help command by displaying a formatted list of all commands.
 */
function handleHelpCommand() {
    console.log('\nAvailable commands:');
    for (const cmd in commandDescriptions) {
        const fullCommand = `/${cmd}`;
        // Using padEnd for clean alignment
        console.log(`  ${theme.warning}${fullCommand.padEnd(15)}${theme.reset} ${commandDescriptions[cmd]}`);
    }
    console.log();
}

/**
 * Handles the /configure command (placeholder).
 */
function handleConfigureCommand() {
    console.log(`\n${theme.warning}Info:${theme.reset} Configuration command is not yet implemented.\n`);
}

const commandHandlers = {
    [COMMANDS.HELP]: handleHelpCommand,
    [COMMANDS.CONFIGURE]: handleConfigureCommand,
};

/**
 * Parses and executes a command from user input.
 * @param {string} userInput The full string entered by the user.
 */
function handleCommand(userInput) {
    const command = userInput.trim().substring(1).toLowerCase().split(' ')[0];
    const handler = commandHandlers[command];

    if (handler) {
        handler();
    } else {
        console.log(`\n${theme.error}Error:${theme.reset} Unknown command "${command}". Type ${theme.warning}/${COMMANDS.HELP}${theme.reset} for a list of commands.\n`);
    }
}

module.exports = { handleCommand };