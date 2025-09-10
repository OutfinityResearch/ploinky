const { theme, createBoxedMessage, createInteractiveMenu } = require('./AgentUtil.js');
const COMMANDS = {
    HELP: 'help',
    CONFIGURE: 'configure',
};
const commandDescriptions = {
    [COMMANDS.HELP]: 'Displays this list of available commands.',
    [COMMANDS.CONFIGURE]: 'Allows you to configure the LLM provider and model.',
};

/**
 * Handles the /help command by displaying a formatted list of all commands.
 */
function handleHelpCommand(log) {
    log.log('\nAvailable commands:');
    for (const cmd in commandDescriptions) {
        const fullCommand = `/${cmd}`;
        // Using padEnd for clean alignment
        log.log(`  {${theme.warning}-fg}${fullCommand.padEnd(15)}{/} ${commandDescriptions[cmd]}`);
    }
    log.log('');
}

// Model configurations for each provider
const modelsByProvider = {
    openai: [
        { name: 'GPT-4o', value: 'gpt-4o', description: 'Most capable, multimodal' },
        { name: 'GPT-4o mini', value: 'gpt-4o-mini', description: 'Affordable and intelligent' },
        { name: 'GPT-4 Turbo', value: 'gpt-4-turbo', description: 'High intelligence' },
        { name: 'GPT-3.5 Turbo', value: 'gpt-3.5-turbo', description: 'Fast and inexpensive' }
    ],
    google: [
        { name: 'Gemini 1.5 Pro', value: 'gemini-1.5-pro', description: 'Best for complex tasks' },
        { name: 'Gemini 1.5 Flash', value: 'gemini-1.5-flash', description: 'Fast and versatile' },
        { name: 'Gemini 1.0 Pro', value: 'gemini-1.0-pro', description: 'Balanced performance' }
    ],
    anthropic: [
        { name: 'Claude 3 Opus', value: 'claude-3-opus', description: 'Most powerful' },
        { name: 'Claude 3 Sonnet', value: 'claude-3-sonnet', description: 'Balanced performance' },
        { name: 'Claude 3 Haiku', value: 'claude-3-haiku', description: 'Fast and compact' },
        { name: 'Claude 2.1', value: 'claude-2.1', description: 'Previous generation' }
    ],
    huggingface: [
        { name: 'Llama 2 70B', value: 'llama-2-70b', description: 'Open source, powerful' },
        { name: 'Mixtral 8x7B', value: 'mixtral-8x7b', description: 'MoE architecture' },
        { name: 'CodeLlama 34B', value: 'codellama-34b', description: 'Optimized for code' },
        { name: 'Falcon 180B', value: 'falcon-180b', description: 'Large scale model' }
    ]
};

/**
 * Handles the /configure command with interactive provider and model selection.
 * @param {reblessed.Screen} screen The main screen object.
 * @param {reblessed.Log} log The log widget.
 */
async function handleConfigureCommand(screen, log) {
    // Provider selection
    const providers = [
        { name: 'OpenAI', value: 'openai', description: 'GPT-4, GPT-3.5 Turbo' },
        { name: 'Google', value: 'google', description: 'Gemini Pro, Gemini Ultra' },
        { name: 'Anthropic', value: 'anthropic', description: 'Claude 3 Opus, Sonnet' },
        { name: 'Hugging Face', value: 'huggingface', description: 'Open source models' }
    ];

    const selectedProvider = await createInteractiveMenu({
        title: 'Select LLM Provider',
        items: providers,
        formatItem: (provider) => {
            const providerText = provider.name;
            const descText = `(${provider.description})`;
            return `${providerText} ${descText}`;
        },
        screen: screen
    });

    if (!selectedProvider) {
        log.log(`\n{${theme.warning}-fg}Configuration cancelled.{/}\n`);
        return;
    }

    // Show provider selection confirmation
    const providerConfirm = `{${theme.success}-fg}✓{/} Selected provider: {${theme.primary}-fg}${selectedProvider.name}{/}`;
    log.log(`\n${createBoxedMessage(providerConfirm)}\n`);

    // Model selection based on provider
    const models = modelsByProvider[selectedProvider.value];
    const selectedModel = await createInteractiveMenu({
        title: `Select ${selectedProvider.name} Model`,
        items: models,
        formatItem: (model) => {
            const modelText = model.name;
            const descText = `(${model.description})`;
            return `${modelText} ${descText}`;
        },
        screen: screen
    });

    if (!selectedModel) {
        log.log(`\n{${theme.warning}-fg}Model selection cancelled.{/}\n`);
        return;
    }

    // Update environment variables
    process.env.LLM_PROVIDER = selectedProvider.value;
    process.env.LLM_MODEL = selectedModel.value;

    // Show final confirmation
    const finalConfirm = `{${theme.success}-fg}✓{/} Configuration complete:\n` +
        `  Provider: {${theme.primary}-fg}${selectedProvider.name}{/}\n` +
        `  Model: {${theme.primary}-fg}${selectedModel.name}{/}`;
    log.log(`\n${createBoxedMessage(finalConfirm)}\n`);
}

const commandHandlers = {
    [COMMANDS.HELP]: handleHelpCommand,
    [COMMANDS.CONFIGURE]: handleConfigureCommand,
};

/**
 * Parses and executes a command from user input.
 * @param {string} userInput The full string entered by the user.
 * @param {reblessed.Screen} screen The main screen object.
 * @param {reblessed.Log} log The log widget.
 */
function handleCommand(userInput, screen, log) {
    const command = userInput.trim().substring(1).toLowerCase().split(' ')[0];
    const handler = commandHandlers[command];

    if (handler) {
        handler(screen, log);
    } else {
        log.log(`\n{${theme.error}-fg}Error:{/} Unknown command "${command}". Type {${theme.warning}-fg}/${COMMANDS.HELP}{/} for a list of commands.\n`);
    }
}

module.exports = { handleCommand };