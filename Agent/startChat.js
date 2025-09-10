const reblessed = require('reblessed');
const { callLLM } = require('./LLMClient.js');
const {
    theme,
    displayIntro,
    updateStatusBar,
    showLoading,
    hideLoading,
} = require('./AgentUtil.js');
const { handleCommand } = require('./commandUtils.js');

process.env.LLM_BASE_URL = "https://api.openai.com/v1/chat/completions";
process.env.LLM_API_KEY = "";
process.env.LLM_MODEL = "gpt-4o-mini";
process.env.LLM_PROVIDER = "openai";

const chatHistory = [];
const chatState = {
    isGenerating: false,
    abortController: null,
};

/**
 * The main function to run the chat application.
 */
function main() {
    const screen = reblessed.screen({
        smartCSR: true,
        title: 'Ploinky',
        fullUnicode: true,
    });

    const chatLog = reblessed.log({
        parent: screen,
        top: 0,
        left: 0,
        width: '100%',
        height: '100%-6',
        scrollable: true,
        alwaysScroll: true,
        keys: true,
        vi: true,
        mouse: true,
        tags: true,
        scrollbar: {
            ch: ' ',
            track: {
                bg: theme.secondary
            },
            style: {
                inverse: true
            }
        },
    });

    const input = reblessed.textbox({
        parent: screen,
        bottom: 1,
        height: 3,
        width: '100%',
        keys: true,
        mouse: true,
        inputOnFocus: true,
        border: 'line',
        style: {
            fg: 'white',
            border: { fg: theme.primary },
            focus: { border: { fg: 'white' } } // Highlight border on focus
        }
    });

    const statusBar = reblessed.box({
        parent: screen,
        bottom: 0,
        left: 0,
        height: 1,
        width: '100%',
        tags: true,
        style: {
            fg: theme.text
        }
    });

    const getConfig = () => ({
        provider: process.env.LLM_PROVIDER,
        model: process.env.LLM_MODEL,
    });

    // Initial setup
    displayIntro(chatLog);
    updateStatusBar(statusBar, getConfig());
    input.focus();
    screen.render();

    // Event Handlers
    input.on('submit', async (userInput) => {
        if (!userInput) return;

        chatLog.log(`> {/}${userInput}`);
        input.clearValue();

        if (userInput.toLowerCase() === 'exit') {
            return screen.destroy();
        }

        // --- Command Handling ---
        if (userInput.trim().startsWith('/')) {
            await handleCommand(userInput, screen, chatLog);
            updateStatusBar(statusBar, getConfig());
        } else {
            // It's a regular chat message, do the LLM call
            chatHistory.push({ role: 'human', message: userInput });

            chatState.isGenerating = true;
            showLoading(screen, 'Thinking...');
            chatState.abortController = new AbortController();

            try {
                const aiResponse = await callLLM(chatHistory, chatState.abortController.signal);
                if (aiResponse === undefined) { // Cancelled
                    chatLog.log(`\n{${theme.warning}-fg}Generation stopped.{/}`);
                    chatHistory.pop();
                } else if (aiResponse) {
                    chatLog.log(`\n{${theme.primary}-fg}${aiResponse}{/}\n`);
                    chatHistory.push({ role: 'ai', message: aiResponse });
                }
            } catch (error) {
                chatHistory.pop();
            } finally {
                chatState.isGenerating = false;
                chatState.abortController = null;
                hideLoading(screen);
            }
        }

        // After the command or chat is done, restore focus to the input and render.
        input.focus();
        screen.render();
    });

    input.on('keypress', (ch, key) => {
        // Handle ESC for stopping generation
        if (chatState.isGenerating && key.name === 'escape') {
            if (chatState.abortController) {
                chatState.abortController.abort();
            }
        }
        if (key && key.ctrl && key.name === 'c') {
            screen.destroy();
            process.exit(0);
        }
    });
}

main();