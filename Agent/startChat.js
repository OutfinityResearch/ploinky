const readline = require('readline');
const os = require('os');
const { callLLM } = require('./LLMClient.js');
const {
    theme,
    BOX_CHARS,
    displayIntro,
    createKeyPressHandler,
    handleRlClose,
    handleProcessExit,
    stripAnsi
} = require('./AgentUtil.js');
const { handleCommand } = require('./commandUtils.js');
process.env.LLM_BASE_URL = "https://api.openai.com/v1/chat/completions";
process.env.LLM_API_KEY = "";
process.env.LLM_MODEL = "gpt-4o-mini";
process.env.LLM_PROVIDER = "openai";
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

const chatHistory = [];
// Centralized state for the chat session
const chatState = {
    isGenerating: false,
    abortController: null,
};

let terminalWidth = process.stdout.columns || 80;
process.stdout.on('resize', () => {
    terminalWidth = process.stdout.columns || 80;
});

/**
 * Attaches all necessary event listeners for the application lifecycle.
 * @param {readline.Interface} rl - The readline interface instance.
 * @param {object} chatState - The shared state object for the chat session.
 */
function setupEventListeners(rl, chatState) {
    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
    }

    const keyPressHandler = createKeyPressHandler(chatState);
    process.stdin.on('keypress', keyPressHandler);

    rl.on('close', handleRlClose);
    process.on('exit', handleProcessExit);
}

async function startChat() {
    // Use a simple prompt. The box will be drawn *after* input is received for robustness.
    const prompt = '> ';

    rl.question(prompt, async (userInput) => {
        // After input, move cursor up, clear the line, and redraw the input inside a full box.
        process.stdout.write('\x1b[A'); // Move cursor up to the prompt line.
        process.stdout.write('\x1b[2K'); // Clear the entire line.

        const topBorder = `${theme.secondary}${BOX_CHARS.TL}${BOX_CHARS.H.repeat(terminalWidth - 2)}${BOX_CHARS.TR}${theme.reset}`;
        const bottomBorder = `${theme.secondary}${BOX_CHARS.BL}${BOX_CHARS.H.repeat(terminalWidth - 2)}${BOX_CHARS.BR}${theme.reset}`;
        
        const content = `> ${userInput}`;
        const paddingLength = Math.max(0, terminalWidth - content.length - 2); // -2 for the vertical bars
        const contentLine = `${theme.secondary}${BOX_CHARS.V}${theme.reset}${content}${' '.repeat(paddingLength)}${theme.secondary}${BOX_CHARS.V}${theme.reset}`;

        console.log(topBorder);
        console.log(contentLine);
        console.log(bottomBorder);

        // --- Display Status Line ---
        let cwd = process.cwd();
        const homeDir = os.homedir();
        if (cwd.startsWith(homeDir)) {
            cwd = '~' + cwd.substring(homeDir.length);
        }
        const leftText = ` ${theme.secondary}${cwd}${theme.reset}`;
        const rightText = `${theme.secondary}${process.env.LLM_PROVIDER} | ${process.env.LLM_MODEL}${theme.reset} `;
        const spaceCount = Math.max(0, terminalWidth - stripAnsi(leftText).length - stripAnsi(rightText).length);
        const statusLine = `${leftText}${' '.repeat(spaceCount)}${rightText}`;
        console.log(statusLine);
        console.log(); // Add a blank line for spacing before the next output

        if (userInput.toLowerCase() === 'exit') {
            console.log('Goodbye!');
            rl.close();
            return;
        }

        // --- Command Handling ---
        if (userInput.trim().startsWith('/')) {
            handleCommand(userInput);
            startChat();
            return;
        }

        chatHistory.push({ role: 'human', message: userInput });

        chatState.isGenerating = true;
        chatState.abortController = new AbortController();

        try {
            const aiResponse = await callLLM(chatHistory, chatState.abortController.signal);
            if (aiResponse === undefined) { // undefined means it was cancelled
                console.log('\nGeneration stopped.');
                chatHistory.pop(); // Remove the cancelled user message from history
            } else if (aiResponse) {
                console.log(`${theme.primary}${aiResponse}${theme.reset}`);
                chatHistory.push({ role: 'ai', message: aiResponse });
            }
        } catch (error) {
            // Error is already logged by callLLM, so we can just remove the last user message from history
            chatHistory.pop();
        } finally {
            chatState.isGenerating = false;
            chatState.abortController = null;
        }

        startChat(); // Continue the conversation
    });
}

setupEventListeners(rl, chatState);
displayIntro();
startChat();